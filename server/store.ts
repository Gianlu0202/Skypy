// Durable room records: one JSON file per room, written atomically.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_SETTINGS, LIMITS, type RoomSettings } from '../shared/protocol.ts';
import { sanitizeSeats } from './seating.ts';

export interface MemberRecord {
  id: string;
  name: string;
  /** normalizeName(name) — used to recognise people who type the same name. */
  norm: string;
  /** sha256 of device keys this member has joined from (most recent last). */
  devices: string[];
  /** Secret for this member's personal join link. */
  invite: string;
  cohost: boolean;
  createdAt: number;
  lastSeen: number | null;
}

export interface RoomRecord {
  v: 1;
  id: string;
  name: string;
  hostKey: string;
  createdAt: number;
  updatedAt: number;
  settings: RoomSettings;
  seats: (string | null)[];
  members: Record<string, MemberRecord>;
  /** When the current meeting started (null when nobody is in the room). */
  liveSince?: number | null;
}

export const ROOM_ID_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export function randomToken(bytes = 18): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('base64url');
}

/** Meet-style id, e.g. "kqz-hwtm-rfa". No vowels → no accidental words. */
export function randomRoomId(): string {
  const alphabet = 'bcdfghjkmnpqrstvwxz';
  const pick = (n: number) => Array.from(crypto.randomBytes(n), (b) => alphabet[b % alphabet.length]).join('');
  return `${pick(3)}-${pick(4)}-${pick(3)}`;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeSettings(input: Partial<RoomSettings> | undefined): RoomSettings {
  const s = { ...DEFAULT_SETTINGS, ...(input ?? {}) };
  let rows = clampInt(s.rows, LIMITS.minRows, LIMITS.maxRows, DEFAULT_SETTINGS.rows);
  const cols = clampInt(s.cols, LIMITS.minCols, LIMITS.maxCols, DEFAULT_SETTINGS.cols);
  while (rows * cols > LIMITS.maxSeats && rows > 1) rows--;
  return {
    rows,
    cols,
    layout: s.layout === 'sides' || s.layout === 'stacked' ? s.layout : 'auto',
    autoClaim: s.autoClaim !== false,
    locked: s.locked === true,
    screenShare: s.screenShare === 'hosts' ? 'hosts' : 'everyone',
  };
}

function reviveRoom(raw: unknown): RoomRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<RoomRecord>;
  if (typeof r.id !== 'string' || typeof r.hostKey !== 'string') return null;
  const settings = normalizeSettings(r.settings);
  const members: Record<string, MemberRecord> = {};
  for (const [id, m] of Object.entries(r.members ?? {})) {
    if (!m || typeof m.name !== 'string') continue;
    members[id] = {
      id,
      name: m.name,
      norm: typeof m.norm === 'string' ? m.norm : m.name.toLowerCase(),
      devices: Array.isArray(m.devices) ? m.devices.filter((d) => typeof d === 'string').slice(-8) : [],
      invite: typeof m.invite === 'string' ? m.invite : randomToken(12),
      cohost: m.cohost === true,
      createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
      lastSeen: typeof m.lastSeen === 'number' ? m.lastSeen : null,
    };
  }
  const seats = sanitizeSeats(Array.isArray(r.seats) ? r.seats : [], settings.rows * settings.cols, new Set(Object.keys(members)));
  return {
    v: 1,
    id: r.id,
    name: typeof r.name === 'string' ? r.name : 'Meeting',
    hostKey: r.hostKey,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
    settings,
    seats,
    members,
    liveSince: typeof r.liveSince === 'number' ? r.liveSince : null,
  };
}

export class RoomStore {
  private cache = new Map<string, RoomRecord>();
  private timers = new Map<string, NodeJS.Timeout>();
  private writing = new Map<string, Promise<void>>();
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'rooms');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  has(id: string): boolean {
    return this.get(id) !== undefined;
  }

  get(id: string): RoomRecord | undefined {
    if (!ROOM_ID_RE.test(id)) return undefined;
    const cached = this.cache.get(id);
    if (cached) return cached;
    try {
      const text = fs.readFileSync(this.file(id), 'utf8');
      const room = reviveRoom(JSON.parse(text));
      if (room && room.id === id) {
        this.cache.set(id, room);
        return room;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[store] failed to read room ${id}:`, err);
      }
    }
    return undefined;
  }

  create(room: RoomRecord): void {
    this.cache.set(room.id, room);
    this.saveNow(room.id);
  }

  /** Persist soon (coalesces bursts of changes). */
  save(id: string): void {
    const room = this.cache.get(id);
    if (!room) return;
    room.updatedAt = Date.now();
    if (this.timers.has(id)) return;
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        this.saveNow(id);
      }, 400),
    );
  }

  private saveNow(id: string): Promise<void> {
    const room = this.cache.get(id);
    if (!room) return Promise.resolve();
    const previous = this.writing.get(id) ?? Promise.resolve();
    const next = previous.then(async () => {
      const target = this.file(id);
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      try {
        await fsp.writeFile(tmp, JSON.stringify(room, null, 1), 'utf8');
        // Windows can briefly lock the target (indexers, antivirus): retry.
        for (let attempt = 0; ; attempt++) {
          try {
            await fsp.rename(tmp, target);
            break;
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
            await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
          }
        }
      } catch (err) {
        console.error(`[store] failed to save room ${id}:`, err);
        await fsp.rm(tmp, { force: true }).catch(() => {});
      }
    });
    this.writing.set(id, next);
    void next.finally(() => {
      if (this.writing.get(id) === next) this.writing.delete(id);
    });
    return next;
  }

  async flush(): Promise<void> {
    const ids = [...this.timers.keys()];
    for (const id of ids) {
      clearTimeout(this.timers.get(id));
      this.timers.delete(id);
      void this.saveNow(id);
    }
    await Promise.all([...this.writing.values()]);
  }
}
