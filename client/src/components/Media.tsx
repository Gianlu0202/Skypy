import { useEffect, useRef, type CSSProperties } from 'react';
import type { VideoTrack } from 'livekit-client';
import { avatarGradient, initials } from '../lib/format.ts';

export function VideoTrackView(props: { track: VideoTrack; mirror?: boolean; fit?: 'cover' | 'contain'; className?: string }) {
  const { track, mirror, fit = 'cover', className } = props;
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  const style: CSSProperties = { objectFit: fit };
  if (mirror) style.transform = 'scaleX(-1)';
  return <video ref={ref} className={className} style={style} autoPlay playsInline muted disablePictureInPicture />;
}

export function Avatar(props: { name: string; colorKey: string; className?: string }) {
  return (
    <div className={`avatar ${props.className ?? ''}`} style={{ background: avatarGradient(props.colorKey) }} aria-hidden="true">
      {initials(props.name)}
    </div>
  );
}
