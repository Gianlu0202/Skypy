// Safari-engine (WebKit) rendering check of the home page and meeting UI.
import { webkit } from '@playwright/test';
const BASE = process.env.BASE ?? 'http://localhost:3000';
const out = process.argv[2] ?? '.';
const browser = await webkit.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(BASE + '/');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/webkit-home.png` });
const room = await (
  await fetch(BASE + '/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Safari check', rows: 3, cols: 4 }),
  })
).json();
await page.goto(`${BASE}/r/${room.id}?host=${room.hostKey}`);
await page.getByPlaceholder('Your full name').fill('Safari Host');
await page.waitForTimeout(1500);
console.log(
  'media apis:',
  await page.evaluate(() => ({
    gum: !!navigator.mediaDevices?.getUserMedia,
    rtc: typeof RTCPeerConnection,
    gdm: !!navigator.mediaDevices?.getDisplayMedia,
  })),
);
await page.screenshot({ path: `${out}/webkit-prejoin.png` });
await page.getByRole('button', { name: /Join now/ }).click();
await page.waitForSelector('.toolbar', { timeout: 20000 });
await page.waitForTimeout(3000);
console.log(
  'state:',
  JSON.stringify(
    await page.evaluate(() => {
      const s = window.__skypy.state();
      return { media: s.media, signal: s.signal, people: s.state?.sessions.length };
    }),
  ),
);
await page.screenshot({ path: `${out}/webkit-meeting.png` });
await browser.close();
