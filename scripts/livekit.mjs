// Locates or downloads a LiveKit server binary for local development.
// Run directly (`npm run livekit`) to start a dev LiveKit server on :7880.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binDir = path.join(root, 'bin');
const exe = process.platform === 'win32' ? 'livekit-server.exe' : 'livekit-server';

function onPath() {
  const which = process.platform === 'win32' ? 'where' : 'which';
  const res = spawnSync(which, ['livekit-server'], { encoding: 'utf8' });
  if (res.status === 0) return res.stdout.split(/\r?\n/)[0].trim() || null;
  return null;
}

async function download() {
  const platform = { win32: 'windows', linux: 'linux', darwin: 'darwin' }[process.platform];
  const arch = { x64: 'amd64', arm64: 'arm64' }[os.arch()];
  if (!platform || !arch) throw new Error(`No LiveKit build for ${process.platform}/${os.arch()}.`);
  console.log('[livekit] looking up the latest LiveKit server release…');
  const res = await fetch('https://api.github.com/repos/livekit/livekit/releases/latest', {
    headers: { 'User-Agent': 'skypy-setup', Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
  const release = await res.json();
  const asset = release.assets.find((a) => a.name.includes(`_${platform}_${arch}.`));
  if (!asset) {
    if (process.platform === 'darwin') {
      throw new Error('Install LiveKit with Homebrew: `brew install livekit`, then run `npm run dev` again.');
    }
    throw new Error(`Release ${release.tag_name} has no ${platform}/${arch} build.`);
  }
  fs.mkdirSync(binDir, { recursive: true });
  const archive = path.join(binDir, asset.name);
  console.log(`[livekit] downloading ${asset.name}…`);
  const file = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'skypy-setup' } });
  if (!file.ok) throw new Error(`Download failed with ${file.status}`);
  fs.writeFileSync(archive, Buffer.from(await file.arrayBuffer()));
  if (process.platform === 'win32') {
    // Use Windows' own bsdtar (reads .zip); a GNU tar from Git Bash may shadow it on PATH.
    const systemTar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    let ok = fs.existsSync(systemTar) && spawnSync(systemTar, ['-xf', archive, '-C', binDir], { stdio: 'inherit' }).status === 0;
    if (!ok) {
      const ps = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${binDir}' -Force`],
        { stdio: 'inherit' },
      );
      ok = ps.status === 0;
    }
    if (!ok) throw new Error('Could not extract the LiveKit archive.');
  } else {
    const tar = spawnSync('tar', ['-xf', archive, '-C', binDir], { stdio: 'inherit' });
    if (tar.status !== 0) throw new Error('Could not extract the LiveKit archive (is `tar` installed?).');
  }
  fs.rmSync(archive, { force: true });
  const target = path.join(binDir, exe);
  if (!fs.existsSync(target)) throw new Error(`Extracted archive did not contain ${exe}.`);
  if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
  console.log(`[livekit] installed ${release.tag_name} to ${path.relative(root, target)}`);
  return target;
}

/** Local dev server: loopback only, quiet logs, well-known dev keys (devkey/secret). */
export const LIVEKIT_DEV_ARGS = ['--dev', '--bind', '127.0.0.1', '--node-ip', '127.0.0.1', '--logging.level', 'warn'];

export async function ensureLivekit() {
  const local = path.join(binDir, exe);
  if (fs.existsSync(local)) return local;
  return onPath() ?? (await download());
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const binary = await ensureLivekit();
  console.log(`[livekit] starting ${binary} --dev (ws://localhost:7880, key "devkey", secret "secret")`);
  const child = spawn(binary, LIVEKIT_DEV_ARGS, { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill());
}
