import fs from 'node:fs';
import { chromium } from '@playwright/test';
// Screenshot tour of the meeting UI (panels, menus, phone layout) for visual review.
// Usage: node tests/visual/ui-tour.mjs [outDir]   (BASE env var, default http://localhost:3000)
const BASE = process.env.BASE ?? 'http://localhost:3000',
  OUT = process.argv[2] ?? 'ui-shots';
fs.mkdirSync(OUT, { recursive: true });
const NAMES = ['Ada Lovelace', 'Alan Turing', 'Grace Hopper', 'Claude Shannon', 'Barbara Liskov'];
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const room = await (
  await fetch(BASE + '/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'CS 229 · Thursday Seminar', rows: 4, cols: 6 }),
  })
).json();
async function join(name, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport ?? { width: 1440, height: 900 },
    permissions: ['camera', 'microphone'],
    isMobile: !!opts.mobile,
    hasTouch: !!opts.mobile,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(name, 'PAGEERROR', e.message));
  await page.goto(`${BASE}/r/${room.id}${opts.host ? `?host=${room.hostKey}` : ''}`);
  await page.getByPlaceholder('Your full name').fill(name);
  await page.getByRole('button', { name: /Join now/ }).click();
  await page.waitForSelector('.toolbar');
  return page;
}
const host = await join('Bill Professor', { host: true });
const guests = [];
for (const n of NAMES) guests.push(await join(n, { viewport: { width: 900, height: 600 } }));
await host.waitForTimeout(2500);
// chat + hand
await guests[0].getByRole('button', { name: 'Chat' }).click();
await guests[0]
  .getByRole('textbox', { name: 'Message everyone' })
  .fill('Quick question about problem set 3 — is question 2b about the bias term?');
await guests[0].keyboard.press('Enter');
await guests[1].getByRole('button', { name: /Raise hand/ }).click();
await guests[3].getByRole('button', { name: /Raise hand/ }).click();
await host.waitForTimeout(800);
await host.screenshot({ path: `${OUT}/01-toasts.png` });
await host.getByRole('button', { name: 'People' }).click();
await host.waitForTimeout(500);
await host.screenshot({ path: `${OUT}/02-people.png` });
await host.getByRole('button', { name: 'Chat' }).click();
await host.getByRole('textbox', { name: 'Message everyone' }).fill('Yes — see slide 14. Link: https://example.edu/cs229/ps3');
await host.keyboard.press('Enter');
await host.waitForTimeout(500);
await host.screenshot({ path: `${OUT}/03-chat.png` });
await host.getByRole('button', { name: 'Seating & room settings' }).click();
await host.waitForTimeout(500);
await host.screenshot({ path: `${OUT}/04-seats.png` });
await host.locator('.seat-cell').nth(10).click();
await host.waitForTimeout(300);
await host.screenshot({ path: `${OUT}/05-seat-editor.png` });
await host.keyboard.press('Escape');
await host.getByRole('button', { name: 'Close panel' }).click();
await host.getByRole('button', { name: 'More options' }).click();
await host.waitForTimeout(300);
await host.screenshot({ path: `${OUT}/06-more-menu.png` });
await host.getByRole('menuitemcheckbox', { name: /Arrange seats/ }).click();
await host.waitForTimeout(600);
await host.screenshot({ path: `${OUT}/07-arrange.png` });
await host.getByRole('button', { name: 'Done' }).click();
await host.getByRole('button', { name: 'More options' }).click();
await host.getByRole('menuitem', { name: 'Settings' }).click();
await host.waitForTimeout(500);
await host.screenshot({ path: `${OUT}/08-settings.png` });
await host.keyboard.press('Escape');
// mobile
const phone = await join('Mobile Student', { viewport: { width: 390, height: 844 }, mobile: true });
await phone.waitForTimeout(2500);
await phone.screenshot({ path: `${OUT}/09-mobile.png` });
await guests[2]
  .getByRole('button', { name: 'Share screen' })
  .click()
  .catch(() => {});
await phone.waitForTimeout(3000);
await phone.screenshot({ path: `${OUT}/10-mobile-share.png` });
await phone.getByRole('button', { name: 'Chat' }).click();
await phone.waitForTimeout(500);
await phone.screenshot({ path: `${OUT}/11-mobile-chat.png` });
await browser.close();
