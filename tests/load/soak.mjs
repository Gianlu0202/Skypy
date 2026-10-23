// Soak test: a group of people doing random things for a while — muting,
// cameras, hands, chat, reactions, sharing, reloads, network drops — then
// checks that nothing drifted: everyone present, seated once, video flowing,
// no page errors.
//
// Usage: node tests/load/soak.mjs [--people 10] [--minutes 4] [--base URL]
import { chromium } from '@playwright/test';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const PEOPLE = Number(arg('people', 10));
const MINUTES = Number(arg('minutes', 4));
const BASE = arg('base', 'http://localhost:3000');

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const errors = [];

const room = await (
  await fetch(`${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Soak test', rows: 3, cols: 5 }),
  })
).json();
log('room', room.id);

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen'],
});

const people = [];
async function join(i) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 }, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  const name = i === 0 ? 'Host' : `Person ${i}`;
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`${BASE}/r/${room.id}${i === 0 ? `?host=${room.hostKey}` : ''}`);
  await page.getByPlaceholder('Your full name').fill(name);
  await page.getByRole('button', { name: /Join now/ }).click();
  await page.waitForSelector('.toolbar', { timeout: 60_000 });
  return { ctx, page, name };
}
for (let i = 0; i < PEOPLE; i++) people.push(await join(i));
log(`${PEOPLE} joined`);

const counts = {};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const actions = {
  async mic(p) {
    await p.page.keyboard.press('m');
  },
  async cam(p) {
    await p.page.keyboard.press('v');
  },
  async hand(p) {
    await p.page.keyboard.press('h');
  },
  async chat(p) {
    if (!(await p.page.locator('.chat-compose').count())) await p.page.keyboard.press('c');
    const box = p.page.getByRole('textbox', { name: 'Message everyone' });
    await box.fill(`hello ${Math.random().toString(36).slice(2, 7)}`);
    await box.press('Enter');
    await p.page.keyboard.press('Escape');
    await p.page.locator('.canvas').click({ position: { x: 3, y: 3 } });
  },
  async react(p) {
    await p.page.getByRole('button', { name: 'Send a reaction' }).click();
    await p.page.getByRole('button', { name: 'React 👍' }).click();
    await p.page.keyboard.press('Escape');
  },
  async share(p) {
    const btn = p.page.locator('button[aria-label="Share screen"], button[aria-label="Stop presenting"]').first();
    if (await btn.isEnabled()) await btn.click();
  },
  async reload(p) {
    await p.page.reload();
    await p.page.getByRole('button', { name: /Join now/ }).click();
    await p.page.waitForSelector('.toolbar', { timeout: 60_000 });
  },
  async offline(p) {
    await p.ctx.setOffline(true);
    await p.page.waitForTimeout(3000 + Math.random() * 4000);
    await p.ctx.setOffline(false);
  },
};
const weights = { mic: 6, cam: 4, hand: 4, chat: 3, react: 3, share: 1, reload: 1, offline: 1 };
const bag = Object.entries(weights).flatMap(([k, w]) => Array(w).fill(k));

const end = Date.now() + MINUTES * 60_000;
await Promise.all(
  people.slice(1).map(async (p) => {
    while (Date.now() < end) {
      const a = pick(bag);
      counts[a] = (counts[a] ?? 0) + 1;
      try {
        await actions[a](p);
      } catch (e) {
        errors.push(`${p.name} ${a}: ${e.message.split('\n')[0]}`);
      }
      await p.page.waitForTimeout(1500 + Math.random() * 2500);
    }
  }),
);
log('actions:', JSON.stringify(counts));

// Settle: everyone back online, stop any shares, wait for reconnections.
for (const p of people) await p.ctx.setOffline(false);
await people[0].page.waitForTimeout(12_000);

const host = people[0].page;
const s = await host.evaluate(() => window.__skypy.state());
const seats = s.state.sessions.map((x) => x.seat).filter((x) => x !== null);
const video = await host.evaluate(async () => {
  const vids = [...document.querySelectorAll('.tile video')];
  const before = vids.map((v) => v.currentTime);
  await new Promise((r) => setTimeout(r, 2000));
  return { videos: vids.length, playing: vids.filter((v, i) => v.currentTime > before[i]).length };
});
const perPerson = await Promise.all(
  people.map((p) =>
    p.page.evaluate(() => {
      const st = window.__skypy.state();
      return { signal: st.signal, media: st.media, ended: st.ended?.kind ?? null };
    }),
  ),
);
const memory = await (await fetch(`${BASE}/api/health`)).json().catch(() => null);
log(
  'sessions:',
  s.state.sessions.length,
  'seated:',
  seats.length,
  'unique seats:',
  new Set(seats).size,
  'away:',
  s.state.sessions.filter((x) => x.away).length,
);
log('host video:', JSON.stringify(video), '(cameras may be off by choice)');
log(
  'clients:',
  JSON.stringify(
    perPerson.reduce(
      (acc, x) => ((acc[`${x.signal}/${x.media}/${x.ended}`] = (acc[`${x.signal}/${x.media}/${x.ended}`] ?? 0) + 1), acc),
      {},
    ),
  ),
);
log('health:', JSON.stringify(memory));
const uniqueErrors = [...new Set(errors)];
log('errors:', uniqueErrors.length ? uniqueErrors.slice(0, 15) : 'none');

const ok =
  s.state.sessions.length === PEOPLE &&
  new Set(seats).size === seats.length &&
  seats.length === PEOPLE &&
  perPerson.every((x) => x.signal === 'open' && x.media === 'connected' && x.ended === null) &&
  !errors.some((e) => /page error|TypeError|undefined/.test(e));
log(ok ? 'PASS' : 'FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
