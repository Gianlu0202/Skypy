import { expect, test } from '@playwright/test';
import { closeAll, createRoom, join, store, type Person } from './helpers.ts';

test('chat, raised hands and reactions reach everyone', async ({ browser }) => {
  const room = await createRoom({ name: 'Chat', rows: 2, cols: 3 });
  const people: Person[] = [];
  try {
    const host = await join(browser, room, 'Prof Bill', { hostKey: room.hostKey });
    const guest = await join(browser, room, 'Curious Student');
    people.push(host, guest);

    await guest.page.getByRole('button', { name: 'Chat' }).click();
    const box = guest.page.getByRole('textbox', { name: 'Message everyone' });
    await box.fill('Is this on the exam? https://example.com/syllabus');
    await box.press('Enter');
    await expect(host.page.locator('.toast')).toContainText('Is this on the exam?');
    await host.page.getByRole('button', { name: 'Chat' }).click();
    await expect(host.page.locator('.msg-text a')).toHaveAttribute('href', 'https://example.com/syllabus');

    // Late joiners see the chat history.
    const late = await join(browser, room, 'Late Student');
    people.push(late);
    await expect.poll(async () => (await store(late.page)).chat.length).toBe(1);

    // Raise a hand with the keyboard shortcut.
    await guest.page.locator('.canvas').click({ position: { x: 5, y: 5 } });
    await guest.page.keyboard.press('h');
    const guestId = (await store(guest.page)).sessionId!;
    await expect(host.page.locator(`.tile[data-identity="${guestId}"] .tile-hand`)).toBeVisible();
    await expect(host.page.locator('.toast', { hasText: 'Curious Student raised a hand' })).toBeVisible();
    // Host lowers it from the people panel.
    await host.page.getByRole('button', { name: 'People' }).click();
    await host.page.locator('.hand-row').getByRole('button', { name: 'Lower' }).click();
    await expect(host.page.locator(`.tile[data-identity="${guestId}"] .tile-hand`)).toHaveCount(0);

    // Reactions float over the sender's face for everyone.
    await guest.page.getByRole('button', { name: 'Send a reaction' }).click();
    await guest.page.getByRole('button', { name: 'React 👏' }).click();
    await expect(host.page.locator('.float-emoji', { hasText: '👏' })).toBeVisible();
  } finally {
    await closeAll(people);
  }
});

test('host can mute and remove people; removed people cannot rejoin', async ({ browser }) => {
  const room = await createRoom({ name: 'Moderation', rows: 2, cols: 3 });
  const people: Person[] = [];
  try {
    const host = await join(browser, room, 'Prof Bill', { hostKey: room.hostKey });
    const noisy = await join(browser, room, 'Noisy Student');
    people.push(host, noisy);
    await expect.poll(async () => (await store(noisy.page)).mic).toBe(true);
    const noisyId = (await store(noisy.page)).sessionId!;
    // Wait until the host actually receives the student's microphone.
    await expect(host.page.locator(`.tile[data-identity="${noisyId}"] .tile-muted`)).toHaveCount(0);

    // Mute
    await host.page.locator(`.tile[data-identity="${noisyId}"]`).hover();
    await host.page.locator(`.tile[data-identity="${noisyId}"] .tile-more`).click();
    await host.page.getByRole('menuitem', { name: 'Mute' }).click();
    await expect(noisy.page.locator('.toast', { hasText: 'Prof Bill muted you' })).toBeVisible();
    await expect.poll(async () => (await store(noisy.page)).mic).toBe(false);
    await expect(host.page.locator(`.tile[data-identity="${noisyId}"] .tile-muted`)).toBeVisible();
    // They can unmute themselves.
    await noisy.page.getByRole('button', { name: /Unmute microphone/ }).click();
    await expect.poll(async () => (await store(noisy.page)).mic).toBe(true);

    // Remove
    host.page.once('dialog', (d) => void d.accept());
    await host.page.locator(`.tile[data-identity="${noisyId}"]`).hover();
    await host.page.locator(`.tile[data-identity="${noisyId}"] .tile-more`).click();
    await host.page.getByRole('menuitem', { name: 'Remove from meeting' }).click();
    await expect(noisy.page.getByRole('heading', { name: 'You were removed from the meeting' })).toBeVisible();
    await expect.poll(async () => (await store(host.page)).state?.sessions.length).toBe(1);

    // Trying again from the same device is refused while the meeting runs.
    await noisy.page.goto(`/r/${room.id}`);
    await noisy.page.getByPlaceholder('Your full name').fill('Noisy Student');
    await noisy.page.getByRole('button', { name: /Join now/ }).click();
    await expect(noisy.page.getByText('The host removed you from this meeting.')).toBeVisible();
  } finally {
    await closeAll(people);
  }
});

test('co-hosts get host controls', async ({ browser }) => {
  const room = await createRoom({ name: 'Cohost', rows: 2, cols: 3 });
  const people: Person[] = [];
  try {
    const host = await join(browser, room, 'Prof Bill', { hostKey: room.hostKey });
    const ta = await join(browser, room, 'Teaching Assistant');
    people.push(host, ta);
    await expect(ta.page.getByRole('button', { name: 'Seating & room settings' })).toHaveCount(0);
    const taId = (await store(ta.page)).sessionId!;
    await host.page.locator(`.tile[data-identity="${taId}"]`).hover();
    await host.page.locator(`.tile[data-identity="${taId}"] .tile-more`).click();
    await host.page.getByRole('menuitem', { name: 'Make co-host' }).click();
    await expect(ta.page.getByRole('button', { name: 'Seating & room settings' })).toBeVisible();
    await expect(ta.page.locator('.toast', { hasText: 'co-host' })).toBeVisible();
  } finally {
    await closeAll(people);
  }
});

test('nobody can knock others out by reusing a visible session id', async ({ browser }) => {
  const room = await createRoom({ name: 'Spoof', rows: 2, cols: 3 });
  const people: Person[] = [];
  const sockets: WebSocket[] = [];
  try {
    const host = await join(browser, room, 'Prof Bill', { hostKey: room.hostKey });
    people.push(host);
    const hostId = (await store(host.page)).sessionId!;
    // An attacker sees every session id in the room state and tries to reuse
    // the tab part of the host's id from a script.
    const tabPart = hostId.split('.')[1];
    const url = (process.env.BASE ?? 'http://localhost:3000').replace(/^http/, 'ws') + '/ws';
    const ws = new WebSocket(url);
    sockets.push(ws);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('socket error'));
    });
    const reply = new Promise<{ t: string }>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(String(e.data));
        if (msg.t === 'welcome' || msg.t === 'denied') resolve(msg);
      };
    });
    ws.send(JSON.stringify({ t: 'hello', roomId: room.id, name: 'Mallory', deviceKey: 'attackerdevicekey000', tabId: tabPart }));
    expect((await reply).t).toBe('welcome');
    // The host is still in the meeting, still the host, alongside the attacker.
    await expect.poll(async () => (await store(host.page)).state?.sessions.length).toBe(2);
    const s = await store(host.page);
    expect(s.state!.sessions.find((x) => x.id === hostId)?.away).toBe(false);
    expect(s.host).toBe(true);
    expect(s.ended).toBeNull();
  } finally {
    sockets.forEach((w) => w.close());
    await closeAll(people);
  }
});

test('co-hosts never receive the room’s host key', async ({ browser }) => {
  const room = await createRoom({ name: 'Keys', rows: 2, cols: 3 });
  const people: Person[] = [];
  try {
    const host = await join(browser, room, 'Prof Bill', { hostKey: room.hostKey });
    const ta = await join(browser, room, 'Teaching Assistant');
    people.push(host, ta);
    expect((await store(host.page)).hostData?.hostKey).toBe(room.hostKey);
    const taId = (await store(ta.page)).sessionId!;
    await host.page.locator(`.tile[data-identity="${taId}"]`).hover();
    await host.page.locator(`.tile[data-identity="${taId}"] .tile-more`).click();
    await host.page.getByRole('menuitem', { name: 'Make co-host' }).click();
    await expect.poll(async () => (await store(ta.page)).host).toBe(true);
    const taStore = await store(ta.page);
    expect(taStore.hostData).not.toBeNull();
    expect(taStore.hostData?.hostKey ?? null).toBeNull();
    await ta.page.getByRole('button', { name: 'Seating & room settings' }).click();
    await expect(ta.page.getByRole('button', { name: 'Host link' })).toHaveCount(0);
  } finally {
    await closeAll(people);
  }
});
