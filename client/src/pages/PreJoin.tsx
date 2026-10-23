import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createAudioAnalyser,
  createLocalAudioTrack,
  createLocalVideoTrack,
  type LocalAudioTrack,
  type LocalVideoTrack,
} from 'livekit-client';
import { ArrowRight, Check, Copy, Crown, Mic, MicOff, Video, VideoOff, Volume2, Armchair } from 'lucide-react';
import { LIMITS, seatLabel, type RoomInfo } from '../../../shared/protocol.ts';
import { Logo } from '../components/Logo.tsx';
import { Avatar, VideoTrackView } from '../components/Media.tsx';
import { CAMERA_RESOLUTION, MEDIA_SUPPORT, describeMediaError, type JoinOptions } from '../lib/meeting.ts';
import { copyText, meetingUrl, plural } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import { deviceKey, mediaPrefs, saveMediaPrefs, saveName, savedName } from '../lib/storage.ts';

type Devices = { videoinput: MediaDeviceInfo[]; audioinput: MediaDeviceInfo[]; audiooutput: MediaDeviceInfo[] };

async function listDevices(): Promise<Devices> {
  const out: Devices = { videoinput: [], audioinput: [], audiooutput: [] };
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    for (const d of all) {
      if (d.deviceId && (d.kind === 'videoinput' || d.kind === 'audioinput' || d.kind === 'audiooutput')) out[d.kind].push(d);
    }
  } catch {
    /* no media devices API */
  }
  return out;
}

async function openCamera(deviceId?: string): Promise<LocalVideoTrack> {
  try {
    return await createLocalVideoTrack({ deviceId, resolution: CAMERA_RESOLUTION });
  } catch (err) {
    // The remembered device may be gone — fall back to the default one.
    if (deviceId) return createLocalVideoTrack({ resolution: CAMERA_RESOLUTION });
    throw err;
  }
}

async function openMic(deviceId?: string): Promise<LocalAudioTrack> {
  const opts = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  try {
    return await createLocalAudioTrack({ ...opts, deviceId });
  } catch (err) {
    if (deviceId) return createLocalAudioTrack(opts);
    throw err;
  }
}

export const supportsSpeakerSelection = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

export async function playTestSound(speakerId?: string): Promise<void> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const dest = ctx.createMediaStreamDestination();
  const gain = ctx.createGain();
  gain.connect(dest);
  const now = ctx.currentTime;
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now + i * 0.16);
    g.gain.linearRampToValueAtTime(0.25, now + i * 0.16 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.16 + 0.5);
    osc.connect(g).connect(gain);
    osc.start(now + i * 0.16);
    osc.stop(now + i * 0.16 + 0.55);
  });
  const audio = new Audio();
  audio.srcObject = dest.stream;
  if (speakerId && supportsSpeakerSelection) {
    await (audio as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(speakerId).catch(() => {});
  }
  await audio.play().catch(() => {});
  window.setTimeout(() => {
    audio.pause();
    void ctx.close();
  }, 1200);
}

export function MicMeter({ track }: { track: LocalAudioTrack | null }) {
  const bars = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!track) return;
    const { calculateVolume, cleanup } = createAudioAnalyser(track, { cloneTrack: true });
    let raf = 0;
    const tick = () => {
      const v = Math.min(1, calculateVolume() * 4);
      const el = bars.current;
      if (el) {
        const children = el.children;
        for (let i = 0; i < children.length; i++) {
          (children[i] as HTMLElement).classList.toggle('lit', v > (i + 0.5) / children.length);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      void cleanup();
    };
  }, [track]);
  return (
    <div className="mic-meter" ref={bars} aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  );
}

export function PreJoin(props: {
  info: RoomInfo;
  hostKey?: string;
  onJoin: (opts: Omit<JoinOptions, 'roomId' | 'hostKey' | 'invite'>) => void;
}) {
  const { info, onJoin } = props;
  const prefs = useRef(mediaPrefs()).current;
  const [name, setName] = useState(() => info.you?.name || savedName());
  const [camOn, setCamOn] = useState(prefs.camOn && MEDIA_SUPPORT.devices);
  const [micOn, setMicOn] = useState(prefs.micOn && MEDIA_SUPPORT.devices);
  const [video, setVideo] = useState<LocalVideoTrack | null>(null);
  const [audio, setAudio] = useState<LocalAudioTrack | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [devices, setDevices] = useState<Devices>({ videoinput: [], audioinput: [], audiooutput: [] });
  const [camId, setCamId] = useState(prefs.camId ?? '');
  const [micId, setMicId] = useState(prefs.micId ?? '');
  const [speakerId, setSpeakerId] = useState(prefs.speakerId ?? '');
  const [copied, setCopied] = useState(false);
  const [nameError, setNameError] = useState(false);
  const handedOff = useRef(false);
  const tracks = useRef<{ video: LocalVideoTrack | null; audio: LocalAudioTrack | null }>({ video: null, audio: null });
  tracks.current = { video, audio };

  // Camera preview follows the toggle.
  useEffect(() => {
    if (!camOn) {
      setVideo((t) => {
        t?.stop();
        return null;
      });
      return;
    }
    let cancelled = false;
    setCamError(null);
    openCamera(prefs.camId)
      .then((t) => {
        if (cancelled) {
          t.stop();
          return;
        }
        setVideo(t);
        const id = t.mediaStreamTrack.getSettings().deviceId;
        if (id) setCamId(id);
        void listDevices().then(setDevices);
      })
      .catch((err) => {
        if (cancelled) return;
        setCamError(describeMediaError(err, 'camera'));
        setCamOn(false);
      });
    return () => {
      cancelled = true;
    };
  }, [camOn, prefs.camId]);

  useEffect(() => {
    if (!micOn) {
      setAudio((t) => {
        t?.stop();
        return null;
      });
      return;
    }
    let cancelled = false;
    setMicError(null);
    openMic(prefs.micId)
      .then((t) => {
        if (cancelled) {
          t.stop();
          return;
        }
        setAudio(t);
        const id = t.mediaStreamTrack.getSettings().deviceId;
        if (id) setMicId(id);
        void listDevices().then(setDevices);
      })
      .catch((err) => {
        if (cancelled) return;
        setMicError(describeMediaError(err, 'microphone'));
        setMicOn(false);
      });
    return () => {
      cancelled = true;
    };
  }, [micOn, prefs.micId]);

  useEffect(() => {
    void listDevices().then(setDevices);
    const onChange = () => void listDevices().then(setDevices);
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
  }, []);

  // Stop the preview if the person leaves without joining.
  useEffect(
    () => () => {
      if (handedOff.current) return;
      tracks.current.video?.stop();
      tracks.current.audio?.stop();
    },
    [],
  );

  async function pickCamera(id: string) {
    setCamId(id);
    saveMediaPrefs({ camId: id });
    if (video) await video.setDeviceId(id).catch(() => setCamError('Couldn’t switch to that camera.'));
  }

  async function pickMic(id: string) {
    setMicId(id);
    saveMediaPrefs({ micId: id });
    if (audio) await audio.setDeviceId(id).catch(() => setMicError('Couldn’t switch to that microphone.'));
  }

  function pickSpeaker(id: string) {
    setSpeakerId(id);
    saveMediaPrefs({ speakerId: id });
  }

  function join(e: FormEvent) {
    e.preventDefault();
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, LIMITS.nameLength);
    if (!clean) {
      setNameError(true);
      return;
    }
    saveName(clean);
    saveMediaPrefs({ camOn, micOn });
    handedOff.current = true;
    onJoin({ name: clean, audio, video, micOn, camOn });
  }

  // The seat we know about belongs to the name we found; a different name is a different person.
  const sameName = !!info.you?.name && name.trim().replace(/\s+/g, ' ').toLowerCase() === info.you.name.toLowerCase();
  const seat = sameName ? (info.you?.seat ?? null) : null;
  const isHost = !!info.you?.host;
  const others = info.online;
  const deviceLabel = (d: MediaDeviceInfo, i: number, kind: string) => d.label || `${kind} ${i + 1}`;

  return (
    <div className="prejoin">
      <header className="prejoin-nav">
        <button className="logo-btn" onClick={() => navigate('/')} aria-label="Skypy home">
          <Logo size={24} />
        </button>
      </header>
      <main className="prejoin-main">
        <section className="preview-col">
          <div className="preview">
            {video ? (
              <VideoTrackView track={video} mirror />
            ) : (
              <div className="preview-off">
                <Avatar name={name || '?'} colorKey={deviceKey} className="avatar-xl" />
                <p>{camError ?? 'Camera is off'}</p>
              </div>
            )}
            <div className="preview-top">{name && <span className="preview-name">{name}</span>}</div>
            <div className="preview-controls">
              <button
                type="button"
                className={`round-btn${micOn ? '' : ' off'}`}
                onClick={() => setMicOn((v) => !v)}
                aria-label={micOn ? 'Turn microphone off' : 'Turn microphone on'}
                data-tip={micOn ? 'Mute' : 'Unmute'}
              >
                {micOn ? <Mic size={20} /> : <MicOff size={20} />}
              </button>
              <button
                type="button"
                className={`round-btn${camOn ? '' : ' off'}`}
                onClick={() => setCamOn((v) => !v)}
                aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
                data-tip={camOn ? 'Stop video' : 'Start video'}
              >
                {camOn ? <Video size={20} /> : <VideoOff size={20} />}
              </button>
            </div>
            {micOn && audio && (
              <div className="preview-meter">
                <Mic size={13} />
                <MicMeter track={audio} />
              </div>
            )}
          </div>
          {!MEDIA_SUPPORT.webrtc ? (
            <p className="preview-warning">
              This browser can’t do video calls. Open this link in an up-to-date Chrome, Edge, Firefox or Safari.
            </p>
          ) : !MEDIA_SUPPORT.secure ? (
            <p className="preview-warning">
              This link isn’t secure (it doesn’t start with https://), so your browser blocks the camera and microphone. You can still join
              to watch and chat — ask the host for the https link to use your camera.
            </p>
          ) : (
            micError && <p className="preview-error">{micError}</p>
          )}
          <div className="device-row">
            <label className="device-select">
              <Video size={15} />
              <select
                value={camId}
                onChange={(e) => void pickCamera(e.target.value)}
                disabled={devices.videoinput.length === 0}
                aria-label="Camera"
              >
                {devices.videoinput.length === 0 && <option value="">No camera</option>}
                {devices.videoinput.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {deviceLabel(d, i, 'Camera')}
                  </option>
                ))}
              </select>
            </label>
            <label className="device-select">
              <Mic size={15} />
              <select
                value={micId}
                onChange={(e) => void pickMic(e.target.value)}
                disabled={devices.audioinput.length === 0}
                aria-label="Microphone"
              >
                {devices.audioinput.length === 0 && <option value="">No microphone</option>}
                {devices.audioinput.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {deviceLabel(d, i, 'Microphone')}
                  </option>
                ))}
              </select>
            </label>
            {supportsSpeakerSelection && devices.audiooutput.length > 0 && (
              <label className="device-select">
                <Volume2 size={15} />
                <select value={speakerId} onChange={(e) => pickSpeaker(e.target.value)} aria-label="Speaker">
                  {devices.audiooutput.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {deviceLabel(d, i, 'Speaker')}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" className="btn btn-ghost btn-small" onClick={() => void playTestSound(speakerId || undefined)}>
              Test speaker
            </button>
          </div>
        </section>

        <form className="join-col" onSubmit={join}>
          <span className="join-room">{info.name}</span>
          <h1>Ready to join?</h1>
          <p className="join-sub">
            {others === 0 ? 'No one else is here yet.' : `${plural(others, 'person', 'people')} in the meeting now.`}
          </p>
          <div className="join-chips">
            {isHost && (
              <span className="chip chip-accent">
                <Crown size={14} /> You’re the host
              </span>
            )}
            {seat !== null && (
              <span className="chip">
                <Armchair size={14} /> Your seat: <b>{seatLabel(seat, info.cols)}</b>
              </span>
            )}
            <span className="chip chip-quiet">
              {info.rows * info.cols} seats · {info.rows} rows
            </span>
          </div>
          <label className="field">
            <span className="field-label">Your name</span>
            <input
              className={`input input-lg${nameError ? ' invalid' : ''}`}
              value={name}
              maxLength={LIMITS.nameLength}
              placeholder="Your full name"
              autoFocus={!name}
              autoComplete="name"
              onChange={(e) => {
                setName(e.target.value);
                setNameError(false);
              }}
            />
            {nameError ? (
              <span className="field-error">Please enter your name so others know who you are.</span>
            ) : (
              <span className="field-hint">Use the same name each time — it’s how Skypy finds your seat.</span>
            )}
          </label>
          <button className="btn btn-primary btn-lg join-btn" type="submit">
            Join now <ArrowRight size={18} />
          </button>
          <button
            type="button"
            className="join-link"
            onClick={async () => {
              if (await copyText(meetingUrl(info.id))) {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              }
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? 'Link copied' : `${location.host}/r/${info.id}`}</span>
          </button>
        </form>
      </main>
    </div>
  );
}
