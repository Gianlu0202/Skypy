import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Hand, Info, Loader2, MessageSquare, Mic, Video, Volume2, VolumeX, WifiOff, X } from 'lucide-react';
import { LIMITS } from '../../../shared/protocol.ts';
import type { Meeting } from '../lib/meeting.ts';
import { saveName } from '../lib/storage.ts';
import { dismissToast, setUi, toast, useStore } from '../lib/store.ts';
import { playTestSound, supportsSpeakerSelection } from '../pages/PreJoin.tsx';
import { Switch } from './Controls.tsx';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <span className="toast-icon">
            {t.icon === 'chat' ? (
              <MessageSquare size={17} />
            ) : t.icon === 'hand' ? (
              <Hand size={17} className="toast-hand" />
            ) : t.tone === 'success' ? (
              <CircleCheck size={17} />
            ) : t.tone === 'warn' || t.tone === 'error' ? (
              <CircleAlert size={17} />
            ) : (
              <Info size={17} />
            )}
          </span>
          <div className="toast-body">
            {t.title && <b>{t.title}</b>}
            <span>{t.text}</span>
          </div>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="toast-close" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Banners({ meeting }: { meeting: Meeting }) {
  const signal = useStore((s) => s.signal);
  const media = useStore((s) => s.media);
  const audioBlocked = useStore((s) => s.audioBlocked);
  const items: ReactNode[] = [];
  if (signal === 'reconnecting') {
    items.push(
      <div className="banner warn" key="signal">
        <WifiOff size={16} /> Connection lost — reconnecting…
      </div>,
    );
  }
  if (media === 'connecting') {
    items.push(
      <div className="banner" key="media">
        <Loader2 size={16} className="spin" /> Connecting audio and video…
      </div>,
    );
  } else if (media === 'reconnecting' && signal !== 'reconnecting') {
    items.push(
      <div className="banner warn" key="media">
        <Loader2 size={16} className="spin" /> Reconnecting audio and video…
      </div>,
    );
  } else if (media === 'failed') {
    items.push(
      <div className="banner bad" key="media">
        <WifiOff size={16} /> Audio and video are disconnected. Retrying…
        <button className="banner-btn" onClick={() => meeting.retryMedia()}>
          Retry now
        </button>
      </div>,
    );
  }
  if (audioBlocked) {
    items.push(
      <div className="banner" key="audio">
        <VolumeX size={16} /> Your browser paused the meeting sound.
        <button className="banner-btn" onClick={() => void meeting.enableAudio()}>
          Turn on sound
        </button>
      </div>,
    );
  }
  if (items.length === 0) return null;
  return <div className="banners">{items}</div>;
}

export function Dialog(props: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div
        className={`dialog${props.wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        ref={ref}
        tabIndex={-1}
      >
        <header className="dialog-head">
          <h2>{props.title}</h2>
          <button className="icon-btn" onClick={props.onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="dialog-body">{props.children}</div>
      </div>
    </div>
  );
}

export function SettingsDialog({ meeting, onClose }: { meeting: Meeting; onClose: () => void }) {
  const state = useStore((s) => s.state);
  const sessionId = useStore((s) => s.sessionId);
  const ui = useStore((s) => s.ui);
  const me = state?.sessions.find((s) => s.id === sessionId);
  const [name, setName] = useState(me?.name ?? '');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [active, setActive] = useState<Record<string, string>>({});

  useEffect(() => {
    const load = () =>
      navigator.mediaDevices
        ?.enumerateDevices()
        .then((list) => setDevices(list.filter((d) => d.deviceId)))
        .catch(() => {});
    void load();
    const room = meeting.room;
    setActive({
      videoinput: room.getActiveDevice('videoinput') ?? '',
      audioinput: room.getActiveDevice('audioinput') ?? '',
      audiooutput: room.getActiveDevice('audiooutput') ?? '',
    });
    navigator.mediaDevices?.addEventListener?.('devicechange', load);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', load);
  }, [meeting]);

  const rename = (e: FormEvent) => {
    e.preventDefault();
    const clean = name.trim().slice(0, LIMITS.nameLength);
    if (!clean || clean === me?.name) return;
    meeting.rename(clean);
    saveName(clean);
    toast('Name updated.', { tone: 'success', ttl: 2000 });
  };

  const select = (kind: MediaDeviceKind, label: string, icon: ReactNode) => {
    const list = devices.filter((d) => d.kind === kind);
    return (
      <label className="field">
        <span className="field-label">{label}</span>
        <span className="device-select wide">
          {icon}
          <select
            value={active[kind] ?? ''}
            disabled={list.length === 0}
            onChange={(e) => {
              setActive((a) => ({ ...a, [kind]: e.target.value }));
              void meeting.switchDevice(kind, e.target.value);
            }}
          >
            {list.length === 0 && <option value="">None found</option>}
            {!list.some((d) => d.deviceId === active[kind]) && list.length > 0 && <option value="">System default</option>}
            {list.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `${label} ${i + 1}`}
              </option>
            ))}
          </select>
        </span>
      </label>
    );
  };

  return (
    <Dialog title="Settings" onClose={onClose}>
      <form className="field" onSubmit={rename}>
        <span className="field-label">Your name</span>
        <div className="inline-form">
          <input className="input" value={name} maxLength={LIMITS.nameLength} onChange={(e) => setName(e.target.value)} />
          <button className="btn btn-secondary" type="submit" disabled={!name.trim() || name.trim() === me?.name}>
            Save
          </button>
        </div>
      </form>
      {select('videoinput', 'Camera', <Video size={15} />)}
      {select('audioinput', 'Microphone', <Mic size={15} />)}
      {supportsSpeakerSelection && select('audiooutput', 'Speakers', <Volume2 size={15} />)}
      <button className="btn btn-ghost btn-small" onClick={() => void playTestSound(active.audiooutput || undefined)}>
        <Volume2 size={15} /> Play test sound
      </button>
      <div className="dialog-sep" />
      <Switch
        label="Mirror my video"
        hint="Only affects how you see yourself."
        checked={ui.mirror}
        onChange={(v) => setUi({ mirror: v })}
      />
      <Switch
        label="Show empty seats"
        hint="Keep every seat in place so faces never shift around."
        checked={ui.showEmpty}
        onChange={(v) => setUi({ showEmpty: v })}
      />
    </Dialog>
  );
}

const SHORTCUTS: [string, string][] = [
  ['M', 'Mute / unmute microphone'],
  ['V', 'Turn camera on / off'],
  ['H', 'Raise / lower hand'],
  ['C', 'Open chat'],
  ['P', 'Open people'],
  ['E', 'Show / hide empty seats'],
  ['Double-click a face', 'Pin it to the middle (just for you)'],
  ['Esc', 'Close panels and menus'],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      <ul className="shortcuts">
        {SHORTCUTS.map(([k, d]) => (
          <li key={k}>
            <kbd>{k}</kbd>
            <span>{d}</span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
