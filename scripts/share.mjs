// Share Skypy from this computer with a public https link, no server needed:
// runs the built app and opens a free Cloudflare quick tunnel to it.
// Media goes through LiveKit Cloud, so LIVEKIT_URL/KEY/SECRET must be set.
//   npm run share
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const lk = process.env.LIVEKIT_URL ?? '';
if (!/^wss:\/\//.test(lk) || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
  console.error(`
  To share a meeting link from this computer, Skypy needs a public media server.

  1. Create a free project at https://cloud.livekit.io (takes a minute).
  2. Copy .env.example to .env and fill in LIVEKIT_URL (wss://…),
     LIVEKIT_API_KEY and LIVEKIT_API_SECRET from the project's settings.
  3. Run \`npm run share\` again.
`);
  process.exit(1);
}

const binDir = path.join(root, 'bin');
const exe = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';

async function ensureCloudflared() {
  const local = path.join(binDir, exe);
  if (fs.existsSync(local)) return local;
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['cloudflared'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.split(/\r?\n/)[0].trim();
  const arch = { x64: 'amd64', arm64: 'arm64' }[os.arch()];
  const name = {
    win32: `cloudflared-windows-${arch}.exe`,
    linux: `cloudflared-linux-${arch}`,
    darwin: `cloudflared-darwin-${arch}.tgz`,
  }[process.platform];
  if (!arch || !name) throw new Error(`No cloudflared build for ${process.platform}/${os.arch()}.`);
  console.log(`[share] downloading ${name}…`);
  const res = await fetch(`https://github.com/cloudflare/cloudflared/releases/latest/download/${name}`, {
    headers: { 'User-Agent': 'skypy-setup' },
  });
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  fs.mkdirSync(binDir, { recursive: true });
  const buf = Buffer.from(await res.arrayBuffer());
  if (name.endsWith('.tgz')) {
    const tgz = path.join(binDir, name);
    fs.writeFileSync(tgz, buf);
    spawnSync('tar', ['-xzf', tgz, '-C', binDir], { stdio: 'inherit' });
    fs.rmSync(tgz, { force: true });
  } else {
    fs.writeFileSync(local, buf);
  }
  if (process.platform !== 'win32') fs.chmodSync(local, 0o755);
  return local;
}

if (!fs.existsSync(path.join(root, 'dist', 'server', 'index.js'))) {
  console.log('[share] building Skypy…');
  const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const port = process.env.PORT ?? '3000';
const children = [];
const stop = () => {
  for (const c of children) if (c.exitCode === null) c.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const server = spawn(process.execPath, ['dist/server/index.js'], { cwd: root, stdio: 'inherit', env: { ...process.env, PORT: port } });
children.push(server);
server.on('exit', (code) => {
  console.error(`[share] server stopped (${code}).`);
  stop();
});

const cloudflared = await ensureCloudflared();
const tunnel = spawn(cloudflared, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
children.push(tunnel);
let announced = false;
const watch = (chunk) => {
  const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString());
  if (m && !announced) {
    announced = true;
    console.log(`
  ┌──────────────────────────────────────────────────────────────┐
    Skypy is live at  ${m[0]}

    Open it, start a meeting, and send the meeting link to anyone.
    Keep this window open while the meeting runs (Ctrl+C to stop).
  └──────────────────────────────────────────────────────────────┘
`);
  }
};
tunnel.stdout.on('data', watch);
tunnel.stderr.on('data', watch);
tunnel.on('exit', (code) => {
  console.error(`[share] tunnel closed (${code}).`);
  stop();
});
