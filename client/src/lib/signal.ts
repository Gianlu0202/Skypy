// WebSocket connection to the Skypy server with automatic reconnection.
import type { ClientMsg, HelloMsg, ServerMsg } from '../../../shared/protocol.ts';

export type SignalStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

interface Handlers {
  message(msg: ServerMsg): void;
  status(status: SignalStatus): void;
  /** Connection ended for good (replaced by another tab, denied, …). */
  fatal(reason: 'replaced' | 'denied'): void;
}

const PING_EVERY = 10_000;
const PONG_TIMEOUT = 25_000;

export class Signal {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private stopped = false;
  private retryTimer: number | undefined;
  private pingTimer: number | undefined;
  private lastHeard = 0;
  private denied = false;

  constructor(
    private hello: () => HelloMsg,
    private on: Handlers,
  ) {
    window.addEventListener('online', this.onOnline);
  }

  connect(): void {
    if (this.stopped) return;
    this.cleanupSocket();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this.on.status(this.attempt === 0 ? 'connecting' : 'reconnecting');

    ws.onopen = () => {
      this.lastHeard = Date.now();
      ws.send(JSON.stringify(this.hello()));
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.heartbeat(), PING_EVERY);
    };
    ws.onmessage = (ev) => {
      this.lastHeard = Date.now();
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      if (msg.t === 'welcome') {
        this.attempt = 0;
        this.on.status('open');
      }
      if (msg.t === 'denied') this.denied = true;
      this.on.message(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      window.clearInterval(this.pingTimer);
      if (this.stopped) return;
      if (ev.code === 4001) {
        this.stop();
        this.on.fatal('replaced');
        return;
      }
      if (this.denied || ev.code === 4003) {
        this.stop();
        this.on.fatal('denied');
        return;
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private heartbeat(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - this.lastHeard > PONG_TIMEOUT) {
      // Half-open connection: drop it and reconnect.
      ws.close();
      this.ws = null;
      window.clearInterval(this.pingTimer);
      this.scheduleReconnect();
      return;
    }
    ws.send(JSON.stringify({ t: 'ping' } satisfies ClientMsg));
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.on.status('reconnecting');
    window.clearTimeout(this.retryTimer);
    const base = Math.min(8000, 400 * 2 ** this.attempt);
    const delay = base / 2 + Math.random() * (base / 2);
    this.attempt++;
    this.retryTimer = window.setTimeout(() => this.connect(), delay);
  }

  private onOnline = (): void => {
    if (this.stopped) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.attempt = 0;
      window.clearTimeout(this.retryTimer);
      this.connect();
    }
  };

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMsg): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private cleanupSocket(): void {
    if (this.ws) {
      const old = this.ws;
      this.ws = null;
      old.onclose = null;
      old.onmessage = null;
      try {
        old.close();
      } catch {
        /* ignore */
      }
    }
  }

  /** Leave for good. Sends a leave message first when possible. */
  stop(sendLeave = false): void {
    if (sendLeave) this.send({ t: 'leave' });
    this.stopped = true;
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.pingTimer);
    window.removeEventListener('online', this.onOnline);
    // Give the leave message a moment to flush before closing.
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      if (sendLeave) setTimeout(() => ws.close(1000), 100);
      else ws.close(1000);
    }
    this.on.status('closed');
  }
}
