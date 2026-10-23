// Meeting controller: owns the LiveKit room and the signal connection for one
// meeting, and mirrors their state into the store. Lives outside React so
// re-renders and effects can never tear the call down by accident.
import {
  ConnectionState,
  DisconnectReason,
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  RoomEvent,
  ScreenSharePresets,
  Track,
  VideoPresets,
  type LocalTrackPublication,
  type Participant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type TrackPublication,
} from 'livekit-client';
import type { ChatMessage, ClientMsg, RoomState, ServerMsg } from '../../../shared/protocol.ts';
import { Signal } from './signal.ts';
import { deviceKey, mediaPrefs, saveMediaPrefs, tabId } from './storage.ts';
import { addReaction, resetMeetingStore, toast, useStore, type EndKind } from './store.ts';

export interface JoinOptions {
  roomId: string;
  name: string;
  hostKey?: string;
  invite?: string;
  audio: LocalAudioTrack | null;
  video: LocalVideoTrack | null;
  micOn: boolean;
  camOn: boolean;
}

/**
 * Load-testing switch, set only by automation (window.__skypyLite = true):
 * publish a tiny camera and receive no media, so one machine can simulate a
 * full class. Never set in normal use.
 */
export const LITE = (window as unknown as { __skypyLite?: boolean }).__skypyLite === true;
export const CAMERA_RESOLUTION = LITE ? VideoPresets.h180.resolution : VideoPresets.h720.resolution;

let current: Meeting | null = null;

/** Keep chat we already have across reconnects (a restarted server starts empty). */
function mergeChat(mine: ChatMessage[], server: ChatMessage[]): ChatMessage[] {
  const byId = new Map(mine.map((m) => [m.id, m]));
  for (const m of server) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.ts - b.ts).slice(-200);
}

export function currentMeeting(): Meeting | null {
  return current;
}

const DEVICE_ERRORS = new Set([
  'NotAllowedError',
  'SecurityError',
  'NotFoundError',
  'OverconstrainedError',
  'NotReadableError',
  'AbortError',
]);

function isDeviceError(err: unknown): boolean {
  return DEVICE_ERRORS.has((err as { name?: string })?.name ?? '');
}

export function describeMediaError(err: unknown, what: 'camera' | 'microphone' | 'screen'): string | null {
  const name = (err as { name?: string })?.name ?? '';
  const label = what === 'screen' ? 'screen sharing' : `your ${what}`;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    if (what === 'screen') return null; // user cancelled the picker
    return `Skypy doesn’t have permission to use ${label}. Allow it from the icon in your browser’s address bar.`;
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `No ${what} was found. Plug one in or pick another in Settings.`;
  if (name === 'NotReadableError' || name === 'AbortError') return `Your ${what} is being used by another app. Close it and try again.`;
  return `Couldn’t start ${label}${(err as Error)?.message ? `: ${(err as Error).message}` : '.'}`;
}

export class Meeting {
  readonly room: Room;
  readonly roomId: string;
  private signal: Signal;
  private livekit: { url: string; token: string } | null = null;
  /** When the current media token was issued (ms epoch). */
  private tokenAt = 0;
  private tokenWaiters: ((token: string | null) => void)[] = [];
  private initialTracks: { audio: LocalAudioTrack | null; video: LocalVideoTrack | null } | null;
  /** Pre-join preview tracks; always stopped when the meeting ends. */
  private previewTracks: (LocalAudioTrack | LocalVideoTrack)[];
  private wantMic: boolean;
  private wantCam: boolean;
  private connecting = false;
  /** A retry came due while a connection attempt was still running. */
  private retryQueued = false;
  private everConnected = false;
  private retryTimer: number | undefined;
  private retryAttempt = 0;
  private stopped = false;
  private audioHost: HTMLDivElement;
  private name: string;
  private hostKey?: string;
  private invite?: string;
  /** When each participant started sharing, to show the newest share first. */
  readonly shareStarted = new Map<string, number>();

  constructor(opts: JoinOptions) {
    current?.leave('left');
    current = this;
    resetMeetingStore();
    this.roomId = opts.roomId;
    this.name = opts.name;
    this.hostKey = opts.hostKey;
    this.invite = opts.invite;
    this.initialTracks = { audio: opts.audio, video: opts.video };
    this.previewTracks = [opts.audio, opts.video].filter((t): t is LocalAudioTrack | LocalVideoTrack => !!t);
    // What the person asked for. If the preview hadn't produced a track yet
    // (a quick click on Join), the device is started after connecting.
    this.wantMic = opts.micOn;
    this.wantCam = opts.camOn;

    const prefs = mediaPrefs();
    this.room = new Room({
      // Each tile receives only the resolution it needs. Density 1 (not the
      // screen's 2x) keeps a 40-face class to a few Mbps on high-DPI laptops;
      // big views (shared screen, spotlight) still get HD.
      adaptiveStream: { pixelDensity: 1 },
      dynacast: true,
      disconnectOnPageLeave: true,
      videoCaptureDefaults: { resolution: CAMERA_RESOLUTION, deviceId: prefs.camId },
      audioCaptureDefaults: {
        deviceId: prefs.micId,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      audioOutput: prefs.speakerId ? { deviceId: prefs.speakerId } : undefined,
      publishDefaults: {
        simulcast: !LITE,
        videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
        screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
        dtx: true,
        red: true,
      },
    });

    this.audioHost = document.createElement('div');
    this.audioHost.setAttribute('aria-hidden', 'true');
    this.audioHost.style.display = 'none';
    document.body.appendChild(this.audioHost);

    this.wireRoom();
    this.signal = new Signal(
      () => ({
        t: 'hello',
        roomId: this.roomId,
        name: this.name,
        deviceKey,
        tabId,
        hostKey: this.hostKey,
        invite: this.invite,
      }),
      {
        message: (m) => this.onMessage(m),
        status: (s) => useStore.setState({ signal: s }),
        fatal: (reason) => {
          if (reason === 'replaced') this.end('replaced', 'You joined this meeting from another tab or window.');
          // 'denied' is handled when the denied message arrives
        },
      },
    );
    this.signal.connect();
  }

  // ───────────────────────── signal ─────────────────────────

  private onMessage(msg: ServerMsg): void {
    const store = useStore.getState();
    switch (msg.t) {
      case 'welcome': {
        this.livekit = msg.livekit;
        this.tokenAt = Date.now();
        useStore.setState({
          sessionId: msg.sessionId,
          memberId: msg.memberId,
          host: msg.host,
          hostData: msg.hostData,
          chat: mergeChat(useStore.getState().chat, msg.chat),
          clockOffset: msg.serverTime - Date.now(),
        });
        this.applyState(msg.state, msg.host);
        const lkState = this.room.state;
        if (lkState === ConnectionState.Disconnected && !this.connecting) void this.connectMedia();
        return;
      }
      case 'state':
        this.applyState(msg.state, msg.host);
        useStore.setState({ hostData: msg.hostData });
        return;
      case 'chat': {
        const mine = msg.msg.sessionId === store.sessionId;
        useStore.setState((s) => ({
          chat: [...s.chat.slice(-199), msg.msg],
          unread: s.panel === 'chat' || mine ? s.unread : s.unread + 1,
        }));
        if (!mine && store.panel !== 'chat') {
          toast(msg.msg.text.length > 140 ? `${msg.msg.text.slice(0, 140)}…` : msg.msg.text, {
            title: msg.msg.name,
            icon: 'chat',
            ttl: 5000,
            action: { label: 'Reply', run: () => useStore.setState({ panel: 'chat', unread: 0 }) },
          });
        }
        return;
      }
      case 'react':
        addReaction(msg.sessionId, msg.emoji);
        return;
      case 'notice':
        toast(msg.text, { tone: msg.level === 'warn' ? 'warn' : 'info' });
        if (/muted you|muted everyone/.test(msg.text)) useStore.setState({ mic: false });
        return;
      case 'kicked':
        this.end('kicked', msg.reason);
        return;
      case 'denied':
        this.end('denied', msg.message);
        return;
      case 'error':
        toast(msg.message, { tone: 'warn' });
        return;
      case 'token':
        if (this.livekit) this.livekit.token = msg.token;
        this.tokenAt = Date.now();
        for (const resolve of this.tokenWaiters.splice(0)) resolve(msg.token);
        return;
      case 'pong':
        return;
    }
  }

  private applyState(next: RoomState, host: boolean): void {
    const prev = useStore.getState();
    const me = prev.sessionId;
    if (prev.state && me) {
      // Gentle heads-ups about things that affect this person.
      if (!prev.host && host) toast('You’re now a co-host. You can arrange seats and manage the meeting.', { tone: 'success' });
      if (prev.host && !host) toast('You’re no longer a co-host.');
      if (next.spotlight && next.spotlight !== prev.state.spotlight) {
        const who = next.sessions.find((s) => s.id === next.spotlight);
        if (who) toast(who.id === me ? 'You’re in the spotlight for everyone.' : `${who.name} is in the spotlight.`);
      }
      const before = prev.state.sessions.find((s) => s.id === me);
      const after = next.sessions.find((s) => s.id === me);
      if (before && after && before.seat !== after.seat && after.seat !== null && prev.state.settings.cols) {
        const label = `${String.fromCharCode(65 + Math.floor(after.seat / next.settings.cols))}${(after.seat % next.settings.cols) + 1}`;
        toast(`You moved to seat ${label}.`);
      }
      if (before?.hand && !after?.hand) toast('Your hand was lowered.');
      if (host) {
        const prevHands = new Set(prev.state.sessions.filter((s) => s.hand).map((s) => s.id));
        for (const s of next.sessions) {
          if (s.hand && !prevHands.has(s.id) && s.id !== me)
            toast(`${s.name} raised a hand`, { title: 'Hand raised', icon: 'hand', ttl: 6000 });
        }
      }
    }
    useStore.setState({ state: next, host });
    if (prev.pinned && !next.sessions.some((s) => s.id === prev.pinned)) useStore.setState({ pinned: null });
    if (!host && prev.arrange) useStore.setState({ arrange: false });
    // Screen sharing restricted to hosts: stop if we lost the right to share.
    if (next.settings.screenShare === 'hosts' && !host && this.room.localParticipant.isScreenShareEnabled) {
      void this.room.localParticipant.setScreenShareEnabled(false);
      toast('The host limited screen sharing to hosts.');
    }
  }

  send(msg: ClientMsg): boolean {
    const ok = this.signal.send(msg);
    if (!ok) toast('You’re offline for a moment — try again when the connection is back.', { tone: 'warn' });
    return ok;
  }

  // ───────────────────────── media ─────────────────────────

  private wireRoom(): void {
    const room = this.room;
    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, p: Participant) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.dataset.identity = p.identity;
          this.audioHost.appendChild(el);
        }
        if (pub.source === Track.Source.ScreenShare && !this.shareStarted.has(p.identity)) {
          this.shareStarted.set(p.identity, Date.now());
        }
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) for (const el of track.detach()) el.remove();
      })
      .on(RoomEvent.TrackPublished, (pub: RemoteTrackPublication, p: Participant) => {
        if (pub.source === Track.Source.ScreenShare) {
          this.shareStarted.set(p.identity, Date.now());
          useStore.setState({ stageKey: null });
          const name = useStore.getState().state?.sessions.find((s) => s.id === p.identity)?.name ?? p.name ?? 'Someone';
          toast(`${name} is presenting.`, { ttl: 3000 });
        }
      })
      .on(RoomEvent.TrackUnpublished, (pub: RemoteTrackPublication, p: Participant) => {
        if (pub.source === Track.Source.ScreenShare) this.shareStarted.delete(p.identity);
      })
      .on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
        if (pub.source === Track.Source.ScreenShare) {
          this.shareStarted.set(room.localParticipant.identity, Date.now());
          useStore.setState({ stageKey: null });
        }
        this.syncLocal();
      })
      .on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
        if (pub.source === Track.Source.ScreenShare) this.shareStarted.delete(room.localParticipant.identity);
        this.syncLocal();
      })
      .on(RoomEvent.TrackMuted, (pub: TrackPublication, p: Participant) => {
        if (p !== room.localParticipant) return;
        // Includes a host muting us: remember it so a reconnect doesn't unmute.
        if (pub.source === Track.Source.Microphone) this.wantMic = false;
        if (pub.source === Track.Source.Camera) this.wantCam = false;
        this.syncLocal();
      })
      .on(RoomEvent.TrackUnmuted, (pub: TrackPublication, p: Participant) => {
        if (p !== room.localParticipant) return;
        if (pub.source === Track.Source.Microphone) this.wantMic = true;
        if (pub.source === Track.Source.Camera) this.wantCam = true;
        this.syncLocal();
      })
      .on(RoomEvent.ParticipantDisconnected, (p: Participant) => {
        this.shareStarted.delete(p.identity);
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        useStore.setState({ audioBlocked: !room.canPlaybackAudio });
      })
      .on(RoomEvent.Reconnecting, () => useStore.setState({ media: 'reconnecting' }))
      .on(RoomEvent.SignalReconnecting, () => useStore.setState({ media: 'reconnecting' }))
      .on(RoomEvent.Reconnected, () => {
        useStore.setState({ media: 'connected' });
        this.syncLocal();
      })
      .on(RoomEvent.MediaDevicesError, (err: Error) => {
        const msg = describeMediaError(err, /audio|microphone/i.test(err.message) ? 'microphone' : 'camera');
        if (msg) toast(msg, { tone: 'warn', ttl: 7000 });
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        this.syncLocal();
        if (this.stopped) return;
        switch (reason) {
          case DisconnectReason.CLIENT_INITIATED:
            return;
          case DisconnectReason.DUPLICATE_IDENTITY:
            this.end('replaced', 'You joined this meeting from another tab or window.');
            return;
          case DisconnectReason.PARTICIPANT_REMOVED:
            this.end('kicked', 'The host removed you from the meeting.');
            return;
          default:
            useStore.setState({ media: 'failed' });
            this.scheduleMediaRetry();
        }
      });
  }

  private async connectMedia(): Promise<void> {
    if (this.stopped || !this.livekit) return;
    if (this.connecting) {
      this.retryQueued = true;
      return;
    }
    this.connecting = true;
    window.clearTimeout(this.retryTimer);
    useStore.setState({ media: this.everConnected ? 'reconnecting' : 'connecting' });
    try {
      await this.freshToken();
      if (this.stopped) return;
      await this.room.connect(this.livekit.url, this.livekit.token, { autoSubscribe: !LITE });
      if (this.stopped) {
        await this.room.disconnect();
        return;
      }
      this.retryAttempt = 0;
      useStore.setState({ media: 'connected', audioBlocked: !this.room.canPlaybackAudio });
      if (!this.room.canPlaybackAudio) void this.room.startAudio().catch(() => {});
      await this.publishAfterConnect();
      this.everConnected = true;
    } catch (err) {
      if (this.stopped) return;
      console.warn('[skypy] media connection failed', err);
      useStore.setState({ media: 'failed' });
      this.scheduleMediaRetry();
    } finally {
      this.connecting = false;
      this.syncLocal();
      if (this.retryQueued) {
        this.retryQueued = false;
        if (!this.stopped && this.room.state === ConnectionState.Disconnected) this.scheduleMediaRetry();
      }
    }
  }

  /** Tokens expire: ask the server for a new one before reconnecting with an old one. */
  private async freshToken(): Promise<void> {
    if (!this.livekit || Date.now() - this.tokenAt < 60_000 || !this.signal.isOpen) return;
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => resolve(), 4000);
      this.tokenWaiters.push(() => {
        window.clearTimeout(timer);
        resolve();
      });
      this.signal.send({ t: 'token' });
    });
  }

  private scheduleMediaRetry(): void {
    if (this.stopped) return;
    window.clearTimeout(this.retryTimer);
    // Exponential backoff with jitter so a whole class never retries in lockstep.
    const base = Math.min(15_000, 1000 * 2 ** this.retryAttempt);
    const delay = base * (0.6 + Math.random() * 0.8);
    this.retryAttempt++;
    this.retryTimer = window.setTimeout(() => void this.connectMedia(), delay);
  }

  /** Try the media connection again right away (from the banner button). */
  retryMedia(): void {
    this.retryAttempt = 0;
    void this.connectMedia();
  }

  private async publishAfterConnect(): Promise<void> {
    const lp = this.room.localParticipant;
    const initial = this.initialTracks;
    this.initialTracks = null;
    if (initial) {
      // First connection: publish the tracks from the pre-join preview.
      if (initial.audio) {
        try {
          await lp.publishTrack(initial.audio, { source: Track.Source.Microphone });
          if (!this.wantMic) await initial.audio.mute();
        } catch (err) {
          console.warn('[skypy] publishing microphone failed', err);
          initial.audio.stop();
          if (!this.stopped) toast('Couldn’t share your microphone. Try toggling it again.', { tone: 'warn' });
        }
      }
      if (initial.video) {
        if (this.wantCam) {
          try {
            await lp.publishTrack(initial.video, { source: Track.Source.Camera });
          } catch (err) {
            console.warn('[skypy] publishing camera failed', err);
            initial.video.stop();
            if (!this.stopped) toast('Couldn’t share your camera. Try toggling it again.', { tone: 'warn' });
          }
        } else {
          initial.video.stop();
        }
      }
      // Preview wasn't ready at join time, or turned on while connecting.
      if (this.wantMic && !initial.audio) await this.enableDevice('microphone');
      if (this.wantCam && !initial.video) await this.enableDevice('camera');
      return;
    }
    // Reconnected after a full disconnect: restore what the person had on.
    if (this.wantMic) await this.enableDevice('microphone');
    if (this.wantCam) await this.enableDevice('camera');
  }

  private async enableDevice(kind: 'microphone' | 'camera'): Promise<void> {
    const lp = this.room.localParticipant;
    try {
      if (kind === 'microphone') await lp.setMicrophoneEnabled(true);
      else await lp.setCameraEnabled(true);
    } catch (err) {
      if (this.stopped) return;
      // A network hiccup keeps the wish (restored on the next reconnect);
      // a device or permission problem turns it off and tells the person.
      if (!isDeviceError(err)) return;
      if (kind === 'microphone') this.wantMic = false;
      else this.wantCam = false;
      const msg = describeMediaError(err, kind);
      if (msg) toast(msg, { tone: 'warn', ttl: 7000 });
    }
  }

  /** Tracks are published (connected, or reconnecting with tracks kept). */
  private mediaLive(): boolean {
    const st = this.room.state;
    return st === ConnectionState.Connected || st === ConnectionState.Reconnecting || st === ConnectionState.SignalReconnecting;
  }

  private syncLocal(): void {
    const lp = this.room.localParticipant;
    // Without a media connection, show what the person asked for.
    const live = this.mediaLive();
    useStore.setState({
      mic: live ? lp.isMicrophoneEnabled : this.wantMic,
      cam: live ? lp.isCameraEnabled : this.wantCam,
      sharing: live && lp.isScreenShareEnabled,
    });
  }

  async toggleMic(): Promise<void> {
    const lp = this.room.localParticipant;
    const live = this.mediaLive();
    const next = !(live ? lp.isMicrophoneEnabled : this.wantMic);
    this.wantMic = next;
    saveMediaPrefs({ micOn: next });
    if (live) {
      try {
        await lp.setMicrophoneEnabled(next);
      } catch (err) {
        if (next) this.wantMic = false;
        const msg = describeMediaError(err, 'microphone');
        if (msg) toast(msg, { tone: 'warn', ttl: 7000 });
      }
    }
    this.syncLocal();
  }

  async toggleCam(): Promise<void> {
    const lp = this.room.localParticipant;
    const live = this.mediaLive();
    const next = !(live ? lp.isCameraEnabled : this.wantCam);
    this.wantCam = next;
    saveMediaPrefs({ camOn: next });
    if (live) {
      try {
        await lp.setCameraEnabled(next);
      } catch (err) {
        if (next) this.wantCam = false;
        const msg = describeMediaError(err, 'camera');
        if (msg) toast(msg, { tone: 'warn', ttl: 7000 });
      }
    }
    this.syncLocal();
  }

  canShare(): boolean {
    const { state, host } = useStore.getState();
    return !state || state.settings.screenShare === 'everyone' || host;
  }

  async toggleShare(): Promise<void> {
    const lp = this.room.localParticipant;
    if (lp.isScreenShareEnabled) {
      await lp.setScreenShareEnabled(false).catch(() => {});
      this.syncLocal();
      return;
    }
    if (!this.canShare()) {
      toast('Only hosts can share their screen in this meeting.');
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast('Screen sharing isn’t supported in this browser.', { tone: 'warn' });
      return;
    }
    if (this.room.state !== ConnectionState.Connected) {
      toast('Still connecting audio and video — try again in a moment.');
      return;
    }
    try {
      await lp.setScreenShareEnabled(true, {
        audio: true,
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        systemAudio: 'include',
        contentHint: 'detail',
        resolution: { width: 1920, height: 1080, frameRate: 15 },
      });
    } catch (err) {
      const msg = describeMediaError(err, 'screen');
      if (msg) toast(msg, { tone: 'warn', ttl: 7000 });
    }
    this.syncLocal();
  }

  async switchDevice(kind: MediaDeviceKind, deviceId: string): Promise<void> {
    const key = kind === 'videoinput' ? 'camId' : kind === 'audioinput' ? 'micId' : 'speakerId';
    saveMediaPrefs({ [key]: deviceId });
    try {
      await this.room.switchActiveDevice(kind, deviceId);
    } catch (err) {
      const msg = describeMediaError(err, kind === 'videoinput' ? 'camera' : 'microphone');
      if (msg) toast(msg, { tone: 'warn' });
    }
  }

  async enableAudio(): Promise<void> {
    await this.room.startAudio().catch(() => {});
    useStore.setState({ audioBlocked: !this.room.canPlaybackAudio });
  }

  rename(name: string): void {
    this.name = name;
    this.send({ t: 'rename', name });
  }

  // ───────────────────────── lifecycle ─────────────────────────

  private end(kind: EndKind, message?: string): void {
    if (this.stopped) return;
    this.teardown(kind === 'left');
    useStore.setState({ ended: { kind, message } });
  }

  leave(kind: EndKind = 'left'): void {
    this.end(kind);
  }

  private teardown(sendLeave: boolean): void {
    this.stopped = true;
    window.clearTimeout(this.retryTimer);
    for (const resolve of this.tokenWaiters.splice(0)) resolve(null);
    this.signal.stop(sendLeave);
    const lp = this.room.localParticipant;
    for (const pub of lp.trackPublications.values()) pub.track?.stop();
    for (const t of this.previewTracks) t.stop();
    void this.room.disconnect(true).catch(() => {});
    this.audioHost.remove();
    if (current === this) current = null;
  }
}
