import { useRef, useState } from 'react';
import type { Participant } from 'livekit-client';
import { Maximize2, Minimize2, MonitorUp, Pin, PinOff, Sparkles, MonitorX } from 'lucide-react';
import type { Rect } from '../lib/layout.ts';
import { cameraTrack, screenTrack, useParticipant } from '../lib/hooks.ts';
import { currentMeeting } from '../lib/meeting.ts';
import { useStore } from '../lib/store.ts';
import { Avatar, VideoTrackView } from './Media.tsx';

export interface StageItem {
  key: string;
  kind: 'share' | 'spotlight' | 'pin';
  identity: string;
  name: string;
  participant: Participant | undefined;
  local: boolean;
}

function chipLabel(item: StageItem): string {
  if (item.kind === 'share') return item.local ? 'You’re presenting' : `${item.name} is presenting`;
  if (item.kind === 'spotlight') return `Spotlight · ${item.name}`;
  return `Pinned for you · ${item.name}`;
}

export function Stage(props: { rect: Rect; item: StageItem; items: StageItem[]; mirror: boolean }) {
  const { rect, item, items } = props;
  useParticipant(item.participant);
  const ref = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState(false);
  const [full, setFull] = useState(false);

  const toggleFull = async () => {
    const el = ref.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setFull(false);
      } else {
        await el.requestFullscreen();
        setFull(true);
        const off = () => {
          if (!document.fullscreenElement) {
            setFull(false);
            document.removeEventListener('fullscreenchange', off);
          }
        };
        document.addEventListener('fullscreenchange', off);
      }
    } catch {
      /* fullscreen not allowed */
    }
  };

  let content;
  if (item.kind === 'share') {
    const track = screenTrack(item.participant);
    if (item.local) {
      content = (
        <div className="stage-self">
          <div className="stage-self-icon">
            <MonitorUp size={26} />
          </div>
          <h3>You’re presenting to everyone</h3>
          <p>Your screen is in the middle for the whole class, with every face still around it.</p>
          <div className="stage-self-actions">
            <button className="btn btn-danger" onClick={() => void currentMeeting()?.toggleShare()}>
              <MonitorX size={17} /> Stop presenting
            </button>
            {track && (
              <button className="btn btn-ghost" onClick={() => setPreview((v) => !v)}>
                {preview ? 'Hide preview' : 'Show preview'}
              </button>
            )}
          </div>
          {preview && track && (
            <div className="stage-self-preview">
              <VideoTrackView track={track} fit="contain" />
            </div>
          )}
        </div>
      );
    } else if (track) {
      content = <VideoTrackView track={track} fit="contain" className="stage-video" />;
    } else {
      content = (
        <div className="stage-wait">
          <span className="spinner" />
          <span>Loading {item.name}’s screen…</span>
        </div>
      );
    }
  } else {
    const track = cameraTrack(item.participant);
    content = track ? (
      <VideoTrackView track={track} fit="contain" mirror={item.local && props.mirror} className="stage-video" />
    ) : (
      <div className="stage-wait">
        <Avatar name={item.name} colorKey={item.identity} className="avatar-xl" />
        <span>{item.name}’s camera is off</span>
      </div>
    );
  }

  return (
    <div ref={ref} className={`stage stage-${item.kind}`} style={{ transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`, width: rect.w, height: rect.h }}>
      {content}
      <div className="stage-bar">
        <span className="stage-chip">
          {item.kind === 'share' ? <MonitorUp size={14} /> : item.kind === 'spotlight' ? <Sparkles size={14} /> : <Pin size={14} />}
          <span>{chipLabel(item)}</span>
        </span>
        {items.length > 1 && (
          <div className="stage-tabs" role="tablist" aria-label="What’s in the middle">
            {items.map((i) => (
              <button
                key={i.key}
                role="tab"
                aria-selected={i.key === item.key}
                className={i.key === item.key ? 'on' : ''}
                onClick={() => useStore.setState({ stageKey: i.key })}
              >
                {i.kind === 'share' ? <MonitorUp size={12} /> : i.kind === 'spotlight' ? <Sparkles size={12} /> : <Pin size={12} />}
                {i.local ? 'You' : i.name.split(' ')[0]}
              </button>
            ))}
          </div>
        )}
        <span className="stage-spacer" />
        {item.kind === 'pin' && (
          <button className="stage-btn" onClick={() => useStore.setState({ pinned: null, stageKey: null })} aria-label="Unpin">
            <PinOff size={15} />
          </button>
        )}
        <button className="stage-btn" onClick={() => void toggleFull()} aria-label={full ? 'Exit full screen' : 'Full screen'}>
          {full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>
    </div>
  );
}
