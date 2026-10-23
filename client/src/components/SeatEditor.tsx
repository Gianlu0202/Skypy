import { useRef, useState, type FormEvent } from 'react';
import { Armchair, Link2, Trash2 } from 'lucide-react';
import { seatLabel } from '../../../shared/protocol.ts';
import { copyText, meetingUrl } from '../lib/format.ts';
import type { Meeting } from '../lib/meeting.ts';
import { toast } from '../lib/store.ts';
import { MenuItem, Popover } from './Controls.tsx';

/** Popover for editing one seat: reserve it by name, copy its link, free it. */
export function SeatEditor(props: {
  seat: number;
  anchor: HTMLElement;
  cols: number;
  reservedId: string | null;
  reservedName: string | null;
  /** Someone sitting here without owning the seat. */
  occupant?: { memberId: string; name: string } | null;
  invite: string | null;
  roomId: string;
  meeting: Meeting;
  onClose: () => void;
}) {
  const anchor = useRef<HTMLElement | null>(props.anchor);
  const [name, setName] = useState(props.reservedName ?? '');
  const label = seatLabel(props.seat, props.cols);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    props.meeting.send({ t: 'seat.name', seat: props.seat, name: name.trim() });
    props.onClose();
  };
  const occupant = props.occupant && props.occupant.memberId !== props.reservedId ? props.occupant : null;
  return (
    <Popover anchor={anchor} open onClose={props.onClose} placement="bottom" className="seat-editor">
      <div className="menu-title">
        Seat {label}
        {props.reservedName && <span className="menu-title-sub"> · {props.reservedName}</span>}
      </div>
      <form onSubmit={submit} className="seat-editor-form">
        <input
          className="input"
          autoFocus
          value={name}
          maxLength={48}
          placeholder="Reserve for… (type a name)"
          onChange={(e) => setName(e.target.value)}
          aria-label={`Name for seat ${label}`}
        />
        <button className="btn btn-primary btn-small" type="submit" disabled={!name.trim() || name.trim() === props.reservedName}>
          Save
        </button>
      </form>
      <p className="seat-editor-hint">Whoever joins with this name sits here automatically.</p>
      {occupant && (
        <MenuItem
          icon={<Armchair size={16} />}
          label={`Give this seat to ${occupant.name}`}
          hint="They’ll come back to it next time"
          onClick={() => {
            props.meeting.send({ t: 'seat.assign', memberId: occupant.memberId, seat: props.seat });
            props.onClose();
          }}
        />
      )}
      {props.reservedId && props.invite && (
        <MenuItem
          icon={<Link2 size={16} />}
          label="Copy personal link"
          hint={`Joins ${props.reservedName ?? 'them'} straight into ${label}`}
          onClick={async () => {
            const ok = await copyText(`${meetingUrl(props.roomId)}?invite=${props.invite}`);
            toast(ok ? 'Personal link copied.' : 'Couldn’t copy the link.', { tone: ok ? 'success' : 'warn' });
            props.onClose();
          }}
        />
      )}
      {props.reservedId && (
        <MenuItem
          icon={<Trash2 size={16} />}
          label="Free this seat"
          hint="Removes the reservation"
          danger
          onClick={() => {
            props.meeting.send({ t: 'seat.clear', seat: props.seat });
            props.onClose();
          }}
        />
      )}
    </Popover>
  );
}
