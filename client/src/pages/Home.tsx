import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Check, Copy, Link2, LayoutPanelLeft, MonitorUp, Trash2, Users } from 'lucide-react';
import { LIMITS } from '../../../shared/protocol.ts';
import { HeroDemo } from '../components/HeroDemo.tsx';
import { Logo } from '../components/Logo.tsx';
import { Stepper } from '../components/Controls.tsx';
import { createRoom, getConfig } from '../lib/api.ts';
import { copyText, meetingUrl } from '../lib/format.ts';
import { navigate, parseRoomInput } from '../lib/router.ts';
import { forgetHostedRoom, hostedRooms, rememberHostedRoom, saveCreateCode, savedCreateCode, type HostedRoom } from '../lib/storage.ts';

const PRESETS = [
  { id: 'small', label: '20 seats', rows: 4, cols: 5 },
  { id: 'class', label: '40 seats', rows: 5, cols: 8 },
  { id: 'large', label: '54 seats', rows: 6, cols: 9 },
  { id: 'custom', label: 'Custom', rows: 0, cols: 0 },
] as const;

export function Home() {
  useEffect(() => {
    document.title = 'Skypy — every face, every seat';
  }, []);

  return (
    <div className="home">
      <header className="home-nav">
        <Logo />
        <span className="home-nav-note">Video meetings with assigned seats</span>
      </header>

      <main className="home-main">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">Built for classes &amp; seminars</span>
            <h1>
              Every face stays on screen.
              <br />
              <span className="grad">Even while you share.</span>
            </h1>
            <p className="hero-lede">
              Skypy seats everyone in a fixed spot — the same room for every participant, every time. When someone shares, the class slides
              aside and the screen takes the middle. No one disappears into a hidden page.
            </p>
            <ul className="hero-points">
              <li>
                <Users size={18} />
                <span>
                  <b>Assigned seats.</b> People land in their own seat whenever they dial in.
                </span>
              </li>
              <li>
                <MonitorUp size={18} />
                <span>
                  <b>Share in the middle.</b> Up to 64 faces stay visible on both sides — or above and below.
                </span>
              </li>
              <li>
                <Link2 size={18} />
                <span>
                  <b>Just a link.</b> Works in any modern browser. Nothing to install.
                </span>
              </li>
            </ul>
          </div>
          <HeroDemo />
        </section>

        <section className="home-actions">
          <CreateCard />
          <JoinCard />
        </section>

        <RoomsList />
      </main>

      <footer className="home-foot">
        <span>Skypy</span>
        <span className="dot" />
        <span>Fixed seats · Screen in the middle · Up to {LIMITS.maxSeats} people</span>
      </footer>
    </div>
  );
}

function CreateCard() {
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<(typeof PRESETS)[number]['id']>('class');
  const [rows, setRows] = useState(5);
  const [cols, setCols] = useState(8);
  const [customLink, setCustomLink] = useState(false);
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState(() => savedCreateCode());

  useEffect(() => {
    let cancelled = false;
    getConfig()
      .then((c) => !cancelled && setNeedsCode(c.createNeedsCode))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const chosen = PRESETS.find((p) => p.id === preset)!;
  const r = preset === 'custom' ? rows : chosen.rows;
  const c = preset === 'custom' ? cols : chosen.cols;
  const tooMany = r * c > LIMITS.maxSeats;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || tooMany) return;
    setBusy(true);
    setError(null);
    try {
      const title = name.trim() || 'Untitled meeting';
      const res = await createRoom({
        name: title,
        rows: r,
        cols: c,
        slug: customLink && slug.trim() ? slug.trim() : undefined,
        code: needsCode ? code.trim() : undefined,
      });
      if (needsCode) saveCreateCode(code.trim());
      rememberHostedRoom({ id: res.id, name: title, hostKey: res.hostKey });
      navigate(`/r/${res.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="card create-card" onSubmit={submit}>
      <div className="card-head">
        <div className="card-icon">
          <LayoutPanelLeft size={18} />
        </div>
        <div>
          <h2>Start a meeting</h2>
          <p>You’ll be the host. Share the link with your group.</p>
        </div>
      </div>

      <label className="field">
        <span className="field-label">Meeting name</span>
        <input
          className="input"
          value={name}
          maxLength={LIMITS.roomNameLength}
          placeholder="e.g. Thursday Seminar"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <div className="field">
        <span className="field-label">Room size</span>
        <div className="segmented" role="radiogroup" aria-label="Room size">
          {PRESETS.map((p) => (
            <button
              type="button"
              key={p.id}
              role="radio"
              aria-checked={preset === p.id}
              className={preset === p.id ? 'on' : ''}
              onClick={() => setPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' ? (
          <div className="size-row">
            <Stepper label="Rows" value={rows} min={LIMITS.minRows} max={LIMITS.maxRows} onChange={setRows} />
            <span className="size-x">×</span>
            <Stepper label="Seats per row" value={cols} min={LIMITS.minCols} max={LIMITS.maxCols} onChange={setCols} />
            <span className={`size-total${tooMany ? ' bad' : ''}`}>{r * c} seats</span>
          </div>
        ) : (
          <p className="field-hint">
            {r} rows × {c} seats. You can change this any time, even mid-meeting.
          </p>
        )}
        {tooMany && <p className="field-error">Up to {LIMITS.maxSeats} seats per room.</p>}
      </div>

      {customLink ? (
        <label className="field">
          <span className="field-label">Custom link</span>
          <div className="input-prefix">
            <span>{location.host}/r/</span>
            <input
              className="input"
              value={slug}
              maxLength={40}
              placeholder="seminar-fall"
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              autoFocus
            />
          </div>
        </label>
      ) : (
        <button type="button" className="link-btn" onClick={() => setCustomLink(true)}>
          Use a custom link
        </button>
      )}

      {needsCode && (
        <label className="field">
          <span className="field-label">Access code</span>
          <input
            className="input"
            type="password"
            value={code}
            autoComplete="off"
            placeholder="Ask whoever runs this Skypy"
            onChange={(e) => setCode(e.target.value)}
          />
          <span className="field-hint">Only needed to start meetings. Joining with a link never needs it.</span>
        </label>
      )}

      {error && <p className="form-error">{error}</p>}

      <button className="btn btn-primary btn-lg" type="submit" disabled={busy || tooMany || (needsCode && !code.trim())}>
        {busy ? 'Creating…' : 'Create meeting'}
        <ArrowRight size={18} />
      </button>
    </form>
  );
}

function JoinCard() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const id = parseRoomInput(value);
    if (!id) {
      setError('Paste the meeting link or type its code (like kqz-hwtm-rfa).');
      return;
    }
    navigate(`/r/${id}`);
  }

  return (
    <form className="card join-card" onSubmit={submit}>
      <div className="card-head">
        <div className="card-icon alt">
          <Link2 size={18} />
        </div>
        <div>
          <h2>Join a meeting</h2>
          <p>Got a link from your host? Paste it here.</p>
        </div>
      </div>
      <label className="field">
        <span className="field-label">Meeting link or code</span>
        <input
          className="input"
          value={value}
          placeholder="kqz-hwtm-rfa"
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="btn btn-secondary btn-lg" type="submit" disabled={!value.trim()}>
        Join
        <ArrowRight size={18} />
      </button>
    </form>
  );
}

function RoomsList() {
  const [rooms, setRooms] = useState<HostedRoom[]>(() => hostedRooms());
  const [copied, setCopied] = useState<string | null>(null);
  if (rooms.length === 0) return null;
  return (
    <section className="card rooms-card">
      <div className="rooms-head">
        <h2>Your rooms</h2>
        <p>Rooms you host on this device. Seats are remembered between meetings.</p>
      </div>
      <ul className="rooms-list">
        {rooms.map((r) => (
          <li key={r.id}>
            <button className="rooms-open" onClick={() => navigate(`/r/${r.id}`)}>
              <span className="rooms-name">{r.name}</span>
              <span className="rooms-link">
                {location.host}/r/{r.id}
              </span>
            </button>
            <div className="rooms-actions">
              <button
                className="icon-btn"
                data-tip={copied === r.id ? 'Copied' : 'Copy link'}
                aria-label="Copy link"
                onClick={async () => {
                  if (await copyText(meetingUrl(r.id))) {
                    setCopied(r.id);
                    window.setTimeout(() => setCopied(null), 1500);
                  }
                }}
              >
                {copied === r.id ? <Check size={16} /> : <Copy size={16} />}
              </button>
              <button
                className="icon-btn"
                data-tip="Remove from this list"
                aria-label="Remove from this list"
                onClick={() => {
                  if (
                    !confirm(
                      `Remove “${r.name}” from this device? The room keeps working, but you’ll need the host link to manage it again.`,
                    )
                  )
                    return;
                  forgetHostedRoom(r.id);
                  setRooms(hostedRooms());
                }}
              >
                <Trash2 size={16} />
              </button>
              <button className="btn btn-small btn-secondary" onClick={() => navigate(`/r/${r.id}`)}>
                Open
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
