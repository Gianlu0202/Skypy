export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = Array.from(parts[0])[0] ?? '';
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? '') : '';
  return (first + last).toUpperCase();
}

// Muted, professional avatar colours that read well on dark tiles.
const AVATAR_COLORS = [
  ['#3b6ff5', '#6c8cff'],
  ['#0f9d8a', '#36c2ad'],
  ['#c2410c', '#f07a3d'],
  ['#7c3aed', '#a17bf5'],
  ['#be185d', '#e2559a'],
  ['#0369a1', '#2b9bd8'],
  ['#4d7c0f', '#7fb236'],
  ['#b45309', '#e09a2c'],
  ['#9333ea', '#c174f2'],
  ['#0e7490', '#2fb3c9'],
  ['#be123c', '#ef5571'],
  ['#4338ca', '#7577e8'],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function avatarGradient(key: string): string {
  const [a, b] = AVATAR_COLORS[hash(key) % AVATAR_COLORS.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

/** Readable accent colour for a person's name on dark backgrounds. */
export function avatarColor(key: string): string {
  return AVATAR_COLORS[hash(key) % AVATAR_COLORS.length][1];
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function meetingUrl(roomId: string): string {
  return `${location.origin}/r/${roomId}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts / denied clipboard permission.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
