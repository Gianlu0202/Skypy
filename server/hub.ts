// Realtime room coordination over WebSocket: who is here, who sits where,
// chat, hands, reactions and host moderation. One RoomRuntime per active room.
import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import {
  LIMITS,
  REACTIONS,
  cleanName,
  normalizeName,
  type ChatMessage,
  type ClientMsg,
  type DenyCode,
  type HostData,
  type MemberView,
  type RoomState,
  type ServerMsg,
  type SessionView,
} from '../shared/protocol.ts';
import { config } from './config.ts';
import * as livekit from './livekit.ts';
import { assignSeat, claimSeats, rebalance, resizeSeats, type Occupant } from './seating.ts';
import { hashKey, normalizeSettings, randomToken, type MemberRecord, type RoomRecord, type RoomStore } from './store.ts';

interface Session extends Occupant {
  name: string;
  /** Secret per-tab key: hash of device key + tab id (never sent to others). */
  tabKey: string;
  deviceHash: string;
  /** Joined with the room's host key. */
  owner: boolean;
  host: boolean;
  hand: number | null;
  ws: WebSocket | null;
  awayTimer: NodeJS.Timeout | null;
  /** Recent action timestamps per kind, for rate limiting. */
  recent: Map<string, number[]>;
}

class RoomRuntime {
  sessions = new Map<string, Session>();
  chat: ChatMessage[] = [];
  spotlight: string | null = null;
  startedAt: number | null = null;
  /** Members removed by a host; they can't rejoin until the meeting ends. */
  removed = new Set<string>();
  pending = false;
  idleTimer: NodeJS.Timeout | null = null;
  constructor(public record: RoomRecord) {}
}

const token = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/);
const seatIndex = z
  .number()
  .int()
  .min(0)
  .max(LIMITS.maxSeats - 1);
const shortText = z.string().max(LIMITS.nameLength * 2);
const memberId = z.string().regex(/^[A-Za-z0-9]{4,32}$/);

const helloSchema = z.object({
  t: z.literal('hello'),
  roomId: z.string().max(64),
  name: shortText,
  deviceKey: token,
  tabId: token,
  hostKey: z.string().max(128).optional(),
  invite: z.string().max(128).optional(),
});

const msgSchema = z.discriminatedUnion('t', [
  helloSchema,
  z.object({ t: z.literal('ping') }),
  z.object({ t: z.literal('leave') }),
  z.object({ t: z.literal('rename'), name: shortText }),
  z.object({ t: z.literal('chat'), text: z.string().max(LIMITS.chatLength * 2) }),
  z.object({ t: z.literal('hand'), raised: z.boolean() }),
  z.object({ t: z.literal('react'), emoji: z.string().max(16) }),
  z.object({ t: z.literal('seat.assign'), memberId, seat: seatIndex }),
  z.object({ t: z.literal('seat.clear'), seat: seatIndex }),
  z.object({ t: z.literal('seat.name'), seat: seatIndex, name: shortText }),
  z.object({ t: z.literal('seats.clearAll') }),
  z.object({
    t: z.literal('roster.import'),
    names: z.array(shortText).max(LIMITS.rosterImport),
    replace: z.boolean(),
  }),
  z.object({ t: z.literal('member.forget'), memberId }),
  z.object({ t: z.literal('member.cohost'), memberId, value: z.boolean() }),
  z.object({
    t: z.literal('settings'),
    patch: z.object({
      name: z
        .string()
        .max(LIMITS.roomNameLength * 2)
        .optional(),
      rows: z.number().int().min(LIMITS.minRows).max(LIMITS.maxRows).optional(),
      cols: z.number().int().min(LIMITS.minCols).max(LIMITS.maxCols).optional(),
      layout: z.enum(['auto', 'sides', 'stacked']).optional(),
      autoClaim: z.boolean().optional(),
      locked: z.boolean().optional(),
      screenShare: z.enum(['everyone', 'hosts']).optional(),
    }),
  }),
  z.object({ t: z.literal('spotlight'), sessionId: z.string().max(160).nullable() }),
  z.object({ t: z.literal('mute'), sessionId: z.string().max(160) }),
  z.object({ t: z.literal('muteAll') }),
  z.object({ t: z.literal('kick'), sessionId: z.string().max(160) }),
  z.object({ t: z.literal('hand.lower'), sessionId: z.string().max(160) }),
  z.object({ t: z.literal('token') }),
]);

const HOST_ONLY = new Set<ClientMsg['t']>([
  'seat.assign',
  'seat.clear',
  'seat.name',
  'seats.clearAll',
  'roster.import',
  'member.forget',
  'member.cohost',
  'settings',
  'spotlight',
  'mute',
  'muteAll',
  'kick',
]);

const MAX_SESSIONS = 120;
/** Connections one person (or one browser) may have open at once. */
const MAX_PER_PERSON = 4;

/** Own-property lookup: never resolves names like "__proto__" or "constructor". */
function memberOf(room: RoomRecord, id: string | null | undefined): MemberRecord | undefined {
  return id && Object.hasOwn(room.members, id) ? room.members[id] : undefined;
}

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function send(ws: WebSocket | null, msg: ServerMsg): void {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function newMemberId(): string {
  return crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x');
}

export class Hub {
  private runtimes = new Map<string, RoomRuntime>();

  constructor(private store: RoomStore) {}

  /** Number of people currently connected to a room. */
  online(roomId: string): number {
    return this.runtimes.get(roomId)?.sessions.size ?? 0;
  }

  private runtime(roomId: string): RoomRuntime | undefined {
    let rt = this.runtimes.get(roomId);
    if (rt) return rt;
    const record = this.store.get(roomId);
    if (!record) return undefined;
    rt = new RoomRuntime(record);
    // After a restart, a meeting that was running a moment ago keeps its clock.
    if (record.liveSince && Date.now() - record.updatedAt < 5 * 60_000) rt.startedAt = record.liveSince;
    this.runtimes.set(roomId, rt);
    return rt;
  }

  // ───────────────────────── connections ─────────────────────────

  accept(ws: WebSocket): void {
    let current: { rt: RoomRuntime; session: Session } | null = null;
    let alive = true;
    ws.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch {
        /* socket already closing */
      }
    }, 20_000);

    ws.on('message', (data, isBinary) => {
      alive = true;
      if (isBinary) return;
      let parsed: ClientMsg;
      try {
        const result = msgSchema.safeParse(JSON.parse(data.toString()));
        if (!result.success) {
          send(ws, { t: 'error', message: 'Malformed message.' });
          return;
        }
        parsed = result.data as ClientMsg;
      } catch {
        send(ws, { t: 'error', message: 'Malformed message.' });
        return;
      }
      try {
        if (parsed.t === 'ping') {
          send(ws, { t: 'pong', serverTime: Date.now() });
          return;
        }
        if (parsed.t === 'hello') {
          if (current) return;
          current = this.join(ws, parsed);
          if (current) void this.welcome(ws, current.rt, current.session);
          return;
        }
        if (!current || current.session.ws !== ws) return;
        this.handle(current.rt, current.session, parsed);
      } catch (err) {
        console.error('[hub] message handler failed:', err);
        send(ws, { t: 'error', message: 'Something went wrong handling that request.' });
      }
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
      if (current && current.session.ws === ws) this.markAway(current.rt, current.session);
    });
    ws.on('error', () => {
      /* 'close' follows */
    });
  }

  private deny(ws: WebSocket, code: DenyCode, message: string): null {
    send(ws, { t: 'denied', code, message });
    setTimeout(() => ws.close(4003, code), 50);
    return null;
  }

  private join(ws: WebSocket, msg: Extract<ClientMsg, { t: 'hello' }>): { rt: RoomRuntime; session: Session } | null {
    const rt = this.runtime(msg.roomId);
    if (!rt) return this.deny(ws, 'not_found', 'This meeting link is not valid. Check the link or ask the host for a new one.');
    const joined = this.admit(ws, rt, msg);
    // Don't keep a runtime alive for a room nobody managed to join.
    if (!joined && rt.sessions.size === 0 && !rt.idleTimer) this.scheduleIdle(rt);
    return joined;
  }

  private admit(ws: WebSocket, rt: RoomRuntime, msg: Extract<ClientMsg, { t: 'hello' }>): { rt: RoomRuntime; session: Session } | null {
    const room = rt.record;
    const owner = !!msg.hostKey && safeEqual(msg.hostKey, room.hostKey);
    const name = cleanName(msg.name);
    if (!name) return this.deny(ws, 'bad_request', 'Please enter your name.');

    const member = this.resolveMember(rt, { name, deviceKey: msg.deviceKey, invite: msg.invite });
    if (!member && room.settings.locked && !owner) {
      return this.deny(
        ws,
        'locked',
        'This meeting is locked. Only people on the seating roster can join — ask the host for your personal link.',
      );
    }
    if (member && rt.removed.has(member.id) && !owner) {
      return this.deny(ws, 'removed', 'The host removed you from this meeting.');
    }

    const deviceHash = hashKey(msg.deviceKey);
    // The tab key proves "same browser, same tab" without revealing the tab id.
    const tabKey = hashKey(`${msg.deviceKey}:${msg.tabId}`).slice(0, 16);
    const resuming = !!member && rt.sessions.has(`${member.id}.${tabKey}`);
    if (!resuming) {
      const sessions = [...rt.sessions.values()];
      const sameDevice = sessions.filter((x) => x.deviceHash === deviceHash && x.tabKey !== tabKey).length;
      const samePerson = member ? sessions.filter((x) => x.memberId === member.id && x.tabKey !== tabKey).length : 0;
      if (sameDevice >= MAX_PER_PERSON || samePerson >= MAX_PER_PERSON) {
        return this.deny(ws, 'full', 'You’re already in this meeting in too many windows. Close one and try again.');
      }
      if (rt.sessions.size >= MAX_SESSIONS) return this.deny(ws, 'full', 'This meeting is full.');
    }

    const m = member ?? this.createMember(room, name);
    m.name = name;
    m.norm = normalizeName(name);
    m.devices = [...m.devices.filter((d) => d !== deviceHash), deviceHash].slice(-8);
    m.lastSeen = Date.now();
    const id = `${m.id}.${tabKey}`;

    // A tab can only be one person: drop this tab's earlier session if it
    // joined under another name.
    for (const other of rt.sessions.values()) {
      if (other.tabKey === tabKey && other.id !== id) this.removeSession(rt, other, false);
    }

    let session = rt.sessions.get(id);
    if (session) {
      if (session.ws && session.ws !== ws) {
        const old = session.ws;
        session.ws = null;
        old.close(4001, 'replaced');
      }
      if (session.awayTimer) clearTimeout(session.awayTimer);
      session.awayTimer = null;
      session.ws = ws;
      session.name = name;
      session.owner = owner;
    } else {
      session = {
        id,
        memberId: m.id,
        seat: null,
        joinedAt: Date.now(),
        name,
        tabKey,
        deviceHash,
        owner,
        host: false,
        hand: null,
        ws,
        awayTimer: null,
        recent: new Map(),
      };
      rt.sessions.set(id, session);
    }
    session.host = owner || m.cohost;
    if (rt.idleTimer) {
      clearTimeout(rt.idleTimer);
      rt.idleTimer = null;
    }
    rt.startedAt ??= Date.now();
    room.liveSince = rt.startedAt;

    this.reseat(rt);
    this.store.save(room.id);
    return { rt, session };
  }

  private async welcome(ws: WebSocket, rt: RoomRuntime, session: Session): Promise<void> {
    let lkToken: string;
    try {
      lkToken = await this.mediaToken(rt, session);
    } catch (err) {
      console.error('[hub] token creation failed:', err);
      send(ws, { t: 'error', message: 'Could not create a media token. Check the server LiveKit configuration.' });
      ws.close(1011, 'token');
      return;
    }
    // The socket may have closed while the token was being signed.
    if (session.ws !== ws || ws.readyState !== ws.OPEN) return;
    send(ws, {
      t: 'welcome',
      sessionId: session.id,
      memberId: session.memberId,
      host: session.host,
      livekit: { url: config.livekit.url, token: lkToken },
      state: this.snapshot(rt),
      chat: rt.chat,
      hostData: session.host ? this.hostData(rt, session) : null,
      serverTime: Date.now(),
    });
    this.broadcast(rt);
  }

  private canShareScreen(rt: RoomRuntime, s: Session): boolean {
    return rt.record.settings.screenShare === 'everyone' || s.host;
  }

  private mediaToken(rt: RoomRuntime, s: Session): Promise<string> {
    return livekit.createToken({ roomId: rt.record.id, identity: s.id, name: s.name, screenShare: this.canShareScreen(rt, s) });
  }

  /** Re-apply media permissions (screen sharing) after a policy or role change. */
  private syncPermissions(rt: RoomRuntime): void {
    for (const s of rt.sessions.values()) void livekit.setScreenSharePermission(rt.record.id, s.id, this.canShareScreen(rt, s));
  }

  private resolveMember(rt: RoomRuntime, who: { name: string; deviceKey: string; invite?: string }): MemberRecord | null {
    const members = Object.values(rt.record.members);
    if (who.invite) {
      const byInvite = members.find((m) => safeEqual(m.invite, who.invite!));
      if (byInvite) return byInvite;
    }
    const norm = normalizeName(who.name);
    // This browser joined before under the same name (someone else typing a
    // different name on a shared lab computer is a different person).
    const deviceHash = hashKey(who.deviceKey);
    const byDevice = members
      .filter((m) => m.norm === norm && m.devices.includes(deviceHash))
      .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0))[0];
    if (byDevice) return byDevice;
    // Same name from a new device: the roster entry, unless it's in use or a
    // co-host (host rights need the original device or the personal link).
    const online = new Set([...rt.sessions.values()].map((s) => s.memberId));
    const reserved = new Set(rt.record.seats);
    const byName = members
      .filter((m) => m.norm === norm && !online.has(m.id) && !m.cohost)
      // Prefer the roster entry that actually has a seat.
      .sort((a, b) => Number(reserved.has(b.id)) - Number(reserved.has(a.id)) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0))[0];
    return byName ?? null;
  }

  private createMember(room: RoomRecord, name: string): MemberRecord {
    this.pruneMembers(room);
    let id = newMemberId();
    while (Object.hasOwn(room.members, id)) id = newMemberId();
    const m: MemberRecord = {
      id,
      name,
      norm: normalizeName(name),
      devices: [],
      invite: randomToken(12),
      cohost: false,
      createdAt: Date.now(),
      lastSeen: null,
    };
    room.members[id] = m;
    return m;
  }

  /** Keep the roster bounded: forget the oldest members without a seat. */
  private pruneMembers(room: RoomRecord): void {
    const ids = Object.keys(room.members);
    if (ids.length < LIMITS.membersPerRoom) return;
    const keep = new Set(room.seats.filter(Boolean) as string[]);
    const online = new Set([...(this.runtimes.get(room.id)?.sessions.values() ?? [])].map((s) => s.memberId));
    const candidates = Object.values(room.members)
      .filter((m) => !keep.has(m.id) && !online.has(m.id) && !m.cohost)
      .sort((a, b) => (a.lastSeen ?? a.createdAt) - (b.lastSeen ?? b.createdAt));
    for (const m of candidates.slice(0, ids.length - LIMITS.membersPerRoom + 50)) delete room.members[m.id];
  }

  private markAway(rt: RoomRuntime, session: Session): void {
    session.ws = null;
    if (session.awayTimer) clearTimeout(session.awayTimer);
    session.awayTimer = setTimeout(() => this.removeSession(rt, session, true), config.graceSeconds * 1000);
    this.broadcast(rt);
  }

  private removeSession(rt: RoomRuntime, session: Session, notify: boolean): void {
    if (rt.sessions.get(session.id) !== session) return;
    if (session.awayTimer) clearTimeout(session.awayTimer);
    session.awayTimer = null;
    rt.sessions.delete(session.id);
    const member = memberOf(rt.record, session.memberId);
    if (member) member.lastSeen = Date.now();
    if (rt.spotlight === session.id) rt.spotlight = null;
    if (session.ws) {
      const ws = session.ws;
      session.ws = null;
      ws.close(1000, 'left');
    }
    this.reseat(rt);
    this.store.save(rt.record.id);
    if (rt.sessions.size === 0) this.scheduleIdle(rt);
    if (notify) this.broadcast(rt);
  }

  private scheduleIdle(rt: RoomRuntime): void {
    rt.startedAt = null;
    rt.record.liveSince = null;
    this.store.save(rt.record.id);
    rt.removed.clear();
    rt.spotlight = null;
    if (rt.idleTimer) clearTimeout(rt.idleTimer);
    // Keep chat around briefly in case people rejoin, then drop the runtime.
    rt.idleTimer = setTimeout(() => {
      if (rt.sessions.size === 0 && this.runtimes.get(rt.record.id) === rt) {
        this.runtimes.delete(rt.record.id);
      }
    }, 15 * 60_000);
  }

  /** Recompute seating after any change; persist new automatic claims. */
  private reseat(rt: RoomRuntime): void {
    const sessions = [...rt.sessions.values()];
    rebalance(rt.record.seats, sessions);
    if (rt.record.settings.autoClaim && claimSeats(rt.record.seats, sessions)) {
      this.store.save(rt.record.id);
    }
  }

  // ───────────────────────── messages ─────────────────────────

  private handle(rt: RoomRuntime, s: Session, msg: ClientMsg): void {
    if (HOST_ONLY.has(msg.t) && !s.host) {
      send(s.ws, { t: 'error', message: 'Only hosts can do that.' });
      return;
    }
    const room = rt.record;
    switch (msg.t) {
      case 'leave':
        this.removeSession(rt, s, true);
        return;

      case 'rename': {
        const name = cleanName(msg.name);
        if (!name || !this.allow(s, 'rename', 5, 10_000)) return;
        s.name = name;
        const m = memberOf(room, s.memberId);
        if (m) {
          m.name = name;
          m.norm = normalizeName(name);
        }
        this.store.save(room.id);
        break;
      }

      case 'chat': {
        const text = msg.text.replace(/\r\n/g, '\n').trim().slice(0, LIMITS.chatLength);
        if (!text || !this.allow(s, 'chat', 8, 5000)) return;
        const chat: ChatMessage = {
          id: randomToken(9),
          sessionId: s.id,
          memberId: s.memberId,
          name: s.name,
          text,
          ts: Date.now(),
        };
        rt.chat.push(chat);
        if (rt.chat.length > LIMITS.chatHistory) rt.chat.splice(0, rt.chat.length - LIMITS.chatHistory);
        for (const other of rt.sessions.values()) send(other.ws, { t: 'chat', msg: chat });
        return;
      }

      case 'hand':
        if (!this.allow(s, 'hand', 10, 10_000)) return;
        s.hand = msg.raised ? (s.hand ?? Date.now()) : null;
        break;

      case 'token':
        // Fresh media token before the client reconnects to LiveKit.
        if (!this.allow(s, 'token', 6, 60_000)) return;
        void this.mediaToken(rt, s).then(
          (token) => send(s.ws, { t: 'token', token }),
          (err) => console.error('[hub] token refresh failed:', err),
        );
        return;

      case 'react': {
        if (!(REACTIONS as readonly string[]).includes(msg.emoji) || !this.allow(s, 'react', 10, 4000)) return;
        for (const other of rt.sessions.values()) send(other.ws, { t: 'react', sessionId: s.id, emoji: msg.emoji });
        return;
      }

      case 'hand.lower':
        if (msg.sessionId === 'all') {
          if (!s.host) return;
          for (const other of rt.sessions.values()) other.hand = null;
        } else {
          const target = rt.sessions.get(msg.sessionId);
          if (!target || (target !== s && !s.host)) return;
          target.hand = null;
        }
        break;

      case 'seat.assign': {
        if (msg.seat >= room.seats.length || !memberOf(room, msg.memberId)) return;
        assignSeat(room.seats, [...rt.sessions.values()], msg.memberId, msg.seat);
        this.reseat(rt);
        this.store.save(room.id);
        break;
      }

      case 'seat.clear':
        if (msg.seat >= room.seats.length) return;
        room.seats[msg.seat] = null;
        this.reseat(rt);
        this.store.save(room.id);
        break;

      case 'seat.name': {
        if (msg.seat >= room.seats.length) return;
        const name = cleanName(msg.name);
        if (!name) {
          room.seats[msg.seat] = null;
        } else {
          const norm = normalizeName(name);
          const current = memberOf(room, room.seats[msg.seat]);
          const existing = current?.norm === norm ? current : Object.values(room.members).find((m) => m.norm === norm);
          const m = existing ?? this.createMember(room, name);
          if (!existing) m.name = name;
          assignSeat(room.seats, [...rt.sessions.values()], m.id, msg.seat);
        }
        this.reseat(rt);
        this.store.save(room.id);
        break;
      }

      case 'seats.clearAll':
        room.seats.fill(null);
        this.reseat(rt);
        this.store.save(room.id);
        break;

      case 'roster.import': {
        if (msg.replace) room.seats.fill(null);
        const names = msg.names.map((n) => cleanName(n)).filter(Boolean);
        let skipped = 0;
        const seen = new Set<string>();
        for (const name of names) {
          const norm = normalizeName(name);
          if (seen.has(norm)) continue;
          seen.add(norm);
          const m = Object.values(room.members).find((x) => x.norm === norm) ?? this.createMember(room, name);
          if (room.seats.includes(m.id)) continue;
          const free = room.seats.indexOf(null);
          if (free < 0) {
            skipped++;
            continue;
          }
          room.seats[free] = m.id;
        }
        this.reseat(rt);
        this.store.save(room.id);
        if (skipped > 0) {
          send(s.ws, {
            t: 'notice',
            level: 'warn',
            text: `${skipped} name${skipped === 1 ? '' : 's'} didn't fit — add more rows or columns, then import again.`,
          });
        }
        break;
      }

      case 'member.forget': {
        const idx = room.seats.indexOf(msg.memberId);
        if (idx >= 0) room.seats[idx] = null;
        const online = [...rt.sessions.values()].some((x) => x.memberId === msg.memberId);
        const forgotten = memberOf(room, msg.memberId);
        if (!online && forgotten && !forgotten.cohost) delete room.members[msg.memberId];
        this.reseat(rt);
        this.store.save(room.id);
        break;
      }

      case 'member.cohost': {
        const m = memberOf(room, msg.memberId);
        if (!m) return;
        m.cohost = msg.value;
        for (const other of rt.sessions.values()) {
          if (other.memberId === m.id) other.host = other.owner || m.cohost;
        }
        this.store.save(room.id);
        this.syncPermissions(rt);
        break;
      }

      case 'settings': {
        const { name, ...patch } = msg.patch;
        if (name !== undefined) {
          const clean = cleanName(name, LIMITS.roomNameLength);
          if (clean) room.name = clean;
        }
        const next = normalizeSettings({ ...room.settings, ...patch });
        if (next.rows !== room.settings.rows || next.cols !== room.settings.cols) {
          const { seats, remap } = resizeSeats(room.seats, room.settings.cols, next.rows, next.cols);
          room.seats = seats;
          for (const other of rt.sessions.values()) other.seat = remap(other.seat);
        }
        const shareChanged = next.screenShare !== room.settings.screenShare;
        room.settings = next;
        this.reseat(rt);
        this.store.save(room.id);
        if (shareChanged) this.syncPermissions(rt);
        break;
      }

      case 'spotlight':
        rt.spotlight = msg.sessionId && rt.sessions.has(msg.sessionId) ? msg.sessionId : null;
        break;

      case 'mute': {
        const target = rt.sessions.get(msg.sessionId);
        if (!target) return;
        void livekit.muteMicrophone(room.id, target.id).then((ok) => {
          if (ok) send(target.ws, { t: 'notice', level: 'info', text: `${s.name} muted you.` });
          else send(s.ws, { t: 'notice', level: 'warn', text: `Couldn't mute ${target.name}.` });
        });
        return;
      }

      case 'muteAll': {
        for (const target of rt.sessions.values()) {
          if (target === s || target.host) continue;
          void livekit.muteMicrophone(room.id, target.id);
        }
        for (const target of rt.sessions.values()) {
          if (target !== s && !target.host) send(target.ws, { t: 'notice', level: 'info', text: `${s.name} muted everyone.` });
        }
        return;
      }

      case 'kick': {
        const target = rt.sessions.get(msg.sessionId);
        if (!target || target.memberId === s.memberId || (target.owner && !s.owner)) return;
        rt.removed.add(target.memberId);
        // Remove every window of that person and revoke their media tokens.
        for (const other of [...rt.sessions.values()]) {
          if (other.memberId !== target.memberId) continue;
          send(other.ws, { t: 'kicked', reason: `${s.name} removed you from the meeting.` });
          void livekit.removeParticipant(room.id, other.id, { revoke: true });
          this.removeSession(rt, other, false);
        }
        break;
      }

      default:
        return;
    }
    this.broadcast(rt);
  }

  /** Per-session rate limit: at most `max` actions of a kind per `windowMs`. */
  private allow(s: Session, kind: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const recent = (s.recent.get(kind) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      s.recent.set(kind, recent);
      return false;
    }
    recent.push(now);
    s.recent.set(kind, recent);
    return true;
  }

  // ───────────────────────── state fan-out ─────────────────────────

  private snapshot(rt: RoomRuntime): RoomState {
    const room = rt.record;
    const online = new Set([...rt.sessions.values()].map((s) => s.memberId));
    const relevant = new Set<string>([...online, ...(room.seats.filter(Boolean) as string[])]);
    const members: MemberView[] = [];
    for (const id of relevant) {
      const m = memberOf(room, id);
      if (!m) continue;
      members.push({ id, name: m.name, cohost: m.cohost, online: online.has(id), lastSeen: m.lastSeen });
    }
    const sessions: SessionView[] = [...rt.sessions.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((s) => ({
        id: s.id,
        memberId: s.memberId,
        name: s.name,
        seat: s.seat,
        host: s.host,
        hand: s.hand,
        joinedAt: s.joinedAt,
        away: s.ws === null,
      }));
    return {
      id: room.id,
      name: room.name,
      settings: room.settings,
      seats: [...room.seats],
      members,
      sessions,
      spotlight: rt.spotlight,
      startedAt: rt.startedAt,
    };
  }

  /** Host-only data. The room's host key goes only to its owner, not co-hosts. */
  private hostData(rt: RoomRuntime, s: Session): HostData {
    const room = rt.record;
    const online = new Set([...rt.sessions.values()].map((s) => s.memberId));
    const invites: Record<string, string> = {};
    for (const m of Object.values(room.members)) {
      if (online.has(m.id) || room.seats.includes(m.id)) invites[m.id] = m.invite;
    }
    return { hostKey: s.owner ? room.hostKey : null, invites };
  }

  /** Send the full state to everyone, coalescing bursts into one message. */
  private broadcast(rt: RoomRuntime): void {
    if (rt.pending) return;
    rt.pending = true;
    setImmediate(() => {
      rt.pending = false;
      const state = this.snapshot(rt);
      const plain = JSON.stringify({ t: 'state', state, host: false, hostData: null } satisfies ServerMsg);
      const forHost = new Map<boolean, string>(); // keyed by "is owner"
      for (const s of rt.sessions.values()) {
        if (!s.ws || s.ws.readyState !== s.ws.OPEN) continue;
        if (s.host) {
          let msg = forHost.get(s.owner);
          if (!msg) {
            msg = JSON.stringify({ t: 'state', state, host: true, hostData: this.hostData(rt, s) } satisfies ServerMsg);
            forHost.set(s.owner, msg);
          }
          s.ws.send(msg);
        } else {
          s.ws.send(plain);
        }
      }
    });
  }

  /** Close every socket (used on shutdown so clients reconnect promptly). */
  closeAll(): void {
    for (const rt of this.runtimes.values()) {
      for (const s of rt.sessions.values()) s.ws?.close(1012, 'restart');
    }
  }
}
