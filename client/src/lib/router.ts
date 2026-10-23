import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
window.addEventListener('popstate', () => listeners.forEach((l) => l()));

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  listeners.forEach((l) => l());
  window.scrollTo(0, 0);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

/** Room id from /r/:id, or null. */
export function roomIdFromPath(path: string): string | null {
  const m = /^\/r\/([a-z0-9-]{3,40})\/?$/i.exec(path);
  return m ? m[1].toLowerCase() : null;
}

/** Accepts a full link, a /r/ path, or a bare room code. */
export function parseRoomInput(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return roomIdFromPath(url.pathname);
  } catch {
    /* not a URL */
  }
  const fromPath = roomIdFromPath(text.startsWith('/') ? text : `/r/${text}`);
  return fromPath;
}
