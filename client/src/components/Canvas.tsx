// The meeting canvas: positions every seat, face and the shared screen using
// the layout engine, and handles drag-to-reseat and resizing the face columns.
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { RoomEvent, type Participant } from 'livekit-client';
import { Check, Link2 } from 'lucide-react';
import { seatLabel, type SessionView } from '../../../shared/protocol.ts';
import { hasScreenShare, useRoomEvents, useSize } from '../lib/hooks.ts';
import { autoMode, clamp, computeLayout, PAD, SPLIT_MAX, SPLIT_MIN, type LayoutItem, type Rect, type StageMode } from '../lib/layout.ts';
import { copyText, meetingUrl } from '../lib/format.ts';
import type { Meeting } from '../lib/meeting.ts';
import { setUi, useStore } from '../lib/store.ts';
import { Avatar } from './Media.tsx';
import { Stage, type StageItem } from './Stage.tsx';
import { SeatEditor } from './SeatEditor.tsx';
import { EmptySeat, Tile } from './Tile.tsx';

const ROOM_EVENTS = [
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
  RoomEvent.TrackPublished,
  RoomEvent.TrackUnpublished,
  RoomEvent.TrackSubscribed,
  RoomEvent.TrackUnsubscribed,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.ConnectionStateChanged,
];

interface DragState {
  memberId: string;
  name: string;
  x: number;
  y: number;
  over: number | null;
}

export function Canvas({ meeting }: { meeting: Meeting }) {
  const room = meeting.room;
  const ref = useRef<HTMLDivElement>(null);
  const { width, height } = useSize(ref);
  useRoomEvents(room, ROOM_EVENTS);
  const state = useStore((s) => s.state)!;
  const sessionId = useStore((s) => s.sessionId);
  const host = useStore((s) => s.host);
  const hostData = useStore((s) => s.hostData);
  const arrange = useStore((s) => s.arrange);
  const pinned = useStore((s) => s.pinned);
  const stageKey = useStore((s) => s.stageKey);
  const ui = useStore((s) => s.ui);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [resizing, setResizing] = useState(false);
  const [editing, setEditing] = useState<{ seat: number; anchor: HTMLElement } | null>(null);

  const { rows, cols } = state.settings;
  const cap = rows * cols;

  // ── who is where ──
  const participants = new Map<string, Participant>();
  for (const p of room.remoteParticipants.values()) participants.set(p.identity, p);
  if (room.localParticipant.identity) participants.set(room.localParticipant.identity, room.localParticipant);

  const sessions = new Map(state.sessions.map((s) => [s.id, s]));
  // Last seat we saw each person in. If the server briefly loses track of
  // someone who is still connected (e.g. it restarted), they stay put.
  const lastSeen = useRef(new Map<string, SessionView>());
  for (const s of state.sessions) lastSeen.current.set(s.id, s);
  const members = new Map(state.members.map((m) => [m.id, m]));
  const bySeat = new Map<number, SessionView>();
  const overflow: { id: string; session?: SessionView }[] = [];
  for (const s of state.sessions) {
    if (s.seat !== null && s.seat < cap) bySeat.set(s.seat, s);
    else overflow.push({ id: s.id, session: s });
  }
  // Media-connected people the server doesn't list right now: keep them in
  // their last seat if it's free, otherwise show them as extras. Never hide anyone.
  for (const identity of participants.keys()) {
    if (sessions.has(identity) || identity === sessionId) continue;
    const last = lastSeen.current.get(identity);
    if (last && last.seat !== null && last.seat < cap && !bySeat.has(last.seat)) {
      bySeat.set(last.seat, last);
      sessions.set(identity, last);
    } else {
      overflow.push({ id: identity });
    }
  }
  const hands = state.sessions
    .filter((s) => s.hand)
    .sort((a, b) => a.hand! - b.hand!)
    .map((s) => s.id);

  const showEmpty = ui.showEmpty || arrange;
  const items: LayoutItem[] = [];
  const seatOfKey = new Map<string, number>();
  for (let i = 0; i < cap; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const s = bySeat.get(i);
    if (s) {
      items.push({ key: `p:${s.id}`, row, col });
      seatOfKey.set(`p:${s.id}`, i);
    } else if (showEmpty) {
      items.push({ key: `seat:${i}`, row, col });
      seatOfKey.set(`seat:${i}`, i);
    }
  }
  overflow.forEach((o, k) => items.push({ key: `p:${o.id}`, row: rows + Math.floor(k / cols), col: k % cols }));

  // ── what's in the middle ──
  const nameOf = (identity: string) => sessions.get(identity)?.name ?? participants.get(identity)?.name ?? 'Guest';
  const stageItems: StageItem[] = [];
  const shares = [...participants.values()]
    .filter(hasScreenShare)
    .sort((a, b) => (meeting.shareStarted.get(b.identity) ?? 0) - (meeting.shareStarted.get(a.identity) ?? 0));
  for (const p of shares) {
    stageItems.push({
      key: `share:${p.identity}`,
      kind: 'share',
      identity: p.identity,
      name: nameOf(p.identity),
      participant: p,
      local: p === room.localParticipant,
    });
  }
  if (state.spotlight && sessions.has(state.spotlight)) {
    stageItems.push({
      key: `spot:${state.spotlight}`,
      kind: 'spotlight',
      identity: state.spotlight,
      name: nameOf(state.spotlight),
      participant: participants.get(state.spotlight),
      local: state.spotlight === sessionId,
    });
  }
  if (pinned && pinned !== state.spotlight && sessions.has(pinned)) {
    stageItems.push({
      key: `pin:${pinned}`,
      kind: 'pin',
      identity: pinned,
      name: nameOf(pinned),
      participant: participants.get(pinned),
      local: pinned === sessionId,
    });
  }
  const active = stageItems.find((i) => i.key === stageKey) ?? stageItems[0] ?? null;

  const pref = ui.layout === 'room' ? state.settings.layout : ui.layout;
  const mode: StageMode = pref === 'auto' ? autoMode(width, height) : pref;
  const layout = computeLayout({
    width,
    height,
    rows,
    cols,
    items,
    compact: !showEmpty,
    stage: !!active,
    mode,
    split: ui.split[mode],
  });

  // ── drag a face (or a reserved seat) onto another seat ──
  const live = useRef({ layout, seatOfKey });
  live.current = { layout, seatOfKey };
  const hitSeat = useCallback((px: number, py: number): number | null => {
    for (const [key, r] of live.current.layout.tiles) {
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return live.current.seatOfKey.get(key) ?? null;
    }
    return null;
  }, []);

  const startDrag = useCallback(
    (e: ReactPointerEvent, memberId: string, name: string) => {
      const el = ref.current;
      if (!el) return;
      const startX = e.clientX;
      const startY = e.clientY;
      let started = false;
      const at = (ev: PointerEvent) => {
        const box = el.getBoundingClientRect();
        return { x: ev.clientX - box.left, y: ev.clientY - box.top };
      };
      const move = (ev: PointerEvent) => {
        if (!started && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        started = true;
        const p = at(ev);
        setDrag({ memberId, name, x: p.x, y: p.y, over: hitSeat(p.x, p.y) });
      };
      const finish = (ev: PointerEvent, commit: boolean) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        if (started && commit) {
          const p = at(ev);
          const seat = hitSeat(p.x, p.y);
          if (seat !== null) meeting.send({ t: 'seat.assign', memberId, seat });
        }
        setDrag(null);
      };
      const up = (ev: PointerEvent) => finish(ev, true);
      const cancel = (ev: PointerEvent) => finish(ev, false);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    },
    [hitSeat, meeting],
  );

  // ── resize the face columns / rows ──
  const startResize = (e: ReactPointerEvent, handle: Rect) => {
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    const box = el.getBoundingClientRect();
    const sides = mode === 'sides';
    const first = sides ? handle.x + handle.w / 2 < box.width / 2 : handle.y + handle.h / 2 < box.height / 2;
    setResizing(true);
    let raf = 0;
    let latest = 0;
    const move = (ev: PointerEvent) => {
      const raw = sides
        ? (first ? ev.clientX - box.left - PAD : box.right - ev.clientX - PAD) / box.width
        : (first ? ev.clientY - box.top - PAD : box.bottom - ev.clientY - PAD) / box.height;
      latest = clamp(raw, SPLIT_MIN, SPLIT_MAX);
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          setUi({ split: { ...useStore.getState().ui.split, [mode]: latest } });
        });
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setResizing(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const onEditSeat = useCallback((seat: number, anchor: HTMLElement) => setEditing({ seat, anchor }), []);

  const canManage = host;
  const classes = ['canvas', drag && 'dragging', resizing && 'resizing', arrange && 'arranging'].filter(Boolean).join(' ');

  return (
    <div className={classes} ref={ref}>
      {width > 0 &&
        items.map((item) => {
          const r = layout.tiles.get(item.key);
          if (!r) return null;
          if (item.key.startsWith('seat:')) {
            const seat = Number(item.key.slice(5));
            const reservedId = state.seats[seat] ?? null;
            const reserved = reservedId ? members.get(reservedId) : undefined;
            return (
              <EmptySeat
                key={item.key}
                x={r.x}
                y={r.y}
                w={r.w}
                h={r.h}
                seat={seat}
                label={seatLabel(seat, cols)}
                reservedName={reserved?.name ?? null}
                reservedId={reservedId}
                arrange={arrange}
                canManage={canManage}
                dropTarget={!!drag && drag.over === seat}
                dragging={!!drag && !!reservedId && drag.memberId === reservedId}
                onDragStart={startDrag}
                onEdit={onEditSeat}
              />
            );
          }
          const id = item.key.slice(2);
          const s = sessions.get(id);
          const seat = seatOfKey.get(item.key);
          const handIdx = hands.indexOf(id);
          return (
            <Tile
              key={item.key}
              x={r.x}
              y={r.y}
              w={r.w}
              h={r.h}
              session={s}
              participant={participants.get(id)}
              identity={id}
              name={nameOf(id)}
              isLocal={id === sessionId}
              seatText={seat !== undefined ? seatLabel(seat, cols) : 'Extra'}
              handOrder={handIdx >= 0 ? handIdx + 1 : null}
              canManage={canManage}
              arrange={arrange}
              dropTarget={!!drag && seat !== undefined && drag.over === seat}
              dragging={!!drag && !!s && drag.memberId === s.memberId}
              mirror={ui.mirror}
              spotlit={state.spotlight === id}
              pinned={pinned === id}
              onDragStart={startDrag}
            />
          );
        })}

      {layout.stage && active && <Stage key="stage" rect={layout.stage} item={active} items={stageItems} mirror={ui.mirror} />}

      {layout.stage &&
        layout.handles.map((h, i) => (
          <div
            key={`handle-${mode}-${i}`}
            className={`handle handle-${mode === 'sides' ? 'x' : 'y'}`}
            style={{ left: h.x, top: h.y, width: h.w, height: h.h }}
            onPointerDown={(e) => startResize(e, h)}
            onDoubleClick={() => setUi({ split: { ...ui.split, [mode]: null } })}
            title="Drag to resize · double-click to reset"
            role="separator"
            aria-orientation={mode === 'sides' ? 'vertical' : 'horizontal'}
          />
        ))}

      <Reactions tiles={layout.tiles} />

      {drag && (
        <div className="drag-ghost" style={{ transform: `translate3d(${drag.x}px, ${drag.y}px, 0)` }}>
          <Avatar name={drag.name} colorKey={drag.memberId} />
          <span>{drag.name}</span>
          {drag.over !== null && <b>→ {seatLabel(drag.over, cols)}</b>}
        </div>
      )}

      {state.sessions.length === 1 && !active && !arrange && <AloneCard roomId={state.id} />}

      {arrange && (
        <div className="arrange-banner">
          <span>
            <b>Arranging seats</b> — drag faces to move people. Click an empty seat to reserve it for someone.
          </span>
          <button className="btn btn-small btn-primary" onClick={() => useStore.setState({ arrange: false })}>
            Done
          </button>
        </div>
      )}

      {editing && (
        <SeatEditor
          key={editing.seat}
          seat={editing.seat}
          anchor={editing.anchor}
          cols={cols}
          reservedId={state.seats[editing.seat] ?? null}
          reservedName={(state.seats[editing.seat] && members.get(state.seats[editing.seat]!)?.name) || null}
          invite={state.seats[editing.seat] ? (hostData?.invites[state.seats[editing.seat]!] ?? null) : null}
          roomId={state.id}
          meeting={meeting}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** Shown while you're the only one here: invite people right away. */
function AloneCard({ roomId }: { roomId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="alone-card">
      <div>
        <b>You’re the first one here</b>
        <span>Share the link so others can join.</span>
      </div>
      <button
        className="btn btn-primary btn-small"
        onClick={async () => {
          if (await copyText(meetingUrl(roomId))) {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          }
        }}
      >
        {copied ? <Check size={15} /> : <Link2 size={15} />}
        {copied ? 'Copied' : 'Copy invite link'}
      </button>
    </div>
  );
}

function Reactions({ tiles }: { tiles: Map<string, Rect> }) {
  const reactions = useStore((s) => s.reactions);
  return (
    <>
      {reactions.map((r) => {
        const rect = tiles.get(`p:${r.sessionId}`);
        if (!rect) return null;
        const size = Math.max(22, Math.min(44, rect.w / 4));
        return (
          <span
            key={r.id}
            className="float-emoji"
            style={{ left: rect.x + rect.w / 2 + r.drift * rect.w * 0.22, top: rect.y + rect.h * 0.62, fontSize: size }}
            aria-hidden="true"
          >
            {r.emoji}
          </span>
        );
      })}
    </>
  );
}
