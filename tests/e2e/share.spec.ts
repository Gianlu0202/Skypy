import { expect, test, type Page } from '@playwright/test';
import { closeAll, createRoom, join, store, type Person } from './helpers.ts';

async function rect(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  expect(box).toBeTruthy();
  return box!;
}

test('sharing puts the screen in the middle and keeps every face on screen', async ({ browser }) => {
  const room = await createRoom({ name: 'Share', rows: 3, cols: 4 });
  const people: Person[] = [];
  try {
    const host = await join(browser, room, 'Prof Bill', { hostKey: room.hostKey });
    people.push(host);
    for (const n of ['Ana', 'Ben', 'Cai', 'Dee', 'Eli']) people.push(await join(browser, room, n));
    const presenter = people[1];
    await expect.poll(async () => (await store(host.page)).state?.sessions.length).toBe(6);
    await expect.poll(async () => (await store(presenter.page)).media).toBe('connected');

    // Gallery: all 12 seats, no stage.
    await expect(host.page.locator('.tile')).toHaveCount(6);
    await expect(host.page.locator('.seat')).toHaveCount(6);
    await expect(host.page.locator('.stage')).toHaveCount(0);

    await presenter.page.getByRole('button', { name: 'Share screen' }).click();
    await expect(host.page.locator('.stage')).toBeVisible();
    await expect(host.page.locator('.stage-chip')).toContainText('Ana is presenting');
    await expect(host.page.locator('.stage video')).toBeVisible();
    // Video actually flows.
    await expect.poll(() => host.page.locator('.stage video').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);

    // Let the glide animation settle, then check geometry: every face is visible
    // and sits entirely left or right of the shared screen.
    await host.page.waitForTimeout(900);
    const stage = await rect(host.page, '.stage');
    const tiles = await host.page.locator('.tile, .seat').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    expect(tiles.length).toBe(12);
    const vw = host.page.viewportSize()!.width;
    for (const t of tiles) {
      const leftSide = t.right <= stage.x + 1;
      const rightSide = t.left >= stage.x + stage.width - 1;
      expect(leftSide || rightSide).toBe(true);
      expect(t.left).toBeGreaterThanOrEqual(0);
      expect(t.right).toBeLessThanOrEqual(vw);
    }
    expect(stage.width).toBeGreaterThan(vw * 0.45);

    // The presenter sees their own "presenting" card instead of a mirror.
    await expect(presenter.page.getByText('You’re presenting to everyone')).toBeVisible();

    // Switch this viewer to faces above & below.
    await host.page.getByRole('button', { name: 'More options' }).click();
    await host.page.getByRole('menuitemcheckbox', { name: /Faces above & below/ }).click();
    await host.page.keyboard.press('Escape');
    await host.page.waitForTimeout(900);
    const stage2 = await rect(host.page, '.stage');
    const tiles2 = await host.page.locator('.tile, .seat').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    for (const t of tiles2) expect(t.bottom <= stage2.y + 1 || t.top >= stage2.y + stage2.height - 1).toBe(true);

    // Stop sharing: back to the classroom.
    await presenter.page.getByRole('button', { name: 'Stop presenting' }).first().click();
    await expect(host.page.locator('.stage')).toHaveCount(0);
  } finally {
    await closeAll(people);
  }
});

test('host can spotlight a camera into the middle for everyone', async ({ browser }) => {
  const room = await createRoom({ name: 'Spotlight', rows: 2, cols: 3 });
  const people: Person[] = [];
  try {
    const host = await join(browser, room, 'Prof Bill', { hostKey: room.hostKey });
    const guest = await join(browser, room, 'Guest');
    people.push(host, guest);
    const hostId = (await store(host.page)).sessionId!;
    await host.page.locator(`.tile[data-identity="${hostId}"]`).hover();
    await host.page.locator(`.tile[data-identity="${hostId}"] .tile-more`).click();
    await host.page.getByRole('menuitem', { name: 'Spotlight for everyone' }).click();
    await expect(guest.page.locator('.stage-chip')).toContainText('Spotlight · Prof Bill');
    await expect(host.page.locator('.stage')).toBeVisible();
  } finally {
    await closeAll(people);
  }
});
