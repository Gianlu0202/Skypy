// Cross-browser check: Chrome host + Firefox guest see each other's video.
import { chromium, firefox } from '@playwright/test';
const BASE = process.env.BASE ?? 'http://localhost:3000';
const room = await (
  await fetch(BASE + '/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Firefox check', rows: 2, cols: 3 }),
  })
).json();
const cr = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ff = await firefox.launch({
  firefoxUserPrefs: {
    'media.navigator.streams.fake': true,
    'media.navigator.permission.disabled': true,
    'media.autoplay.default': 0,
    'media.peerconnection.ice.loopback': true,
  },
});
async function join(browser, name, host, perms) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ...(perms ? { permissions: ['camera', 'microphone'] } : {}),
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] PAGEERROR ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[${name}] console.error ${m.text().slice(0, 200)}`);
  });
  await page.goto(`${BASE}/r/${room.id}${host ? `?host=${room.hostKey}` : ''}`);
  await page.getByPlaceholder('Your full name').fill(name);
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Join now/ }).click();
  await page.waitForSelector('.toolbar');
  return page;
}
const host = await join(cr, 'Chrome Host', true, true);
const guest = await join(ff, 'Firefox Guest', false, false);
await host.waitForTimeout(5000);
const vids = (p) => p.evaluate(() => [...document.querySelectorAll('.tile video')].map((v) => `${v.videoWidth}x${v.videoHeight}`));
const st = (p) =>
  p.evaluate(() => {
    const s = window.__skypy.state();
    return { media: s.media, mic: s.mic, cam: s.cam, people: s.state?.sessions.length, audioBlocked: s.audioBlocked };
  });
console.log('chrome host :', JSON.stringify(await st(host)), await vids(host));
console.log('firefox     :', JSON.stringify(await st(guest)), await vids(guest));
await guest.getByRole('button', { name: 'Chat' }).click();
await guest.getByRole('textbox', { name: 'Message everyone' }).fill('hello from firefox');
await guest.keyboard.press('Enter');
await host.waitForTimeout(800);
console.log('host got chat:', await host.evaluate(() => window.__skypy.state().chat.map((m) => m.text)));
await guest.screenshot({ path: process.argv[2] ?? 'firefox.png' });
await cr.close();
await ff.close();
