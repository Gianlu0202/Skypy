// Ad-hoc visual check: host + N guests join a room, take screenshots.
import { chromium } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const guests = Number(process.argv[2] ?? 3);
const out = process.argv[3] ?? 'shots';

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--auto-select-desktop-capture-source=Entire screen',
    '--enable-usermedia-screen-capturing',
    '--allow-http-screen-capture',
  ],
});
const res = await fetch(BASE + '/api/rooms', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'CS 229 · Thursday Seminar', rows: 5, cols: 8 }),
});
const room = await res.json();
console.log('room', room);

async function join(name, { host = false, w = 1600, h = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[${name}] ${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => console.log(`[${name}] PAGEERROR ${e.message}`));
  await page.goto(`${BASE}/r/${room.id}${host ? `?host=${room.hostKey}` : ''}`);
  await page.getByPlaceholder('Your full name').fill(name);
  await page.waitForTimeout(400);
  return { ctx, page };
}

const hostP = await join('Bill Professor', { host: true });
await hostP.page.screenshot({ path: `${out}/01-prejoin.png` });
await hostP.page.getByRole('button', { name: /Join now/ }).click();
await hostP.page.waitForSelector('.toolbar', { timeout: 15000 });
await hostP.page.waitForTimeout(2500);
await hostP.page.screenshot({ path: `${out}/02-host-alone.png` });

const names = [
  'Ada Lovelace',
  'Alan Turing',
  'Grace Hopper',
  'Katherine Johnson',
  'Claude Shannon',
  'Barbara Liskov',
  'Donald Knuth',
  'Margaret Hamilton',
  'John McCarthy',
  'Fei-Fei Li',
  'Andrew Ng',
  'Daphne Koller',
];
const gs = [];
for (let i = 0; i < guests; i++) {
  const g = await join(names[i % names.length] + (i >= names.length ? ` ${i}` : ''), { w: 1280, h: 800 });
  await g.page.getByRole('button', { name: /Join now/ }).click();
  await g.page.waitForSelector('.toolbar', { timeout: 15000 });
  gs.push(g);
}
await hostP.page.waitForTimeout(4000);
await hostP.page.screenshot({ path: `${out}/03-host-gallery.png` });
const vids = await hostP.page.evaluate(() => [...document.querySelectorAll('.tile video')].map((v) => `${v.videoWidth}x${v.videoHeight}`));
console.log('host sees videos:', vids.length, vids.slice(0, 6));

// share screen from a guest
if (gs[0]) {
  await gs[0].page.locator('button[aria-label="Share screen"]').click();
  await hostP.page.waitForTimeout(4000);
  await hostP.page.screenshot({ path: `${out}/04-host-share.png` });
  await gs[0].page.screenshot({ path: `${out}/05-sharer.png` });
}
await browser.close();
