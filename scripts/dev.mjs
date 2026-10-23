// One command to run everything locally.
//   node scripts/dev.mjs          → LiveKit (dev) + API server (watch) + Vite dev server
//   node scripts/dev.mjs --prod   → LiveKit (dev) + built app on http://localhost:3000
// If LIVEKIT_URL is configured (env or .env) the local LiveKit server is skipped.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIVEKIT_DEV_ARGS, ensureLivekit } from './livekit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prod = process.argv.includes('--prod');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const children = [];
const colors = { livekit: 35, server: 36, web: 32 };

function run(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: root,
    env: { ...process.env, FORCE_COLOR: '1', ...opts.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: opts.shell ?? false,
    windowsHide: true,
  });
  const prefix = `\x1b[${colors[name] ?? 37}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const line of lines) if (!opts.filter || opts.filter(line)) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`${prefix}exited (${signal ?? code}). Stopping everything.`);
      shutdown(code ?? 1);
    }
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (c.exitCode === null) {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { windowsHide: true });
      else c.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(code), 600);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

if (!process.env.LIVEKIT_URL) {
  const binary = await ensureLivekit();
  // LiveKit is chatty at info level; only surface warnings and errors.
  run('livekit', binary, LIVEKIT_DEV_ARGS, {
    filter: (line) => /WARN|ERROR|FATAL|panic|starting LiveKit/i.test(line) && !/CPU monitoring unsupported/.test(line),
  });
} else {
  console.log(`[dev] using LiveKit at ${process.env.LIVEKIT_URL}`);
}

const node = process.execPath;
const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

if (prod) {
  if (!fs.existsSync(path.join(root, 'dist', 'server', 'index.js'))) {
    console.error('[dev] No build found. Run `npm run build` first.');
    shutdown(1);
  } else {
    run('server', node, ['dist/server/index.js']);
    console.log('\n  Skypy is starting on \x1b[1mhttp://localhost:3000\x1b[0m\n');
  }
} else {
  run('server', node, [tsx, 'watch', '--clear-screen=false', 'server/index.ts']);
  run('web', node, [vite]);
  console.log('\n  Open \x1b[1mhttp://localhost:5173\x1b[0m\n');
}
