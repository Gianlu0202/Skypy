import { memo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ConnectionQuality, type Participant } from 'livekit-client';
import {
  Crown,
  Hand,
  MicOff,
  MoreHorizontal,
  Pin,
  PinOff,
  Sparkles,
  UserMinus,
  UserRoundCog,
  UserX,
  VolumeX,
  WifiLow,
  Armchair,
  X,
} from 'lucide-react';
import type { SessionView } from '../../../shared/protocol.ts';
import { cameraTrack, micMuted, useParticipant } from '../lib/hooks.ts';
import { currentMeeting } from '../lib/meeting.ts';
import { useStore } from '../lib/store.ts';
import { MenuDivider, MenuItem, Popover } from './Controls.tsx';
import { Avatar, VideoTrackView } from './Media.tsx';

export interface TileProps {
  x: number;
  y: number;
  w: number;
  h: number;
  session: SessionView | undefined;
  participant: Participant | undefined;
  identity: string;
  name: string;
  isLocal: boolean;
  seatText: string | null;
  handOrder: number | null;
  /** Viewer is a host. */
  canManage: boolean;
  arrange: boolean;
  dropTarget: boolean;
  dragging: boolean;
  mirror: boolean;
  spotlit: boolean;
  pinned: boolean;
  onDragStart?: (e: ReactPointerEvent, memberId: string, name: string) => void;
}

export const Tile = memo(function Tile(props: TileProps) {
  const { x, y, w, h, session, participant, isLocal, name } = props;
  useParticipant(participant);
  const cam = cameraTrack(participant);
  const muted = participant ? micMuted(participant) : false;
  const speaking = !!participant?.isSpeaking && !muted;
  const poor = participant?.connectionQuality === ConnectionQuality.Poor || participant?.connectionQuality === ConnectionQuality.Lost;
  const status = session?.away ? 'Reconnecting…' : !participant ? 'Connecting…' : null;
  const host = session?.host;

  const cls = [
    'tile',
    speaking && 'speaking',
    status && 'pending',
    props.arrange && props.canManage && session && 'grabbable',
    props.dropTarget && 'drop-target',
    props.dragging && 'is-dragging',
    w < 150 && 'tiny',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cls}
      style={{ transform: `translate3d(${x}px, ${y}px, 0)`, width: w, height: h }}
      data-identity={props.identity}
      onPointerDown={(e) => {
        if (props.arrange && props.canManage && session && props.onDragStart && e.button === 0) {
          props.onDragStart(e, session.memberId, name);
        }
      }}
      onDoubleClick={() => {
        if (props.arrange || !session) return;
        useStore.setState((s) => ({
          pinned: s.pinned === session.id ? null : session.id,
          stageKey: s.pinned === session.id ? null : `pin:${session.id}`,
        }));
      }}
    >
      {cam ? (
        <VideoTrackView track={cam} mirror={isLocal && props.mirror} />
      ) : (
        <div className="tile-avatar">
          <Avatar name={name} colorKey={session?.memberId ?? props.identity} />
        </div>
      )}
      {status && (
        <div className="tile-status">
          <span className="mini-spinner" />
          <span>{status}</span>
        </div>
      )}
      {session?.hand && (
        <div className="tile-hand" title="Hand raised">
          <Hand size={13} />
          {props.handOrder !== null && <span>{props.handOrder}</span>}
        </div>
      )}
      {props.seatText && <div className="tile-seat">{props.seatText}</div>}
      <div className="tile-name">
        {muted && <MicOff size={12} className="tile-muted" aria-label="Muted" />}
        {poor && <WifiLow size={12} className="tile-poor" aria-label="Weak connection" />}
        {host && <Crown size={11} className="tile-host" aria-label="Host" />}
        <span>
          {name}
          {isLocal && ' (You)'}
        </span>
      </div>
      {session && !props.arrange && <TileMenu {...props} session={session} />}
      {(props.spotlit || props.pinned) && (
        <div className="tile-flag" title={props.spotlit ? 'Spotlighted for everyone' : 'Pinned for you'}>
          {props.spotlit ? <Sparkles size={11} /> : <Pin size={11} />}
        </div>
      )}
    </div>
  );
});

function TileMenu(props: TileProps & { session: SessionView }) {
  const { session, canManage, isLocal, name } = props;
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const meeting = currentMeeting();
  const close = () => setOpen(false);
  const send = meeting ? meeting.send.bind(meeting) : () => false;

  return (
    <>
      <button
        ref={anchor}
        className={`tile-more${open ? ' open' : ''}`}
        aria-label={`Options for ${name}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <MoreHorizontal size={16} />
      </button>
      <Popover anchor={anchor} open={open} onClose={close} placement="bottom">
        <div className="menu-title">{name}</div>
        <MenuItem
          icon={props.pinned ? <PinOff size={16} /> : <Pin size={16} />}
          label={props.pinned ? 'Unpin' : 'Pin to the middle'}
          hint="Only for you"
          onClick={() => {
            useStore.setState((s) =>
              s.pinned === session.id ? { pinned: null, stageKey: null } : { pinned: session.id, stageKey: `pin:${session.id}` },
            );
            close();
          }}
        />
        {canManage && (
          <>
            <MenuItem
              icon={<Sparkles size={16} />}
              label={props.spotlit ? 'Remove spotlight' : 'Spotlight for everyone'}
              onClick={() => {
                send({ t: 'spotlight', sessionId: props.spotlit ? null : session.id });
                close();
              }}
            />
            <MenuItem
              icon={<Armchair size={16} />}
              label="Move to another seat"
              hint="Drag faces to swap seats"
              onClick={() => {
                useStore.setState({ arrange: true });
                close();
              }}
            />
            {!isLocal && (
              <MenuItem
                icon={<VolumeX size={16} />}
                label="Mute"
                onClick={() => {
                  send({ t: 'mute', sessionId: session.id });
                  close();
                }}
              />
            )}
            {session.hand && (
              <MenuItem
                icon={<X size={16} />}
                label="Lower hand"
                onClick={() => {
                  send({ t: 'hand.lower', sessionId: session.id });
                  close();
                }}
              />
            )}
            {!isLocal && (
              <MenuItem
                icon={session.host ? <UserMinus size={16} /> : <UserRoundCog size={16} />}
                label={session.host ? 'Remove co-host' : 'Make co-host'}
                onClick={() => {
                  send({ t: 'member.cohost', memberId: session.memberId, value: !session.host });
                  close();
                }}
              />
            )}
            {!isLocal && (
              <>
                <MenuDivider />
                <MenuItem
                  icon={<UserX size={16} />}
                  label="Remove from meeting"
                  danger
                  onClick={() => {
                    close();
                    if (confirm(`Remove ${name} from the meeting? They won’t be able to rejoin until this meeting ends.`)) {
                      send({ t: 'kick', sessionId: session.id });
                    }
                  }}
                />
              </>
            )}
          </>
        )}
      </Popover>
    </>
  );
}

export interface EmptySeatProps {
  x: number;
  y: number;
  w: number;
  h: number;
  seat: number;
  label: string;
  reservedName: string | null;
  reservedId: string | null;
  arrange: boolean;
  canManage: boolean;
  dropTarget: boolean;
  dragging: boolean;
  onDragStart?: (e: ReactPointerEvent, memberId: string, name: string) => void;
  onEdit?: (seat: number, anchor: HTMLElement) => void;
}

export const EmptySeat = memo(function EmptySeat(props: EmptySeatProps) {
  const { x, y, w, h, label, reservedName, reservedId, arrange, canManage } = props;
  const cls = [
    'seat',
    reservedName && 'reserved',
    props.dropTarget && 'drop-target',
    props.dragging && 'is-dragging',
    arrange && canManage && 'editable',
    w < 110 && 'tiny',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={cls}
      style={{ transform: `translate3d(${x}px, ${y}px, 0)`, width: w, height: h }}
      onPointerDown={(e) => {
        if (arrange && canManage && reservedId && reservedName && props.onDragStart && e.button === 0) {
          props.onDragStart(e, reservedId, reservedName);
        }
      }}
      onClick={(e) => {
        if (arrange && canManage && props.onEdit) props.onEdit(props.seat, e.currentTarget);
      }}
      title={reservedName ? `${label} · ${reservedName} (not here)` : `Seat ${label}`}
    >
      <span className="seat-label">{label}</span>
      {reservedName && <span className="seat-name">{reservedName}</span>}
    </div>
  );
});
