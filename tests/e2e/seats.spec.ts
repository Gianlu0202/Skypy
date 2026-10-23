import { expect, test } from '@playwright/test';
import { closeAll, createRoom, join, leave, rejoin, reservedName, seatOf, seating, store, waitForCount, type Person } from './helpers.ts';

test('people come back to their own seat, and everyone sees the same seating', async ({ browser }) => {
  const room = await createRoom({ name: 'Seats', rows: 2, cols: 4 });
  const people: Person[] = [];
  try {
    const host = await join(browser, room, 'Prof Bill', { hostKey: room.hostKey });
    people.push(host);
    const ada = await join(browser, room, 'Ada Lovelace');
    const alan = await join(browser, room, 'Alan Turing');
    people.push(ada, alan);
    expect(await seatOf(host.page)).toBe(0);
    expect(await seatOf(ada.page)).toBe(1);
    expect(await seatOf(alan.page)).toBe(2);

    // Ada leaves: her seat stays reserved for her.
    await leave(ada.page);
    await waitForCount(host.page, 2);
    expect(await reservedName(host.page, 1)).toBe('Ada Lovelace');

    // A newcomer does not take Ada's seat.
    const grace = await join(browser, room, 'Grace Hopper');
    people.push(grace);
    expect(await seatOf(grace.page)).toBe(3);

    // Ada comes back (same browser) and lands in seat 1 again.
    await rejoin(ada.page);
    expect(await seatOf(ada.page)).toBe(1);

    // Everyone agrees on who sits where.
    const expected = { 0: 'Prof Bill', 1: 'Ada Lovelace', 2: 'Alan Turing', 3: 'Grace Hopper' };
    for (const p of [host, ada, alan, grace]) await expect.poll(() => seating(p.page)).toEqual(expected);

    // The empty seat placeholder shows on screen too.
    await expect(host.page.locator('.seat', { hasText: 'B1' })).toBeVisible();
  } finally {
    await closeAll(people);
  }
});

test('joining from a new device with the same name finds the reserved seat', async ({ browser }) => {
  const room = await createRoom({ name: 'Names', rows: 2, cols: 3 });
  const people: Person[] = [];
  try {
    const host = await join(browser, room, 'Host', { hostKey: room.hostKey });
    const ada = await join(browser, room, 'Ada Lovelace');
    people.push(host, ada);
    const b = await join(browser, room, 'Bob');
    people.push(b);
    expect(await seatOf(ada.page)).toBe(1);
    await ada.ctx.close();
    await waitForCount(host.page, 2);
    // New browser (no shared device key), different capitalisation and spacing.
    const phone = await join(browser, room, '  ada   LOVELACE ');
    people.push(phone);
    expect(await seatOf(phone.page)).toBe(1);
  } finally {
    await closeAll(people);
  }
});

test('host pastes a class list; students land in their seats, including via personal links', async ({ browser }) => {
  const room = await createRoom({ name: 'Roster', rows: 2, cols: 4 });
  const people: Person[] = [];
  try {
    const host = await join(browser, room, 'Prof Bill', { hostKey: room.hostKey });
    people.push(host);
    await host.page.getByRole('button', { name: 'Seating & room settings' }).click();
    await host.page.getByRole('button', { name: 'Paste a class list' }).click();
    await host.page.locator('.roster textarea').fill('Zara Ahmed\nYusuf Brown\nXin Chen');
    await host.page.getByRole('button', { name: 'Fill empty seats' }).click();
    await expect.poll(() => reservedName(host.page, 2)).toBe('Yusuf Brown');
    expect(await reservedName(host.page, 1)).toBe('Zara Ahmed');
    expect(await reservedName(host.page, 3)).toBe('Xin Chen');

    // A student types their name and sits in their reserved seat.
    const yusuf = await join(browser, room, 'Yusuf Brown');
    people.push(yusuf);
    expect(await seatOf(yusuf.page)).toBe(2);

    // Personal link: joins straight into the seat even with a different name.
    const s = await store(host.page);
    const xin = s.state!.members.find((m) => m.name === 'Xin Chen')!;
    const invite = s.hostData!.invites[xin.id];
    expect(invite).toBeTruthy();
    const x = await join(browser, room, 'X. Chen', { invite });
    people.push(x);
    expect(await seatOf(x.page)).toBe(3);

    // Someone not on the list gets a free seat, not a reserved one.
    const walkIn = await join(browser, room, 'Walk In');
    people.push(walkIn);
    expect(await seatOf(walkIn.page)).toBe(4);
  } finally {
    await closeAll(people);
  }
});

test('host drags a face to another seat and everyone sees the move', async ({ browser }) => {
  const room = await createRoom({ name: 'Drag', rows: 2, cols: 4 });
  const people: Person[] = [];
  try {
    const host = await join(browser, room, 'Prof Bill', { hostKey: room.hostKey });
    const guest = await join(browser, room, 'Guest Student');
    people.push(host, guest);
    const guestId = (await store(guest.page)).sessionId!;
    expect(await seatOf(guest.page)).toBe(1);

    await host.page.getByRole('button', { name: 'More options' }).click();
    await host.page.getByRole('menuitemcheckbox', { name: /Arrange seats/ }).click();
    await expect(host.page.locator('.arrange-banner')).toBeVisible();

    const from = await host.page.locator(`.tile[data-identity="${guestId}"]`).boundingBox();
    const to = await host.page.locator('.seat', { hasText: 'B4' }).boundingBox();
    expect(from && to).toBeTruthy();
    await host.page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
    await host.page.mouse.down();
    await host.page.mouse.move(from!.x + from!.width / 2 + 20, from!.y + from!.height / 2 + 20, { steps: 4 });
    await host.page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 12 });
    await expect(host.page.locator('.drag-ghost')).toContainText('B4');
    await host.page.mouse.up();

    await expect.poll(() => seatOf(guest.page)).toBe(7);
    await expect.poll(() => reservedName(host.page, 7)).toBe('Guest Student');
    // The old seat is free again (reservation moved with the person).
    expect(await reservedName(host.page, 1)).toBeNull();
  } finally {
    await closeAll(people);
  }
});

test('a locked room only admits the class list and hosts', async ({ browser }) => {
  const room = await createRoom({ name: 'Locked', rows: 2, cols: 3 });
  const people: Person[] = [];
  try {
    const host = await join(browser, room, 'Prof Bill', { hostKey: room.hostKey });
    people.push(host);
    await host.page.getByRole('button', { name: 'Seating & room settings' }).click();
    await host.page.getByRole('button', { name: 'Paste a class list' }).click();
    await host.page.locator('.roster textarea').fill('Enrolled Student');
    await host.page.getByRole('button', { name: 'Fill empty seats' }).click();
    await host.page.locator('.switch-row', { hasText: 'Lock to class list' }).getByRole('switch').click();
    await expect.poll(async () => (await store(host.page)).state?.settings.locked).toBe(true);

    // A stranger is turned away with a clear message.
    const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const stranger = await ctx.newPage();
    await stranger.goto(`${process.env.BASE ?? 'http://localhost:3000'}/r/${room.id}`);
    await stranger.getByPlaceholder('Your full name').fill('Random Person');
    await stranger.getByRole('button', { name: /Join now/ }).click();
    await expect(stranger.getByRole('heading', { name: 'Can’t join this meeting' })).toBeVisible();
    await expect(stranger.getByText('This meeting is locked')).toBeVisible();
    await ctx.close();

    // The enrolled student gets in, into their seat.
    const student = await join(browser, room, 'Enrolled Student');
    people.push(student);
    expect(await seatOf(student.page)).toBe(1);
  } finally {
    await closeAll(people);
  }
});
