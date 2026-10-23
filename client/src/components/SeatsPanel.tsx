import { useState, type DragEvent } from 'react';
import { ClipboardList, Download, KeyRound, Link2, Lock, Sparkles, Trash2, Users } from 'lucide-react';
import { LIMITS, seatLabel, type LayoutMode, type RoomSettings, type SharePolicy } from '../../../shared/protocol.ts';
import { copyText, initials, meetingUrl } from '../lib/format.ts';
import type { Meeting } from '../lib/meeting.ts';
import { toast, useStore } from '../lib/store.ts';
import { Segmented, Stepper, Switch } from './Controls.tsx';
import { SeatEditor } from './SeatEditor.tsx';

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function SeatsPanel({ meeting }: { meeting: Meeting }) {
  const state = useStore((s) => s.state)!;
  const hostData = useStore((s) => s.hostData);
  const { rows, cols } = state.settings;
  const cap = rows * cols;
  const [editing, setEditing] = useState<{ seat: number; anchor: HTMLElement } | null>(null);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [roster, setRoster] = useState('');
  const [roomName, setRoomName] = useState(state.name);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const members = new Map(state.members.map((m) => [m.id, m]));
  const sittingAt = new Map<number, (typeof state.sessions)[number]>();
  for (const s of state.sessions) if (s.seat !== null && s.seat < cap) sittingAt.set(s.seat, s);
  const reservedCount = state.seats.filter(Boolean).length;
  const seatedCount = sittingAt.size;
  const narrow = cols > 8;

  const update = (patch: Partial<RoomSettings> & { name?: string }) => meeting.send({ t: 'settings', patch });

  /** Resize the room, warning first if reserved seats would fall off the grid. */
  const resize = (newRows: number, newCols: number) => {
    let outside = 0;
    let inside = 0;
    state.seats.forEach((m, i) => {
      if (!m) return;
      if (Math.floor(i / cols) < newRows && i % cols < newCols) inside++;
      else outside++;
    });
    if (outside > 0) {
      const free = newRows * newCols - inside;
      const lost = Math.max(0, outside - free);
      const msg =
        `${outside} reserved ${outside === 1 ? 'seat is' : 'seats are'} outside the new size. ` +
        (lost > 0
          ? `${outside - lost} will move to empty seats and ${lost} will lose their reservation.`
          : `${outside === 1 ? 'It' : 'They'} will move to the first empty seats.`) +
        ' Continue?';
      if (!confirm(msg)) return;
    }
    update({ rows: newRows, cols: newCols });
  };

  const memberAt = (seat: number): string | null => state.seats[seat] ?? sittingAt.get(seat)?.memberId ?? null;

  const onDrop = (e: DragEvent, seat: number) => {
    e.preventDefault();
    setDragOver(null);
    const from = dragFrom;
    setDragFrom(null);
    if (from === null || from === seat) return;
    const memberId = memberAt(from);
    if (memberId) meeting.send({ t: 'seat.assign', memberId, seat });
  };

  const importRoster = (replace: boolean) => {
    const names = roster
      .split(/[\n,;\t]+/)
      .map((n) => n.trim())
      .filter(Boolean)
      .slice(0, LIMITS.rosterImport);
    if (names.length === 0) return;
    if (replace && reservedCount > 0 && !confirm('Replace the whole seating chart with this list? Current reservations will be cleared.'))
      return;
    meeting.send({ t: 'roster.import', names, replace });
    toast(`Seated ${names.length} ${names.length === 1 ? 'name' : 'names'} from your list.`, { tone: 'success' });
    setRoster('');
    setRosterOpen(false);
  };

  const exportAttendance = () => {
    const lines = [['Seat', 'Name', 'Status', 'Joined', 'Host'].join(',')];
    const seen = new Set<string>();
    const rowsOut: { seat: number; line: string }[] = [];
    for (const s of state.sessions) {
      seen.add(s.memberId);
      const seat = s.seat !== null && s.seat < cap ? s.seat : 9999;
      rowsOut.push({
        seat,
        line: [
          seat === 9999 ? 'Extra' : seatLabel(seat, cols),
          csvCell(s.name),
          'Present',
          new Date(s.joinedAt).toLocaleString(),
          s.host ? 'Yes' : '',
        ].join(','),
      });
    }
    state.seats.forEach((memberId, seat) => {
      if (!memberId || seen.has(memberId)) return;
      const m = members.get(memberId);
      rowsOut.push({ seat, line: [seatLabel(seat, cols), csvCell(m?.name ?? 'Unknown'), 'Absent', '', ''].join(',') });
    });
    rowsOut.sort((a, b) => a.seat - b.seat).forEach((r) => lines.push(r.line));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const day = new Date().toISOString().slice(0, 10);
    a.download = `${state.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'meeting'}-attendance-${day}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="panel seats-panel">
      <div className="panel-scroll">
        <section className="seats-section">
          <div className="seats-summary">
            <span>
              <b>{seatedCount}</b> here
            </span>
            <span>
              <b>{reservedCount}</b> reserved
            </span>
            <span>
              <b>{cap}</b> seats
            </span>
          </div>
          <div
            className="seat-map"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            role="grid"
            aria-label="Seating chart"
          >
            {Array.from({ length: cap }, (_, seat) => {
              const reservedId = state.seats[seat];
              const sitting = sittingAt.get(seat);
              const name = sitting?.name ?? (reservedId ? members.get(reservedId)?.name : undefined);
              const draggable = !!memberAt(seat);
              return (
                <button
                  key={seat}
                  type="button"
                  className={[
                    'seat-cell',
                    sitting && 'here',
                    reservedId && !sitting && 'away',
                    sitting && reservedId !== sitting.memberId && 'temp',
                    dragOver === seat && 'over',
                    dragFrom === seat && 'from',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  draggable={draggable}
                  onDragStart={(e) => {
                    setDragFrom(seat);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(seat));
                  }}
                  onDragEnd={() => {
                    setDragFrom(null);
                    setDragOver(null);
                  }}
                  onDragOver={(e) => {
                    if (dragFrom === null) return;
                    e.preventDefault();
                    setDragOver(seat);
                  }}
                  onDragLeave={() => setDragOver((v) => (v === seat ? null : v))}
                  onDrop={(e) => onDrop(e, seat)}
                  onClick={(e) => setEditing({ seat, anchor: e.currentTarget })}
                  title={`${seatLabel(seat, cols)}${name ? ` · ${name}` : ' · empty'}${sitting ? ' (here)' : reservedId ? ' (not here)' : ''}`}
                >
                  <span className="seat-cell-label">{seatLabel(seat, cols)}</span>
                  {name && <span className="seat-cell-name">{narrow ? initials(name) : name.split(' ')[0]}</span>}
                </button>
              );
            })}
          </div>
          <div className="seat-legend">
            <span>
              <i className="here" /> Here
            </span>
            <span>
              <i className="away" /> Reserved, not here
            </span>
            <span>
              <i className="temp" /> Visiting
            </span>
          </div>
          <p className="panel-hint">Drag names to swap seats, or click a seat to reserve it. Everyone sees the same seating.</p>
        </section>

        <section className="seats-section">
          <h3>Room shape</h3>
          <div className="size-row">
            <Stepper
              label="Rows"
              value={rows}
              min={LIMITS.minRows}
              max={Math.min(LIMITS.maxRows, Math.floor(LIMITS.maxSeats / cols))}
              onChange={(v) => resize(v, cols)}
            />
            <span className="size-x">×</span>
            <Stepper
              label="Per row"
              value={cols}
              min={LIMITS.minCols}
              max={Math.min(LIMITS.maxCols, Math.floor(LIMITS.maxSeats / rows))}
              onChange={(v) => resize(rows, v)}
            />
          </div>
          <p className="panel-hint">People keep their row and seat number when you resize.</p>
        </section>

        <section className="seats-section">
          <h3>Class list</h3>
          {rosterOpen ? (
            <div className="roster">
              <textarea
                className="input"
                rows={6}
                value={roster}
                onChange={(e) => setRoster(e.target.value)}
                placeholder={'Paste names, one per line:\nAda Lovelace\nAlan Turing\nGrace Hopper'}
                autoFocus
              />
              <div className="roster-actions">
                <button className="btn btn-primary btn-small" onClick={() => importRoster(false)} disabled={!roster.trim()}>
                  Fill empty seats
                </button>
                <button className="btn btn-secondary btn-small" onClick={() => importRoster(true)} disabled={!roster.trim()}>
                  Replace chart
                </button>
                <button className="btn btn-ghost btn-small" onClick={() => setRosterOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button className="btn btn-secondary btn-small" onClick={() => setRosterOpen(true)}>
              <ClipboardList size={15} /> Paste a class list
            </button>
          )}
          <p className="panel-hint">Names fill seats front-to-back, left-to-right. Students who join with that name land in their seat.</p>
        </section>

        <section className="seats-section">
          <h3>Behaviour</h3>
          <Switch
            label="Remember seats"
            hint="The first seat someone takes becomes theirs for future meetings."
            checked={state.settings.autoClaim}
            onChange={(v) => update({ autoClaim: v })}
          />
          <Switch
            label="Lock to class list"
            hint="Only people with a reserved seat (and hosts) can join."
            checked={state.settings.locked}
            onChange={(v) => update({ locked: v })}
          />
          <div className="setting-row">
            <span>Who can share their screen</span>
            <Segmented<SharePolicy>
              label="Who can share"
              value={state.settings.screenShare}
              options={[
                { value: 'everyone', label: 'Everyone' },
                { value: 'hosts', label: 'Hosts' },
              ]}
              onChange={(v) => update({ screenShare: v })}
            />
          </div>
          <div className="setting-row">
            <span>Faces while sharing</span>
            <Segmented<LayoutMode>
              label="Faces while sharing"
              value={state.settings.layout}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'sides', label: 'Sides' },
                { value: 'stacked', label: 'Above/below' },
              ]}
              onChange={(v) => update({ layout: v })}
            />
          </div>
        </section>

        <section className="seats-section">
          <h3>Meeting</h3>
          <label className="field">
            <span className="field-label">Name</span>
            <input
              className="input"
              value={roomName}
              maxLength={LIMITS.roomNameLength}
              onChange={(e) => setRoomName(e.target.value)}
              onBlur={() => roomName.trim() && roomName.trim() !== state.name && update({ name: roomName.trim() })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          </label>
          <div className="link-grid">
            <button
              className="btn btn-secondary btn-small"
              onClick={async () => {
                const ok = await copyText(meetingUrl(state.id));
                toast(ok ? 'Meeting link copied.' : 'Couldn’t copy.', { tone: ok ? 'success' : 'warn' });
              }}
            >
              <Link2 size={15} /> Meeting link
            </button>
            {hostData?.hostKey && (
              <button
                className="btn btn-secondary btn-small"
                onClick={async () => {
                  const ok = await copyText(`${meetingUrl(state.id)}?host=${hostData.hostKey}`);
                  toast(ok ? 'Host link copied. Anyone with it can manage this room — keep it private.' : 'Couldn’t copy.', {
                    tone: ok ? 'warn' : 'warn',
                    ttl: 6000,
                  });
                }}
              >
                <KeyRound size={15} /> Host link
              </button>
            )}
            <button className="btn btn-secondary btn-small" onClick={exportAttendance}>
              <Download size={15} /> Attendance (CSV)
            </button>
            <button
              className="btn btn-secondary btn-small"
              onClick={() => {
                meeting.send({ t: 'spotlight', sessionId: null });
              }}
              disabled={!state.spotlight}
            >
              <Sparkles size={15} /> Clear spotlight
            </button>
          </div>
        </section>

        <section className="seats-section danger-zone">
          <button
            className="btn btn-ghost btn-small danger"
            disabled={reservedCount === 0}
            onClick={() => {
              if (confirm('Clear every seat reservation? People in the meeting stay where they are.'))
                meeting.send({ t: 'seats.clearAll' });
            }}
          >
            <Trash2 size={15} /> Clear all reservations
          </button>
          <span className="danger-note">
            {state.settings.locked ? <Lock size={13} /> : <Users size={13} />}
            {state.settings.locked ? 'Locked to class list' : 'Anyone with the link can join'}
          </span>
        </section>
      </div>

      {editing && (
        <SeatEditor
          key={editing.seat}
          seat={editing.seat}
          anchor={editing.anchor}
          cols={cols}
          reservedId={state.seats[editing.seat] ?? null}
          reservedName={(state.seats[editing.seat] && members.get(state.seats[editing.seat]!)?.name) || null}
          occupant={
            sittingAt.get(editing.seat)
              ? { memberId: sittingAt.get(editing.seat)!.memberId, name: sittingAt.get(editing.seat)!.name }
              : null
          }
          invite={state.seats[editing.seat] ? (hostData?.invites[state.seats[editing.seat]!] ?? null) : null}
          roomId={state.id}
          meeting={meeting}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
