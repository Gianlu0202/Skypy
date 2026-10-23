import { useMemo, useRef, useState } from 'react';
import type { Participant } from 'livekit-client';
import {
  Crown,
  Hand,
  Link2,
  Mic,
  MicOff,
  MoreHorizontal,
  Search,
  Sparkles,
  UserMinus,
  UserRoundCog,
  UserX,
  VolumeX,
  X,
} from 'lucide-react';
import { normalizeName, seatLabel, type SessionView } from '../../../shared/protocol.ts';
import { copyText, meetingUrl } from '../lib/format.ts';
import { micMuted, useParticipant, useRoomEvents } from '../lib/hooks.ts';
import type { Meeting } from '../lib/meeting.ts';
import { toast, useStore } from '../lib/store.ts';
import { RoomEvent } from 'livekit-client';
import { MenuDivider, MenuItem, Popover } from './Controls.tsx';
import { Avatar } from './Media.tsx';

export function PeoplePanel({ meeting }: { meeting: Meeting }) {
  const state = useStore((s) => s.state)!;
  const host = useStore((s) => s.host);
  const hostData = useStore((s) => s.hostData);
  const sessionId = useStore((s) => s.sessionId);
  const [query, setQuery] = useState('');
  useRoomEvents(meeting.room, [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.ConnectionStateChanged]);

  const participants = new Map<string, Participant>();
  for (const p of meeting.room.remoteParticipants.values()) participants.set(p.identity, p);
  participants.set(meeting.room.localParticipant.identity, meeting.room.localParticipant);

  const cols = state.settings.cols;
  const q = normalizeName(query);
  const match = (name: string) => !q || normalizeName(name).includes(q);

  const hands = state.sessions.filter((s) => s.hand).sort((a, b) => a.hand! - b.hand!);
  const present = useMemo(
    () =>
      [...state.sessions].sort((a, b) => {
        if (a.id === sessionId) return -1;
        if (b.id === sessionId) return 1;
        return (a.seat ?? 999) - (b.seat ?? 999) || a.name.localeCompare(b.name);
      }),
    [state.sessions, sessionId],
  );
  const online = new Set(state.sessions.map((s) => s.memberId));
  const absent = state.seats
    .map((memberId, seat) => ({ memberId, seat }))
    .filter((x): x is { memberId: string; seat: number } => !!x.memberId && !online.has(x.memberId))
    .map((x) => ({ ...x, name: state.members.find((m) => m.id === x.memberId)?.name ?? 'Unknown' }));

  return (
    <div className="panel">
      <div className="panel-tools">
        <button
          className="btn btn-secondary btn-small"
          onClick={async () => {
            const ok = await copyText(meetingUrl(state.id));
            toast(ok ? 'Meeting link copied.' : 'Couldn’t copy the link.', { tone: ok ? 'success' : 'warn', ttl: 2500 });
          }}
        >
          <Link2 size={15} /> Copy invite link
        </button>
        {host && (
          <button
            className="btn btn-ghost btn-small"
            onClick={() => {
              meeting.send({ t: 'muteAll' });
              toast('Muted everyone except hosts.');
            }}
          >
            <VolumeX size={15} /> Mute all
          </button>
        )}
      </div>

      <label className="search">
        <Search size={15} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people" aria-label="Search people" />
        {query && (
          <button onClick={() => setQuery('')} aria-label="Clear search">
            <X size={14} />
          </button>
        )}
      </label>

      <div className="panel-scroll">
        {hands.length > 0 && (
          <section className="people-section">
            <header>
              <span>Raised hands · {hands.length}</span>
              {host && (
                <button className="link-btn" onClick={() => meeting.send({ t: 'hand.lower', sessionId: 'all' })}>
                  Lower all
                </button>
              )}
            </header>
            {hands
              .filter((s) => match(s.name))
              .map((s, i) => (
                <div className="person hand-row" key={s.id}>
                  <span className="hand-num">{i + 1}</span>
                  <Hand size={15} className="hand-icon" />
                  <span className="person-name">{s.id === sessionId ? `${s.name} (You)` : s.name}</span>
                  {(host || s.id === sessionId) && (
                    <button className="btn btn-ghost btn-small" onClick={() => meeting.send({ t: 'hand.lower', sessionId: s.id })}>
                      Lower
                    </button>
                  )}
                </div>
              ))}
          </section>
        )}

        <section className="people-section">
          <header>
            <span>In the meeting · {state.sessions.length}</span>
          </header>
          {present
            .filter((s) => match(s.name))
            .map((s) => (
              <PersonRow
                key={s.id}
                session={s}
                participant={participants.get(s.id)}
                isMe={s.id === sessionId}
                seat={s.seat !== null && s.seat < state.seats.length ? seatLabel(s.seat, cols) : 'Extra'}
                canManage={host}
                spotlit={state.spotlight === s.id}
                invite={hostData?.invites[s.memberId] ?? null}
                roomId={state.id}
                meeting={meeting}
              />
            ))}
        </section>

        {host && absent.length > 0 && (
          <section className="people-section">
            <header>
              <span>Not here · {absent.length}</span>
            </header>
            {absent
              .filter((a) => match(a.name))
              .map((a) => (
                <div className="person absent" key={a.memberId}>
                  <Avatar name={a.name} colorKey={a.memberId} />
                  <span className="person-name">{a.name}</span>
                  <span className="person-seat">{seatLabel(a.seat, cols)}</span>
                  {hostData?.invites[a.memberId] && (
                    <button
                      className="icon-btn"
                      aria-label={`Copy ${a.name}’s personal link`}
                      data-tip="Copy personal link"
                      onClick={async () => {
                        const ok = await copyText(`${meetingUrl(state.id)}?invite=${hostData.invites[a.memberId]}`);
                        toast(ok ? `Copied ${a.name}’s personal link.` : 'Couldn’t copy the link.', { tone: ok ? 'success' : 'warn' });
                      }}
                    >
                      <Link2 size={15} />
                    </button>
                  )}
                </div>
              ))}
          </section>
        )}
      </div>
    </div>
  );
}

function PersonRow(props: {
  session: SessionView;
  participant: Participant | undefined;
  isMe: boolean;
  seat: string;
  canManage: boolean;
  spotlit: boolean;
  invite: string | null;
  roomId: string;
  meeting: Meeting;
}) {
  const { session, participant, isMe, canManage, meeting } = props;
  useParticipant(participant);
  const muted = participant ? micMuted(participant) : true;
  const speaking = !!participant?.isSpeaking && !muted;
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);

  return (
    <div className={`person${speaking ? ' speaking' : ''}`}>
      <Avatar name={session.name} colorKey={session.memberId} />
      <span className="person-name">
        {session.name}
        {isMe && <em> (You)</em>}
        {session.host && <Crown size={12} className="person-crown" aria-label="Host" />}
        {session.away && <small className="person-away">reconnecting</small>}
      </span>
      <span className="person-seat">{props.seat}</span>
      <span className={`person-mic${muted ? ' muted' : ''}`} aria-label={muted ? 'Muted' : 'Microphone on'}>
        {muted ? <MicOff size={15} /> : <Mic size={15} />}
      </span>
      {canManage && (
        <>
          <button ref={anchor} className="icon-btn" aria-label={`Options for ${session.name}`} onClick={() => setOpen((v) => !v)}>
            <MoreHorizontal size={16} />
          </button>
          <Popover anchor={anchor} open={open} onClose={close} placement="left">
            <MenuItem
              icon={<Sparkles size={16} />}
              label={props.spotlit ? 'Remove spotlight' : 'Spotlight for everyone'}
              onClick={() => {
                meeting.send({ t: 'spotlight', sessionId: props.spotlit ? null : session.id });
                close();
              }}
            />
            {!isMe && !muted && (
              <MenuItem
                icon={<VolumeX size={16} />}
                label="Mute"
                onClick={() => {
                  meeting.send({ t: 'mute', sessionId: session.id });
                  close();
                }}
              />
            )}
            {props.invite && (
              <MenuItem
                icon={<Link2 size={16} />}
                label="Copy personal link"
                hint="Always joins into their seat"
                onClick={async () => {
                  const ok = await copyText(`${meetingUrl(props.roomId)}?invite=${props.invite}`);
                  toast(ok ? `Copied ${session.name}’s personal link.` : 'Couldn’t copy the link.', { tone: ok ? 'success' : 'warn' });
                  close();
                }}
              />
            )}
            {!isMe && (
              <MenuItem
                icon={session.host ? <UserMinus size={16} /> : <UserRoundCog size={16} />}
                label={session.host ? 'Remove co-host' : 'Make co-host'}
                onClick={() => {
                  meeting.send({ t: 'member.cohost', memberId: session.memberId, value: !session.host });
                  close();
                }}
              />
            )}
            {!isMe && (
              <>
                <MenuDivider />
                <MenuItem
                  icon={<UserX size={16} />}
                  label="Remove from meeting"
                  danger
                  onClick={() => {
                    close();
                    if (confirm(`Remove ${session.name} from the meeting? They won’t be able to rejoin until this meeting ends.`)) {
                      meeting.send({ t: 'kick', sessionId: session.id });
                    }
                  }}
                />
              </>
            )}
          </Popover>
        </>
      )}
    </div>
  );
}
