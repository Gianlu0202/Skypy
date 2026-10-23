// Full-class load test: one real host browser plus N-1 simulated students.
// Each student publishes its own synthetic webcam (a canvas with their name),
// so every face on the host's screen is distinct. Verifies the host receives
// every face, in its seat, in gallery view and while someone shares.
//
// Usage: node tests/load/classroom.mjs [--people 40] [--base URL] [--shots DIR] [--per-browser 8]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { NAMES } from './names.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const PEOPLE = Number(arg('people', 40));
const BASE = arg('base', 'http://localhost:3000');
const SHOTS = path.resolve(arg('shots', 'load-shots'));
const ROWS = Number(arg('rows', 5));
const COLS = Number(arg('cols', 8));
const PER_BROWSER = Number(arg('per-browser', 8));
fs.mkdirSync(SHOTS, { recursive: true });

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// Replaces the camera with a canvas "webcam" showing the person's initials.
function fakeCamera({ name, hue, lite }) {
  window.__skypyLite = lite;
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints = {}) => {
    const stream = constraints.audio ? await real({ audio: constraints.audio }) : new MediaStream();
    if (!constraints.video) return stream;
    // Honour the requested capture size like a real camera would.
    const want = (v) => (typeof v === 'number' ? v : (v?.ideal ?? v?.exact ?? v?.max));
    const W = Math.round(want(constraints.video?.width) ?? 640);
    const H = Math.round(want(constraints.video?.height) ?? 480);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.scale(W / 640, H / 480);
    const initials = name
      .split(' ')
      .map((p) => p[0])
      .join('')
      .slice(0, 2);
    let t = 0;
    const draw = () => {
      t += 1;
      const g = ctx.createLinearGradient(0, 0, 640, 480);
      g.addColorStop(0, `hsl(${hue}, 45%, 32%)`);
      g.addColorStop(1, `hsl(${(hue + 50) % 360}, 50%, 22%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 640, 480);
      const bob = Math.sin(t / 8) * 6;
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.ellipse(320, 470 + bob, 170, 120, 0, Math.PI, 0);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(320, 215 + bob, 92, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = 'bold 84px Segoe UI, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initials, 320, 218 + bob);
    };
    draw();
    setInterval(draw, 1000 / 15);
    for (const track of canvas.captureStream(15).getVideoTracks()) stream.addTrack(track);
    return stream;
  };
  // Screen sharing shows a lecture slide instead of Chrome's test pattern.
  navigator.mediaDevices.getDisplayMedia = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const c = canvas.getContext('2d');
    let t = 0;
    const draw = () => {
      t += 1;
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, 1280, 720);
      c.fillStyle = '#8c1515';
      c.fillRect(0, 0, 1280, 10);
      c.fillStyle = '#1f2430';
      c.font = '600 46px Segoe UI, Arial, sans-serif';
      c.fillText('Gradient descent, intuitively', 80, 120);
      c.fillStyle = '#5b6474';
      c.font = '26px Segoe UI, Arial, sans-serif';
      c.fillText('Lecture 7 · Optimization', 80, 165);
      c.fillStyle = '#1f2430';
      c.font = '28px Segoe UI, Arial, sans-serif';
      const bullets = [
        'Follow the negative gradient downhill',
        'Step size η trades speed for stability',
        'Too large: overshoot. Too small: crawl',
        'Mini-batches add helpful noise',
      ];
      bullets.forEach((b, i) => {
        c.beginPath();
        c.arc(92, 258 + i * 70, 6, 0, Math.PI * 2);
        c.fill();
        c.fillText(b, 115, 268 + i * 70);
      });
      // loss curve
      const ox = 760,
        oy = 600,
        w = 440,
        h = 360;
      c.strokeStyle = '#c9cfdc';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(ox, oy - h);
      c.lineTo(ox, oy);
      c.lineTo(ox + w, oy);
      c.stroke();
      c.strokeStyle = '#4f7cff';
      c.lineWidth = 5;
      c.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const y = h * 0.9 * Math.exp(-x / 110) + 18 + Math.sin(x / 9) * 4;
        if (x === 0) c.moveTo(ox + x, oy - y);
        else c.lineTo(ox + x, oy - y);
      }
      c.stroke();
      c.fillStyle = '#5b6474';
      c.font = '22px Segoe UI, Arial, sans-serif';
      c.fillText('training loss', ox + w - 140, oy - h + 20);
      c.fillText('steps →', ox + w - 80, oy + 34);
      // laser pointer
      const px = ox + 60 + ((t * 6) % 360);
      const py = oy - (h * 0.9 * Math.exp(-(px - ox) / 110) + 18);
      c.fillStyle = 'rgba(229, 72, 77, 0.85)';
      c.beginPath();
      c.arc(px, py, 9, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#9aa2b1';
      c.font = '20px Segoe UI, Arial, sans-serif';
      c.fillText('CS 229 · Thursday Seminar', 80, 680);
    };
    draw();
    setInterval(draw, 1000 / 10);
    return canvas.captureStream(10);
  };
  if (lite) {
    // Simulated students don't need to paint video.
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'video { display: none !important; }';
      document.head.appendChild(style);
    });
  }
}

const res = await fetch(`${BASE}/api/rooms`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'CS 229 · Thursday Seminar', rows: ROWS, cols: COLS }),
});
const room = await res.json();
log('room', room.id, `${BASE}/r/${room.id}`);

const launchArgs = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--auto-select-desktop-capture-source=Entire screen',
];
const browsers = [];
async function newBrowser() {
  const b = await chromium.launch({ args: launchArgs });
  browsers.push(b);
  return b;
}

async function person(browser, i, { host = false, viewport = { width: 1280, height: 720 } } = {}) {
  const ctx = await browser.newContext({ viewport, permissions: ['camera', 'microphone'] });
  await ctx.addInitScript(fakeCamera, { name: NAMES[i % NAMES.length], hue: (i * 47) % 360, lite: !host });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`[${NAMES[i]}] page error: ${e.message}`));
  await page.goto(`${BASE}/r/${room.id}${host ? `?host=${room.hostKey}` : ''}`);
  await page.getByPlaceholder('Your full name').fill(NAMES[i % NAMES.length]);
  await page.getByRole('button', { name: /Join now/ }).click();
  await page.waitForSelector('.toolbar', { timeout: 60_000 });
  return page;
}

const hostPage = await person(await newBrowser(), 0, { host: true, viewport: { width: 1920, height: 1080 } });
log('host joined');

const bots = [];
let botBrowser = null;
for (let i = 1; i < PEOPLE; i++) {
  if ((i - 1) % PER_BROWSER === 0) botBrowser = await newBrowser();
  bots.push(await person(botBrowser, i));
  if (i % 5 === 0 || i === PEOPLE - 1) log(`${i + 1}/${PEOPLE} joined`);
}

const state = () => hostPage.evaluate(() => window.__skypy.state());
let s = await state();
for (let tries = 0; s.state.sessions.length < PEOPLE && tries < 60; tries++) {
  await hostPage.waitForTimeout(500);
  s = await state();
}
log(`host sees ${s.state.sessions.length} people; seated: ${s.state.sessions.filter((x) => x.seat !== null).length}`);

async function videoStats() {
  return hostPage.evaluate(async () => {
    const vids = [...document.querySelectorAll('.tile video')];
    const before = vids.map((v) => v.currentTime);
    await new Promise((r) => setTimeout(r, 2000));
    return {
      tiles: document.querySelectorAll('.tile').length,
      videos: vids.length,
      decoding: vids.filter((v) => v.videoWidth > 0).length,
      playing: vids.filter((v, i) => v.currentTime > before[i]).length,
      sizes: [...new Set(vids.map((v) => `${v.videoWidth}x${v.videoHeight}`))],
    };
  });
}

let stats;
for (let tries = 0; tries < 30; tries++) {
  stats = await videoStats();
  if (stats.playing >= PEOPLE) break;
}
log('gallery video:', JSON.stringify(stats));
await hostPage.screenshot({ path: path.join(SHOTS, 'gallery-40.png') });

const fps = await hostPage.evaluate(
  () =>
    new Promise((resolve) => {
      let frames = 0;
      const start = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - start < 3000) requestAnimationFrame(tick);
        else resolve(Math.round((frames * 1000) / (performance.now() - start)));
      };
      requestAnimationFrame(tick);
    }),
);
log(`host UI frame rate with ${PEOPLE} videos: ${fps} fps`);

// A student presents.
const presenter = bots[2];
log('presenter media:', await presenter.evaluate(() => window.__skypy.state().media));
await presenter.getByRole('button', { name: 'Share screen' }).click();
for (let i = 0; i < 20 && !(await presenter.evaluate(() => window.__skypy.state().sharing)); i++) await presenter.waitForTimeout(500);
log('presenter sharing:', await presenter.evaluate(() => window.__skypy.state().sharing));
await hostPage.waitForSelector('.stage video', { timeout: 90_000 });
log('host shows the shared screen');
await hostPage.waitForTimeout(3000);
const shareStats = await videoStats();
const geometry = await hostPage.evaluate(() => {
  const stage = document.querySelector('.stage').getBoundingClientRect();
  const faces = [...document.querySelectorAll('.tile')].map((t) => t.getBoundingClientRect());
  const overlapping = faces.filter((f) => !(f.right <= stage.left + 1 || f.left >= stage.right - 1)).length;
  const offscreen = faces.filter((f) => f.left < 0 || f.top < 0 || f.right > innerWidth || f.bottom > innerHeight).length;
  return {
    stage: `${Math.round(stage.width)}x${Math.round(stage.height)}`,
    faces: faces.length,
    faceSize: `${Math.round(faces[0].width)}x${Math.round(faces[0].height)}`,
    overlappingStage: overlapping,
    offscreen,
  };
});
log('while sharing:', JSON.stringify(shareStats), JSON.stringify(geometry));
await hostPage.screenshot({ path: path.join(SHOTS, 'share-40.png') });

await hostPage.getByRole('button', { name: 'More options' }).click();
await hostPage.getByRole('menuitemcheckbox', { name: /Faces above & below/ }).click();
await hostPage.keyboard.press('Escape');
await hostPage.waitForTimeout(1500);
await hostPage.screenshot({ path: path.join(SHOTS, 'share-40-stacked.png') });

const ok =
  s.state.sessions.length === PEOPLE &&
  stats.playing >= PEOPLE &&
  geometry.faces === PEOPLE &&
  geometry.overlappingStage === 0 &&
  geometry.offscreen === 0;
log(ok ? 'PASS' : 'FAIL', `— screenshots in ${SHOTS}`);
await Promise.all(browsers.map((b) => b.close()));
process.exit(ok ? 0 : 1);
