// Browser-side persistence. Every access is guarded: storage can be blocked
// (private windows, strict settings) and the app must keep working without it.

function read<T>(store: Storage | undefined, key: string, fallback: T): T {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(store: Storage | undefined, key: string, value: unknown): void {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

const local = (() => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
})();
const session = (() => {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
})();

export function randomId(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let s = '';
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ───────────── device identity: who this browser is, across meetings ─────────────

export const deviceKey: string = (() => {
  const existing = read<string | null>(local, 'skypy.device', null);
  if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
  const key = randomId(18);
  write(local, 'skypy.device', key);
  return key;
})();

// ───────────── tab identity: survives reloads, not duplicated tabs ─────────────
// We take the id out of sessionStorage while the page is alive and put it back
// on pagehide. A reload finds it again; "Duplicate tab" (which copies
// sessionStorage) does not, so two tabs never share one identity.

export const tabId: string = (() => {
  const KEY = 'skypy.tab';
  let id = read<string | null>(session, KEY, null);
  try {
    session?.removeItem(KEY);
  } catch {
    /* ignore */
  }
  if (!id || !/^[A-Za-z0-9_-]{6,64}$/.test(id)) id = randomId(9);
  const stash = () => write(session, KEY, id);
  const unstash = () => {
    try {
      session?.removeItem(KEY);
    } catch {
      /* ignore */
    }
  };
  window.addEventListener('pagehide', stash);
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) unstash();
  });
  return id;
})();

// ───────────── names, host keys, invites ─────────────

export function savedName(): string {
  return read<string>(local, 'skypy.name', '');
}

export function saveName(name: string): void {
  write(local, 'skypy.name', name);
}

export interface HostedRoom {
  id: string;
  name: string;
  hostKey: string;
  createdAt: number;
  lastOpened: number;
}

export function hostedRooms(): HostedRoom[] {
  const list = read<HostedRoom[]>(local, 'skypy.rooms', []);
  return Array.isArray(list) ? list.filter((r) => r && typeof r.id === 'string' && typeof r.hostKey === 'string') : [];
}

export function rememberHostedRoom(room: { id: string; name: string; hostKey: string }): void {
  const list = hostedRooms().filter((r) => r.id !== room.id);
  const existing = hostedRooms().find((r) => r.id === room.id);
  list.unshift({
    id: room.id,
    name: room.name,
    hostKey: room.hostKey,
    createdAt: existing?.createdAt ?? Date.now(),
    lastOpened: Date.now(),
  });
  write(local, 'skypy.rooms', list.slice(0, 50));
}

export function forgetHostedRoom(id: string): void {
  write(
    local,
    'skypy.rooms',
    hostedRooms().filter((r) => r.id !== id),
  );
}

export function hostKeyFor(roomId: string): string | undefined {
  return hostedRooms().find((r) => r.id === roomId)?.hostKey;
}

export function inviteFor(roomId: string): string | undefined {
  return read<Record<string, string>>(local, 'skypy.invites', {})[roomId];
}

export function saveInvite(roomId: string, token: string): void {
  const all = read<Record<string, string>>(local, 'skypy.invites', {});
  all[roomId] = token;
  write(local, 'skypy.invites', all);
}

// ───────────── preferences ─────────────

export interface MediaPrefs {
  camId?: string;
  micId?: string;
  speakerId?: string;
  camOn: boolean;
  micOn: boolean;
}

export function mediaPrefs(): MediaPrefs {
  return { camOn: true, micOn: true, ...read<Partial<MediaPrefs>>(local, 'skypy.media', {}) };
}

export function saveMediaPrefs(patch: Partial<MediaPrefs>): void {
  write(local, 'skypy.media', { ...mediaPrefs(), ...patch });
}

export type LayoutPref = 'room' | 'auto' | 'sides' | 'stacked';

export interface UiPrefs {
  showEmpty: boolean;
  layout: LayoutPref;
  split: { sides: number | null; stacked: number | null };
  mirror: boolean;
}

const UI_DEFAULTS: UiPrefs = {
  showEmpty: true,
  layout: 'room',
  split: { sides: null, stacked: null },
  mirror: true,
};

export function uiPrefs(): UiPrefs {
  const p = read<Partial<UiPrefs>>(local, 'skypy.ui', {});
  return { ...UI_DEFAULTS, ...p, split: { ...UI_DEFAULTS.split, ...(p.split ?? {}) } };
}

export function saveUiPrefs(p: UiPrefs): void {
  write(local, 'skypy.ui', p);
}
