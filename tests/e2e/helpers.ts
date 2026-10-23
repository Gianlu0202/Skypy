import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { RoomState } from '../../shared/protocol.ts';

export interface Room {
  id: string;
  hostKey: string;
}

export interface Person {
  ctx: BrowserContext;
  page: Page;
  name: string;
}

export const BASE = process.env.BASE ?? 'http://localhost:3000';

export async function createRoom(opts: { name?: string; rows?: number; cols?: number; slug?: string } = {}): Promise<Room> {
  const res = await fetch(`${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: opts.name ?? 'Test room', rows: opts.rows ?? 5, cols: opts.cols ?? 8, slug: opts.slug }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Room;
}

export async function newContext(browser: Browser, viewport = { width: 1400, height: 860 }): Promise<BrowserContext> {
  return browser.newContext({ baseURL: BASE, viewport, permissions: ['camera', 'microphone'] });
}

/** Open the room link, type a name and join. */
export async function join(
  browser: Browser,
  room: Room,
  name: string,
  opts: { hostKey?: string; invite?: string; ctx?: BrowserContext; viewport?: { width: number; height: number } } = {},
): Promise<Person> {
  const ctx = opts.ctx ?? (await newContext(browser, opts.viewport));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] page error: ${e.message}`));
  const q = opts.hostKey ? `?host=${opts.hostKey}` : opts.invite ? `?invite=${opts.invite}` : '';
  await page.goto(`/r/${room.id}${q}`);
  await enterAndJoin(page, name);
  return { ctx, page, name };
}

export async function enterAndJoin(page: Page, name: string): Promise<void> {
  const input = page.getByPlaceholder('Your full name');
  await input.fill(name);
  await page.getByRole('button', { name: /Join now/ }).click();
  await page.waitForSelector('.toolbar');
  await expect.poll(() => sessionId(page)).not.toBeNull();
}

export async function store(page: Page): Promise<{ state: RoomState | null; sessionId: string | null; memberId: string | null; host: boolean; hostData: { invites: Record<string, string> } | null; media: string; mic: boolean; cam: boolean; chat: { text: string; name: string }[] }> {
  return page.evaluate(() => (window as unknown as { __skypy: { state: () => unknown } }).__skypy.state() as never);
}

export async function sessionId(page: Page): Promise<string | null> {
  return (await store(page)).sessionId;
}

export async function seatOf(page: Page): Promise<number | null> {
  const s = await store(page);
  return s.state?.sessions.find((x) => x.id === s.sessionId)?.seat ?? null;
}

/** Seat index → name of whoever sits there, as seen by this page. */
export async function seating(page: Page): Promise<Record<number, string>> {
  const s = await store(page);
  const out: Record<number, string> = {};
  for (const x of s.state?.sessions ?? []) if (x.seat !== null) out[x.seat] = x.name;
  return out;
}

export async function reservedName(page: Page, seat: number): Promise<string | null> {
  const s = await store(page);
  const id = s.state?.seats[seat];
  return id ? (s.state?.members.find((m) => m.id === id)?.name ?? null) : null;
}

export async function leave(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Leave meeting' }).click();
  await expect(page.getByRole('heading', { name: 'You left the meeting' })).toBeVisible();
}

export async function rejoin(page: Page, name?: string): Promise<void> {
  await page.getByRole('button', { name: 'Rejoin' }).click();
  const input = page.getByPlaceholder('Your full name');
  await expect(input).toBeVisible();
  if (name) await input.fill(name);
  await page.getByRole('button', { name: /Join now/ }).click();
  await page.waitForSelector('.toolbar');
  await expect.poll(() => sessionId(page)).not.toBeNull();
}

export async function waitForCount(page: Page, n: number): Promise<void> {
  await expect.poll(async () => (await store(page)).state?.sessions.length ?? 0).toBe(n);
}

export async function closeAll(people: Person[]): Promise<void> {
  await Promise.all(people.map((p) => p.ctx.close().catch(() => {})));
}
