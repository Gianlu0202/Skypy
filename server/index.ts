import './env.ts';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { LIMITS, cleanName, type CreateRoomResponse, type RoomInfo, type ServerConfig } from '../shared/protocol.ts';
import { assertConfig, config } from './config.ts';
import { Hub } from './hub.ts';
import { checkLivekit } from './livekit.ts';
import { ROOM_ID_RE, RoomStore, hashKey, normalizeSettings, randomRoomId, randomToken, type RoomRecord } from './store.ts';

assertConfig();

const store = new RoomStore(config.dataDir);
const hub = new Hub(store);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.use(express.json({ limit: '32kb' }));

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
  "font-src 'self' data:",
  // LiveKit signalling (wss) and LiveKit Cloud region discovery (https).
  "connect-src 'self' ws: wss: https:",
  "worker-src 'self' blob:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

app.use((_req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self)');
  next();
});

// ───────────────────────── API ─────────────────────────

const createLog = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (createLog.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= config.createLimit) return true;
  recent.push(now);
  createLog.set(ip, recent);
  if (createLog.size > 10_000) createLog.clear();
  return false;
}

const createSchema = z.object({
  name: z.string().max(LIMITS.roomNameLength * 2),
  rows: z.number().int().min(LIMITS.minRows).max(LIMITS.maxRows),
  cols: z.number().int().min(LIMITS.minCols).max(LIMITS.maxCols),
  slug: z.string().max(80).optional(),
  code: z.string().max(200).optional(),
});

function codeMatches(given: string | undefined): boolean {
  if (!config.createCode) return true;
  const a = crypto
    .createHash('sha256')
    .update(given ?? '')
    .digest();
  const b = crypto.createHash('sha256').update(config.createCode).digest();
  return crypto.timingSafeEqual(a, b);
}

app.get('/api/config', (_req: Request, res: Response) => {
  res.json({ createNeedsCode: !!config.createCode } satisfies ServerConfig);
});

function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

app.post('/api/rooms', (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid meeting details.' });
    return;
  }
  if (rateLimited(req.ip ?? 'unknown')) {
    res.status(429).json({ error: 'Too many meetings created. Try again later.' });
    return;
  }
  if (!codeMatches(parsed.data.code)) {
    res.status(403).json({ error: 'That access code isn’t right.' });
    return;
  }
  const { rows, cols } = parsed.data;
  if (rows * cols > LIMITS.maxSeats) {
    res.status(400).json({ error: `A room can have at most ${LIMITS.maxSeats} seats.` });
    return;
  }
  let id: string;
  if (parsed.data.slug && parsed.data.slug.trim()) {
    id = slugify(parsed.data.slug);
    if (!ROOM_ID_RE.test(id)) {
      res.status(400).json({ error: 'Custom links need 3–40 letters, numbers or dashes.' });
      return;
    }
    if (store.has(id)) {
      res.status(409).json({ error: 'That link is already taken. Try another.' });
      return;
    }
  } else {
    do id = randomRoomId();
    while (store.has(id));
  }
  const now = Date.now();
  const room: RoomRecord = {
    v: 1,
    id,
    name: cleanName(parsed.data.name, LIMITS.roomNameLength) || 'Untitled meeting',
    hostKey: randomToken(24),
    createdAt: now,
    updatedAt: now,
    settings: normalizeSettings({ rows, cols }),
    seats: new Array(rows * cols).fill(null),
    members: {},
  };
  store.create(room);
  res.status(201).json({ id, hostKey: room.hostKey } satisfies CreateRoomResponse);
});

const peekSchema = z.object({
  deviceKey: z.string().max(128).optional(),
  invite: z.string().max(128).optional(),
  hostKey: z.string().max(128).optional(),
});

function roomInfo(room: RoomRecord, who?: z.infer<typeof peekSchema>): RoomInfo {
  let you: RoomInfo['you'] = null;
  if (who) {
    const members = Object.values(room.members);
    const byInvite = who.invite ? members.find((m) => m.invite === who.invite) : undefined;
    const deviceHash = who.deviceKey ? hashKey(who.deviceKey) : null;
    const byDevice = deviceHash
      ? members.filter((m) => m.devices.includes(deviceHash)).sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0))[0]
      : undefined;
    const m = byInvite ?? byDevice;
    const host = !!who.hostKey && who.hostKey === room.hostKey;
    if (m || host) {
      const seat = m ? room.seats.indexOf(m.id) : -1;
      you = { name: m?.name ?? '', seat: seat >= 0 ? seat : null, host };
    }
  }
  return {
    id: room.id,
    name: room.name,
    rows: room.settings.rows,
    cols: room.settings.cols,
    locked: room.settings.locked,
    online: hub.online(room.id),
    you,
  };
}

app.get('/api/rooms/:id', (req: Request, res: Response) => {
  const room = store.get(String(req.params.id).toLowerCase());
  if (!room) {
    res.status(404).json({ error: 'Meeting not found.' });
    return;
  }
  res.json(roomInfo(room));
});

app.post('/api/rooms/:id/peek', (req: Request, res: Response) => {
  const room = store.get(String(req.params.id).toLowerCase());
  if (!room) {
    res.status(404).json({ error: 'Meeting not found.' });
    return;
  }
  const parsed = peekSchema.safeParse(req.body ?? {});
  res.json(roomInfo(room, parsed.success ? parsed.data : undefined));
});

app.get('/api/ping', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.get('/api/health', async (_req: Request, res: Response) => {
  const lk = await checkLivekit();
  res.status(lk.ok ? 200 : 503).json({ ok: lk.ok, livekit: lk });
});

app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found.' });
});

// ───────────────────────── client ─────────────────────────

const indexHtml = path.join(config.clientDir, 'index.html');

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** index.html with a title and link-preview tags for the page being opened. */
function pageHtml(template: string, req: Request): string {
  const m = /^\/r\/([a-z0-9-]{3,40})\/?$/i.exec(req.path);
  const room = m ? store.get(m[1].toLowerCase()) : undefined;
  const title = room ? `${room.name} · Skypy` : 'Skypy — every face, every seat';
  const description = room
    ? 'Join the meeting on Skypy — your seat is waiting. Works in your browser, nothing to install.'
    : 'Group video meetings where everyone keeps their seat. Every face stays on screen, even while you share.';
  const origin = `${req.protocol}://${req.get('host') ?? 'localhost'}`;
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Skypy" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:image" content="${escapeHtml(origin)}/og.png" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ].join('\n    ');
  const head = `<title>${escapeHtml(title)}</title>\n    ${tags}`;
  // A replacer function keeps "$&" and friends in room names literal.
  return template.replace(/<title>[^<]*<\/title>/, () => head);
}

if (fs.existsSync(indexHtml)) {
  const template = fs.readFileSync(indexHtml, 'utf8');
  app.use('/assets', express.static(path.join(config.clientDir, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }));
  app.use(express.static(config.clientDir, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/|ws$).*/, (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(pageHtml(template, req));
  });
} else {
  app.get('/', (_req: Request, res: Response) => {
    res
      .type('text')
      .send(
        'Skypy API is running. In development open the Vite dev server (http://localhost:5173); for production run `npm run build` first.',
      );
  });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = (err as { status?: number }).status ?? 500;
  if (status >= 500) console.error('[http]', err);
  if (!res.headersSent) res.status(status).json({ error: status === 404 ? 'Not found.' : 'Server error.' });
});

// ───────────────────────── server ─────────────────────────

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => hub.accept(ws));
});

server.listen(config.port, config.host, () => {
  console.log(`[skypy] listening on http://localhost:${config.port}`);
  // LiveKit may still be starting (e.g. under `npm run dev`): retry briefly before warning.
  void (async () => {
    let lk = await checkLivekit();
    for (let i = 0; i < 10 && !lk.ok; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      lk = await checkLivekit();
    }
    if (lk.ok) console.log(`[skypy] LiveKit reachable at ${config.livekit.apiUrl}`);
    else console.warn(`[skypy] LiveKit NOT reachable at ${config.livekit.apiUrl}: ${lk.error}`);
  })();
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[skypy] ${signal} received, saving rooms…`);
  hub.closeAll();
  wss.close();
  server.close();
  await store.flush();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => console.error('[skypy] unhandled rejection:', err));
process.on('uncaughtException', (err) => console.error('[skypy] uncaught exception:', err));
