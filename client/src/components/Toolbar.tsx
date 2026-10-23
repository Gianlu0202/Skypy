import { useEffect, useRef, useState } from 'react';
import { RoomEvent } from 'livekit-client';
import {
  Armchair,
  ChevronUp,
  Columns3,
  Expand,
  Grid3x3,
  Hand,
  Keyboard,
  LayoutGrid,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MoreVertical,
  PhoneOff,
  Rows3,
  Settings,
  Smile,
  Users,
  Video,
  VideoOff,
  Wand2,
  Check,
  Link2,
} from 'lucide-react';
import { REACTIONS } from '../../../shared/protocol.ts';
import { copyText, formatClock, formatDuration, meetingUrl } from '../lib/format.ts';
import { useNow, useRoomEvents } from '../lib/hooks.ts';
import type { Meeting } from '../lib/meeting.ts';
import { setPanel, setUi, toast, useStore } from '../lib/store.ts';
import type { LayoutPref } from '../lib/storage.ts';
import { MenuDivider, MenuItem, MenuLabel, Popover } from './Controls.tsx';
import { supportsSpeakerSelection } from '../pages/PreJoin.tsx';

const LAYOUT_NAMES: Record<string, string> = { auto: 'Automatic', sides: 'Side columns', stacked: 'Top & bottom' };

export function Toolbar(props: { meeting: Meeting; onSettings: () => void; onShortcuts: () => void }) {
  const { meeting } = props;
  const mic = useStore((s) => s.mic);
  const cam = useStore((s) => s.cam);
  const sharing = useStore((s) => s.sharing);
  const panel = useStore((s) => s.panel);
  const unread = useStore((s) => s.unread);
  const host = useStore((s) => s.host);
  const state = useStore((s) => s.state);
  const sessionId = useStore((s) => s.sessionId);
  const media = useStore((s) => s.media);
  const me = state?.sessions.find((s) => s.id === sessionId);
  const handUp = !!me?.hand;
  const handsUp = state?.sessions.filter((s) => s.hand).length ?? 0;
  const canShare = !state || state.settings.screenShare === 'everyone' || host;
  const shareSupported = !!navigator.mediaDevices?.getDisplayMedia;
  const mediaReady = media === 'connected';

  return (
    <footer className="toolbar">
      <div className="tb-left">
        <MeetingClock />
        <span className="tb-sep" />
        <span className="tb-room" title={state?.name}>
          {state?.name}
        </span>
        <InviteButton roomId={state?.id ?? ''} />
      </div>

      <div className="tb-center">
        <div className="tb-split">
          <button
            className={`tb-btn${mic ? '' : ' off'}`}
            onClick={() => void meeting.toggleMic()}
            aria-label={mic ? 'Mute microphone (M)' : 'Unmute microphone (M)'}
            data-tip={mic ? 'Mute · M' : 'Unmute · M'}
            aria-pressed={!mic}
          >
            {mic ? <Mic size={20} /> : <MicOff size={20} />}
          </button>
          <DeviceMenu meeting={meeting} kinds={['audioinput', 'audiooutput']} label="Audio settings" />
        </div>
        <div className="tb-split">
          <button
            className={`tb-btn${cam ? '' : ' off'}`}
            onClick={() => void meeting.toggleCam()}
            aria-label={cam ? 'Turn camera off (V)' : 'Turn camera on (V)'}
            data-tip={cam ? 'Stop video · V' : 'Start video · V'}
            aria-pressed={!cam}
          >
            {cam ? <Video size={20} /> : <VideoOff size={20} />}
          </button>
          <DeviceMenu meeting={meeting} kinds={['videoinput']} label="Video settings" />
        </div>
        {shareSupported && (
          <button
            className={`tb-btn${sharing ? ' active' : ''}`}
            onClick={() => void meeting.toggleShare()}
            aria-label={sharing ? 'Stop presenting' : 'Share screen'}
            data-tip={!canShare ? 'Only hosts can share' : sharing ? 'Stop presenting' : 'Share screen'}
            disabled={(!canShare && !sharing) || (!mediaReady && !sharing)}
          >
            <MonitorUp size={20} />
          </button>
        )}
        <button
          className={`tb-btn${handUp ? ' raised' : ''}`}
          onClick={() => meeting.send({ t: 'hand', raised: !handUp })}
          aria-label={handUp ? 'Lower hand (H)' : 'Raise hand (H)'}
          data-tip={handUp ? 'Lower hand · H' : 'Raise hand · H'}
          aria-pressed={handUp}
        >
          <Hand size={20} />
        </button>
        <ReactionPicker meeting={meeting} />
        <MoreMenu {...props} />
        <button className="tb-leave" onClick={() => meeting.leave('left')} aria-label="Leave meeting" data-tip="Leave">
          <PhoneOff size={20} />
        </button>
      </div>

      <div className="tb-right">
        <button
          className={`tb-icon${panel === 'people' ? ' on' : ''}`}
          onClick={() => setPanel('people')}
          aria-label="People"
          data-tip="People · P"
        >
          <Users size={20} />
          <span className="tb-count">{state?.sessions.length ?? 0}</span>
          {host && handsUp > 0 && <span className="tb-badge hand">{handsUp}</span>}
        </button>
        <button
          className={`tb-icon${panel === 'chat' ? ' on' : ''}`}
          onClick={() => setPanel('chat')}
          aria-label="Chat"
          data-tip="Chat · C"
        >
          <MessageSquare size={20} />
          {unread > 0 && <span className="tb-badge">{unread > 9 ? '9+' : unread}</span>}
        </button>
        {host && (
          <button
            className={`tb-icon${panel === 'seats' ? ' on' : ''}`}
            onClick={() => setPanel('seats')}
            aria-label="Seating & room settings"
            data-tip="Seats & settings"
          >
            <Armchair size={20} />
          </button>
        )}
      </div>
    </footer>
  );
}

function MeetingClock() {
  const now = useNow(1000);
  const startedAt = useStore((s) => s.state?.startedAt);
  const offset = useStore((s) => s.clockOffset);
  return (
    <span className="tb-clock">
      <span>{formatClock(now)}</span>
      {startedAt ? <span className="tb-elapsed">{formatDuration(now + offset - startedAt)}</span> : null}
    </span>
  );
}

function InviteButton({ roomId }: { roomId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="tb-invite"
      onClick={async () => {
        if (await copyText(meetingUrl(roomId))) {
          setCopied(true);
          toast('Meeting link copied. Anyone with the link can join.', { tone: 'success', ttl: 2500 });
          window.setTimeout(() => setCopied(false), 1800);
        }
      }}
      data-tip="Copy meeting link"
      aria-label="Copy meeting link"
    >
      {copied ? <Check size={15} /> : <Link2 size={15} />}
    </button>
  );
}

function DeviceMenu(props: { meeting: Meeting; kinds: MediaDeviceKind[]; label: string }) {
  const { meeting, kinds } = props;
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const anchor = useRef<HTMLButtonElement>(null);
  useRoomEvents(meeting.room, [RoomEvent.ActiveDeviceChanged, RoomEvent.MediaDevicesChanged]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((list) => {
        if (!cancelled) setDevices(list.filter((d) => d.deviceId && kinds.includes(d.kind)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  const titles: Record<string, string> = { audioinput: 'Microphone', audiooutput: 'Speakers', videoinput: 'Camera' };
  return (
    <>
      <button
        ref={anchor}
        className={`tb-caret${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={props.label}
        data-tip={props.label}
      >
        <ChevronUp size={14} />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} placement="top" className="device-menu">
        {kinds.map((kind) => {
          if (kind === 'audiooutput' && !supportsSpeakerSelection) return null;
          const list = devices.filter((d) => d.kind === kind);
          const activeId = meeting.room.getActiveDevice(kind) ?? 'default';
          return (
            <div key={kind}>
              <MenuLabel>{titles[kind]}</MenuLabel>
              {list.length === 0 && <div className="menu-empty">No {titles[kind].toLowerCase()} found</div>}
              {list.map((d, i) => (
                <MenuItem
                  key={d.deviceId}
                  label={d.label || `${titles[kind]} ${i + 1}`}
                  checked={d.deviceId === activeId}
                  onClick={() => {
                    void meeting.switchDevice(kind, d.deviceId);
                    setOpen(false);
                  }}
                />
              ))}
            </div>
          );
        })}
      </Popover>
    </>
  );
}

function ReactionPicker({ meeting }: { meeting: Meeting }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={anchor}
        className={`tb-btn${open ? ' active-soft' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Send a reaction"
        data-tip="React"
      >
        <Smile size={20} />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} placement="top" className="reaction-menu">
        {REACTIONS.map((emoji) => (
          <button key={emoji} className="reaction-btn" onClick={() => meeting.send({ t: 'react', emoji })} aria-label={`React ${emoji}`}>
            {emoji}
          </button>
        ))}
      </Popover>
    </>
  );
}

function MoreMenu(props: { meeting: Meeting; onSettings: () => void; onShortcuts: () => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const ui = useStore((s) => s.ui);
  const host = useStore((s) => s.host);
  const arrange = useStore((s) => s.arrange);
  const roomLayout = useStore((s) => s.state?.settings.layout ?? 'auto');
  const close = () => setOpen(false);
  const pick = (layout: LayoutPref) => {
    setUi({ layout });
    close();
  };
  const fullscreen = async () => {
    close();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      /* not allowed */
    }
  };
  return (
    <>
      <button
        ref={anchor}
        className={`tb-btn${open ? ' active-soft' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="More options"
        data-tip="More"
      >
        <MoreVertical size={20} />
      </button>
      <Popover anchor={anchor} open={open} onClose={close} placement="top" className="more-menu">
        <MenuLabel>When someone shares</MenuLabel>
        <MenuItem
          icon={<Wand2 size={16} />}
          label="Same as host"
          hint={LAYOUT_NAMES[roomLayout]}
          checked={ui.layout === 'room'}
          onClick={() => pick('room')}
        />
        <MenuItem
          icon={<LayoutGrid size={16} />}
          label="Automatic"
          hint="Fit to my window"
          checked={ui.layout === 'auto'}
          onClick={() => pick('auto')}
        />
        <MenuItem icon={<Columns3 size={16} />} label="Faces on the sides" checked={ui.layout === 'sides'} onClick={() => pick('sides')} />
        <MenuItem
          icon={<Rows3 size={16} />}
          label="Faces above & below"
          checked={ui.layout === 'stacked'}
          onClick={() => pick('stacked')}
        />
        <MenuDivider />
        <MenuItem
          icon={<Grid3x3 size={16} />}
          label="Show empty seats"
          hint="Keeps every seat in its place"
          checked={ui.showEmpty}
          onClick={() => setUi({ showEmpty: !ui.showEmpty })}
        />
        {host && (
          <MenuItem
            icon={<Armchair size={16} />}
            label="Arrange seats"
            hint="Drag faces to move people"
            checked={arrange}
            onClick={() => {
              useStore.setState({ arrange: !arrange });
              close();
            }}
          />
        )}
        <MenuDivider />
        <MenuItem
          icon={<Expand size={16} />}
          label={document.fullscreenElement ? 'Exit full screen' : 'Full screen'}
          onClick={() => void fullscreen()}
        />
        <MenuItem
          icon={<Settings size={16} />}
          label="Settings"
          onClick={() => {
            close();
            props.onSettings();
          }}
        />
        <MenuItem
          icon={<Keyboard size={16} />}
          label="Keyboard shortcuts"
          onClick={() => {
            close();
            props.onShortcuts();
          }}
        />
      </Popover>
    </>
  );
}
