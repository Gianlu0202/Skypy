// Wire protocol shared by the Skypy server and the browser client.
// Every message is a JSON object with a `t` (type) field.

export const LIMITS = {
  minRows: 1,
  maxRows: 10,
  minCols: 1,
  maxCols: 12,
  maxSeats: 64,
  nameLength: 48,
  roomNameLength: 80,
  chatLength: 2000,
  chatHistory: 200,
  rosterImport: 200,
  membersPerRoom: 600,
} as const;

export type LayoutMode = 'auto' | 'sides' | 'stacked';
export type SharePolicy = 'everyone' | 'hosts';

export interface RoomSettings {
  rows: number;
  cols: number;
  /** How faces are arranged around a shared screen. */
  layout: LayoutMode;
  /** First seat someone sits in becomes theirs for future meetings. */
  autoClaim: boolean;
  /** Only people already on the seating roster (or hosts) may join. */
  locked: boolean;
  screenShare: SharePolicy;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  rows: 5,
  cols: 8,
  layout: 'auto',
  autoClaim: true,
  locked: false,
  screenShare: 'everyone',
};

/** A person on the room's roster (known across meetings). */
export interface MemberView {
  id: string;
  name: string;
  cohost: boolean;
  online: boolean;
  /** Last time this member was in the room (ms epoch), null if never. */
  lastSeen: number | null;
}

/** A live connection to the meeting. Its id is also the LiveKit identity. */
export interface SessionView {
  id: string;
  memberId: string;
  name: string;
  /** Seat index (row-major) or null when the room is over capacity. */
  seat: number | null;
  host: boolean;
  /** Timestamp the hand was raised, or null. */
  hand: number | null;
  joinedAt: number;
  /** Signal connection dropped; seat is held for a grace period. */
  away: boolean;
}

export interface RoomState {
  id: string;
  name: string;
  settings: RoomSettings;
  /** Seat reservations: memberId per seat (row-major), null = free. */
  seats: (string | null)[];
  members: MemberView[];
  sessions: SessionView[];
  /** Session whose camera is featured on the stage for everyone. */
  spotlight: string | null;
  /** Server clock when the meeting (first session) started. */
  startedAt: number | null;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  memberId: string;
  name: string;
  text: string;
  ts: number;
}

export interface HostData {
  /** The room's host key: sent to the room owner only, never to co-hosts. */
  hostKey: string | null;
  /** Personal invite token per member id. */
  invites: Record<string, string>;
}

// ───────────────────────── client → server ─────────────────────────

export interface HelloMsg {
  t: 'hello';
  roomId: string;
  name: string;
  deviceKey: string;
  tabId: string;
  hostKey?: string;
  invite?: string;
}

export type ClientMsg =
  | HelloMsg
  | { t: 'ping' }
  | { t: 'leave' }
  | { t: 'rename'; name: string }
  | { t: 'chat'; text: string }
  | { t: 'hand'; raised: boolean }
  /** Ask for a fresh media token (before reconnecting to LiveKit). */
  | { t: 'token' }
  | { t: 'react'; emoji: string }
  // host / co-host only
  | { t: 'seat.assign'; memberId: string; seat: number }
  | { t: 'seat.clear'; seat: number }
  | { t: 'seat.name'; seat: number; name: string }
  | { t: 'seats.clearAll' }
  | { t: 'roster.import'; names: string[]; replace: boolean }
  | { t: 'member.forget'; memberId: string }
  | { t: 'member.cohost'; memberId: string; value: boolean }
  | { t: 'settings'; patch: Partial<RoomSettings> & { name?: string } }
  | { t: 'spotlight'; sessionId: string | null }
  | { t: 'mute'; sessionId: string }
  | { t: 'muteAll' }
  | { t: 'kick'; sessionId: string }
  | { t: 'hand.lower'; sessionId: string | 'all' };

// ───────────────────────── server → client ─────────────────────────

export interface WelcomeMsg {
  t: 'welcome';
  sessionId: string;
  memberId: string;
  host: boolean;
  livekit: { url: string; token: string };
  state: RoomState;
  chat: ChatMessage[];
  hostData: HostData | null;
  serverTime: number;
}

export type ServerMsg =
  | WelcomeMsg
  | { t: 'state'; state: RoomState; host: boolean; hostData: HostData | null }
  | { t: 'chat'; msg: ChatMessage }
  | { t: 'react'; sessionId: string; emoji: string }
  | { t: 'token'; token: string }
  | { t: 'notice'; level: 'info' | 'warn'; text: string }
  | { t: 'kicked'; reason: string }
  | { t: 'denied'; code: DenyCode; message: string }
  | { t: 'error'; message: string }
  | { t: 'pong'; serverTime: number };

export type DenyCode = 'not_found' | 'locked' | 'removed' | 'bad_request' | 'full';

export const REACTIONS = ['👍', '👏', '😂', '❤️', '🎉', '🤔', '😮', '🙏'] as const;

// ───────────────────────── REST ─────────────────────────

export interface CreateRoomRequest {
  name: string;
  rows: number;
  cols: number;
  slug?: string;
  /** Required when the server sets CREATE_CODE. */
  code?: string;
}

export interface ServerConfig {
  /** Starting a meeting needs an access code (CREATE_CODE is set). */
  createNeedsCode: boolean;
}

export interface CreateRoomResponse {
  id: string;
  hostKey: string;
}

export interface RoomInfo {
  id: string;
  name: string;
  rows: number;
  cols: number;
  locked: boolean;
  online: number;
  /** Present when the caller identified itself via device key / invite. */
  you: { name: string; seat: number | null; host: boolean } | null;
}

// ───────────────────────── helpers ─────────────────────────

const ROW_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Theatre-style seat label: row letter (front row = A) + column number. */
export function seatLabel(seat: number, cols: number): string {
  const row = Math.floor(seat / cols);
  const col = (seat % cols) + 1;
  return `${ROW_LETTERS[row] ?? '?'}${col}`;
}

export function normalizeName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function cleanName(name: string, max: number = LIMITS.nameLength): string {
  return name
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max);
}
