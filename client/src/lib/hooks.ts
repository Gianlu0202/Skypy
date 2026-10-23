import { useEffect, useLayoutEffect, useReducer, useRef, useState, type RefObject } from 'react';
import { ParticipantEvent, RoomEvent, Track, type Participant, type Room, type VideoTrack } from 'livekit-client';

/** Re-render whenever any of the given room events fire. */
export function useRoomEvents(room: Room | null | undefined, events: RoomEvent[]): number {
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const key = events.join('|');
  useEffect(() => {
    if (!room) return;
    const handler = () => bump();
    for (const e of events) room.on(e, handler);
    bump();
    return () => {
      for (const e of events) room.off(e, handler);
    };
  }, [room, key]);
  return version;
}

const PARTICIPANT_EVENTS: ParticipantEvent[] = [
  ParticipantEvent.TrackMuted,
  ParticipantEvent.TrackUnmuted,
  ParticipantEvent.TrackPublished,
  ParticipantEvent.TrackUnpublished,
  ParticipantEvent.TrackSubscribed,
  ParticipantEvent.TrackUnsubscribed,
  ParticipantEvent.LocalTrackPublished,
  ParticipantEvent.LocalTrackUnpublished,
  ParticipantEvent.IsSpeakingChanged,
  ParticipantEvent.ConnectionQualityChanged,
  ParticipantEvent.TrackStreamStateChanged,
];

/** Re-render whenever this participant's tracks, mute or speaking state change. */
export function useParticipant(p: Participant | undefined): number {
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!p) return;
    // Local and remote participants emit different subsets; listen to all.
    const emitter = p as unknown as { on(e: string, h: () => void): void; off(e: string, h: () => void): void };
    const handler = () => bump();
    for (const e of PARTICIPANT_EVENTS) emitter.on(e, handler);
    bump();
    return () => {
      for (const e of PARTICIPANT_EVENTS) emitter.off(e, handler);
    };
  }, [p]);
  return version;
}

export function cameraTrack(p: Participant | undefined): VideoTrack | undefined {
  const pub = p?.getTrackPublication(Track.Source.Camera);
  if (!pub || pub.isMuted || !pub.track) return undefined;
  return pub.track as VideoTrack;
}

export function screenTrack(p: Participant | undefined): VideoTrack | undefined {
  const pub = p?.getTrackPublication(Track.Source.ScreenShare);
  if (!pub || pub.isMuted || !pub.track) return undefined;
  return pub.track as VideoTrack;
}

export function hasScreenShare(p: Participant): boolean {
  const pub = p.getTrackPublication(Track.Source.ScreenShare);
  return !!pub && !pub.isMuted;
}

export function micMuted(p: Participant | undefined): boolean {
  const pub = p?.getTrackPublication(Track.Source.Microphone);
  return !pub || pub.isMuted;
}

/** Observe an element's size. */
export function useSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (Math.abs(s.width - r.width) < 0.5 && Math.abs(s.height - r.height) < 0.5 ? s : { width: r.width, height: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** A clock that ticks every `ms`. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** Close a popover when clicking outside it or pressing Escape. */
export function useDismiss(open: boolean, onClose: () => void, ...refs: RefObject<HTMLElement | null>[]): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (refs.some((r) => r.current?.contains(target))) return;
      close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
}
