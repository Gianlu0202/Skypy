import { create } from 'zustand';
import type { ChatMessage, HostData, RoomState } from '../../../shared/protocol.ts';
import type { SignalStatus } from './signal.ts';
import { saveUiPrefs, uiPrefs, type UiPrefs } from './storage.ts';

export type MediaStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
export type Panel = 'people' | 'chat' | 'seats' | null;
export type EndKind = 'left' | 'kicked' | 'replaced' | 'denied' | 'error';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'warn' | 'error' | 'success';
  title?: string;
  action?: { label: string; run: () => void };
  ttl: number;
}

export interface FloatingReaction {
  id: number;
  sessionId: string;
  emoji: string;
  drift: number;
}

export interface MeetingStore {
  state: RoomState | null;
  sessionId: string | null;
  memberId: string | null;
  host: boolean;
  hostData: HostData | null;
  chat: ChatMessage[];
  unread: number;
  signal: SignalStatus;
  media: MediaStatus;
  clockOffset: number;
  panel: Panel;
  arrange: boolean;
  /** Stage item the user picked when several are available. */
  stageKey: string | null;
  /** Session pinned to the stage locally ("just for me"). */
  pinned: string | null;
  ui: UiPrefs;
  toasts: Toast[];
  reactions: FloatingReaction[];
  ended: { kind: EndKind; message?: string } | null;
  mic: boolean;
  cam: boolean;
  sharing: boolean;
  audioBlocked: boolean;
}

const initial = (): Omit<MeetingStore, 'ui'> => ({
  state: null,
  sessionId: null,
  memberId: null,
  host: false,
  hostData: null,
  chat: [],
  unread: 0,
  signal: 'connecting',
  media: 'idle',
  clockOffset: 0,
  panel: null,
  arrange: false,
  stageKey: null,
  pinned: null,
  toasts: [],
  reactions: [],
  ended: null,
  mic: false,
  cam: false,
  sharing: false,
  audioBlocked: false,
});

export const useStore = create<MeetingStore>(() => ({ ...initial(), ui: uiPrefs() }));

export function resetMeetingStore(): void {
  useStore.setState({ ...initial(), ui: uiPrefs() });
}

export function setUi(patch: Partial<UiPrefs>): void {
  const ui = { ...useStore.getState().ui, ...patch };
  saveUiPrefs(ui);
  useStore.setState({ ui });
}

export function setPanel(panel: Panel): void {
  const cur = useStore.getState().panel;
  const next = cur === panel ? null : panel;
  useStore.setState(next === 'chat' ? { panel: next, unread: 0 } : { panel: next });
}

let toastSeq = 1;
export function toast(text: string, opts: Partial<Omit<Toast, 'id' | 'text'>> = {}): number {
  const t: Toast = { id: toastSeq++, text, tone: opts.tone ?? 'info', title: opts.title, action: opts.action, ttl: opts.ttl ?? 4200 };
  useStore.setState((s) => ({ toasts: [...s.toasts.slice(-3), t] }));
  if (t.ttl > 0) window.setTimeout(() => dismissToast(t.id), t.ttl);
  return t.id;
}

export function dismissToast(id: number): void {
  useStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

let reactionSeq = 1;
export function addReaction(sessionId: string, emoji: string): void {
  const r: FloatingReaction = { id: reactionSeq++, sessionId, emoji, drift: Math.random() * 2 - 1 };
  useStore.setState((s) => ({ reactions: [...s.reactions.slice(-40), r] }));
  window.setTimeout(() => {
    useStore.setState((s) => ({ reactions: s.reactions.filter((x) => x.id !== r.id) }));
  }, 2600);
}

// Read-only handle for automated tests and debugging from the console.
(window as unknown as { __skypy?: unknown }).__skypy = { state: () => useStore.getState() };
