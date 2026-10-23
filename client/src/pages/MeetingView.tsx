import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Canvas } from '../components/Canvas.tsx';
import { ChatPanel } from '../components/ChatPanel.tsx';
import { Banners, SettingsDialog, ShortcutsDialog, Toasts } from '../components/Overlays.tsx';
import { PeoplePanel } from '../components/PeoplePanel.tsx';
import { SeatsPanel } from '../components/SeatsPanel.tsx';
import { Toolbar } from '../components/Toolbar.tsx';
import { currentMeeting } from '../lib/meeting.ts';
import { setPanel, setUi, useStore } from '../lib/store.ts';

const PANEL_TITLES = { people: 'People', chat: 'Chat', seats: 'Seats & room' } as const;

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export function MeetingView() {
  const meeting = currentMeeting();
  const state = useStore((s) => s.state);
  const panel = useStore((s) => s.panel);
  const host = useStore((s) => s.host);
  const signal = useStore((s) => s.signal);
  const [settings, setSettings] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);

  useEffect(() => {
    if (state?.name) document.title = `${state.name} · Skypy`;
  }, [state?.name]);

  useEffect(() => {
    if (!meeting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || isTyping(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        // Meet-style: Ctrl/⌘+D mic, Ctrl/⌘+E camera.
        if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'd' || e.key === 'D')) {
          e.preventDefault();
          void meeting.toggleMic();
        } else if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'e' || e.key === 'E')) {
          e.preventDefault();
          void meeting.toggleCam();
        }
        return;
      }
      switch (e.key.toLowerCase()) {
        case 'm':
          void meeting.toggleMic();
          break;
        case 'v':
          void meeting.toggleCam();
          break;
        case 'h': {
          const s = useStore.getState();
          const me = s.state?.sessions.find((x) => x.id === s.sessionId);
          meeting.send({ t: 'hand', raised: !me?.hand });
          break;
        }
        case 'c':
          setPanel('chat');
          break;
        case 'p':
          setPanel('people');
          break;
        case 'e':
          setUi({ showEmpty: !useStore.getState().ui.showEmpty });
          break;
        case 'escape':
          if (useStore.getState().arrange) useStore.setState({ arrange: false });
          else if (useStore.getState().panel) useStore.setState({ panel: null });
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [meeting]);

  if (!meeting) return null;

  if (!state) {
    return (
      <div className="loading-page">
        <div className="spinner" />
        <p>{signal === 'reconnecting' ? 'Can’t reach Skypy yet — still trying…' : 'Joining…'}</p>
        <button className="btn btn-ghost btn-small" onClick={() => meeting.leave('left')}>
          Cancel
        </button>
      </div>
    );
  }

  const panelOpen = panel && (panel !== 'seats' || host);

  return (
    <div className="meeting">
      <div className={`meeting-body${panelOpen ? ' with-panel' : ''}`}>
        <Canvas meeting={meeting} />
        {panelOpen && (
          <aside className="drawer" aria-label={PANEL_TITLES[panel]}>
            <header className="drawer-head">
              <h2>{PANEL_TITLES[panel]}</h2>
              <button className="icon-btn" onClick={() => useStore.setState({ panel: null })} aria-label="Close panel">
                <X size={18} />
              </button>
            </header>
            {panel === 'people' && <PeoplePanel meeting={meeting} />}
            {panel === 'chat' && <ChatPanel meeting={meeting} />}
            {panel === 'seats' && <SeatsPanel meeting={meeting} />}
          </aside>
        )}
      </div>
      <Toolbar meeting={meeting} onSettings={() => setSettings(true)} onShortcuts={() => setShortcuts(true)} />
      <Banners meeting={meeting} />
      <Toasts />
      {settings && <SettingsDialog meeting={meeting} onClose={() => setSettings(false)} />}
      {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
    </div>
  );
}
