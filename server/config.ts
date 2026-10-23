import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The built client: dist/client next to the bundled server, or from source. */
function findClientDir(): string {
  const candidates = [path.join(here, '..', 'client'), path.join(here, '..', 'dist', 'client')];
  for (const dir of candidates) {
    try {
      const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
      if (!html.includes('/src/main.tsx')) return dir; // skip the unbuilt Vite entry
    } catch {
      /* not here */
    }
  }
  return candidates[candidates.length - 1];
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : undefined;
}

function toHttp(url: string): string {
  return url.replace(/^ws(s?):\/\//i, 'http$1://');
}

const livekitUrl = env('LIVEKIT_URL');
const usingDevLivekit = !livekitUrl;

export const config = {
  port: Number(env('PORT') ?? 3000),
  host: env('HOST') ?? '0.0.0.0',
  dataDir: path.resolve(env('DATA_DIR') ?? path.join(process.cwd(), 'data')),
  /** Built client bundle; present after `npm run build`. */
  clientDir: path.resolve(env('CLIENT_DIR') ?? findClientDir()),
  trustProxy: env('TRUST_PROXY') ?? 'loopback, linklocal, uniquelocal',
  livekit: {
    /** URL browsers connect to (wss:// in production). */
    url: livekitUrl ?? 'ws://localhost:7880',
    /** URL this server uses for the LiveKit server API. */
    apiUrl: toHttp(env('LIVEKIT_API_URL') ?? livekitUrl ?? 'http://127.0.0.1:7880'),
    apiKey: env('LIVEKIT_API_KEY') ?? (usingDevLivekit ? 'devkey' : ''),
    apiSecret: env('LIVEKIT_API_SECRET') ?? (usingDevLivekit ? 'secret' : ''),
    dev: usingDevLivekit,
  },
  /** Seconds a dropped connection keeps its seat before it is released. */
  graceSeconds: Number(env('SEAT_GRACE_SECONDS') ?? 30),
  /** Max rooms created per IP per hour. */
  createLimit: Number(env('ROOM_CREATE_LIMIT') ?? 30),
};

export function assertConfig(): void {
  const { apiKey, apiSecret, dev } = config.livekit;
  if (!apiKey || !apiSecret) {
    throw new Error('LIVEKIT_URL is set but LIVEKIT_API_KEY / LIVEKIT_API_SECRET are missing. See .env.example.');
  }
  if (dev) {
    console.warn('[skypy] LIVEKIT_URL not set — using a local LiveKit dev server at ws://localhost:7880 (devkey/secret).');
  }
}
