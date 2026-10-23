import { expect, test } from '@playwright/test';
import { closeAll, createRoom, join, seatOf, store, type Person } from './helpers.ts';

test('reloading the page keeps your seat and never duplicates you', async ({ browser }) => {
  const room = await createRoom({ name: 'Reload', rows: 2, cols: 4 });
  const people: Person[] = [];
  try {
    const host = await join(browser, room, 'Prof Bill', { hostKey: room.hostKey });
    const a = await join(browser, room, 'Student A');
    const b = await join(browser, room, 'Student B');
    people.push(host, a, b);
    expect(await seatOf(b.page)).toBe(2);
    const before = (await store(b.page)).sessionId;

    await b.page.reload();
    await b.page.getByRole('button', { name: /Join now/ }).click();
    await b.page.waitForSelector('.toolbar');
    await expect.poll(() => seatOf(b.page)).toBe(2);
    expect((await store(b.page)).sessionId).toBe(before);
    // Host still sees exactly three people (no ghost of the old tab).
    await expect.poll(async () => (await store(host.page)).state?.sessions.length).toBe(3);
    await expect(host.page.locator('.tile')).toHaveCount(3);
  } finally {
    await closeAll(people);
  }
});

test('a dropped connection recovers into the same seat', async ({ browser }) => {
  const room = await createRoom({ name: 'Offline', rows: 2, cols: 4 });
  const people: Person[] = [];
  try {
    const host = await join(browser, room, 'Prof Bill', { hostKey: room.hostKey });
    const flaky = await join(browser, room, 'Flaky Wifi');
    people.push(host, flaky);
    const id = (await store(flaky.page)).sessionId!;
    await expect.poll(async () => (await store(flaky.page)).media).toBe('connected');

    await flaky.ctx.setOffline(true);
    // Host sees the seat held with a reconnecting badge.
    await expect(host.page.locator(`.tile[data-identity="${id}"] .tile-status`)).toBeVisible({ timeout: 40_000 });
    await expect(flaky.page.locator('.banner')).toBeVisible({ timeout: 40_000 });

    await flaky.ctx.setOffline(false);
    await expect.poll(async () => (await store(flaky.page)).signal, { timeout: 30_000 }).toBe('open');
    await expect.poll(async () => (await store(flaky.page)).media, { timeout: 45_000 }).toBe('connected');
    expect(await seatOf(flaky.page)).toBe(1);
    await expect(host.page.locator(`.tile[data-identity="${id}"] .tile-status`)).toHaveCount(0, { timeout: 30_000 });
  } finally {
    await closeAll(people);
  }
});

test('a duplicated tab joins as a separate connection', async ({ browser }) => {
  const room = await createRoom({ name: 'Dup', rows: 2, cols: 4 });
  const people: Person[] = [];
  try {
    const host = await join(browser, room, 'Prof Bill', { hostKey: room.hostKey });
    const a = await join(browser, room, 'Two Tabs');
    people.push(host, a);
    // Second tab in the same browser (same device key, new tab id).
    const tab2 = await a.ctx.newPage();
    await tab2.goto(`/r/${room.id}`);
    await tab2.getByRole('button', { name: /Join now/ }).click();
    await tab2.waitForSelector('.toolbar');
    await expect.poll(async () => (await store(host.page)).state?.sessions.length).toBe(3);
    // First tab is still in the meeting, in its own seat.
    expect(await seatOf(a.page)).toBe(1);
    expect((await store(a.page)).ended ?? null).toBeNull();
  } finally {
    await closeAll(people);
  }
});
