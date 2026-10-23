import { useEffect, useRef, type CSSProperties } from 'react';
import type { VideoTrack } from 'livekit-client';
import { avatarGradient, initials } from '../lib/format.ts';

export function VideoTrackView(props: {
  track: VideoTrack;
  mirror?: boolean;
  fit?: 'cover' | 'contain';
  className?: string;
  /** Called with the video's natural size whenever it is known or changes. */
  onDimensions?: (width: number, height: number) => void;
}) {
  const { track, mirror, fit = 'cover', className, onDimensions } = props;
  const ref = useRef<HTMLVideoElement>(null);
  const report = useRef(onDimensions);
  report.current = onDimensions;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    const onSize = () => {
      if (el.videoWidth && el.videoHeight) report.current?.(el.videoWidth, el.videoHeight);
    };
    el.addEventListener('loadedmetadata', onSize);
    el.addEventListener('resize', onSize);
    onSize();
    return () => {
      el.removeEventListener('loadedmetadata', onSize);
      el.removeEventListener('resize', onSize);
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
