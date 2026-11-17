/**
 * Resilient WebSocket client.
 *  - Reconnects automatically with capped exponential backoff + jitter.
 *  - Re-authenticates on every (re)connect with the token from localStorage.
 *  - Sends a plain "ping" keepalive; a silent connection is torn down and
 *    re-established (phones often leave zombie sockets after sleeping).
 *  - Reconnects immediately when the tab becomes visible / the network returns.
 *  - Every action carries a `ref`; `send()` resolves on the matching ack/error.
 */
import { PING, type Action, type ServerMessage } from "../../../shared/protocol";
import type { Role } from "../../../shared/views";
import { WS_URL } from "./config";

export type SocketStatus = "connecting" | "open" | "reconnecting" | "notFound" | "kicked";

export interface ActionOutcome {
  ok: boolean;
  code?: string;
  message?: string;
}

interface Options {
  code: string;
  role: Exclude<Role, "guest">;
  getToken: () => string | undefined;
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: SocketStatus) => void;
}

const PING_EVERY_MS = 15_000;
const SILENCE_LIMIT_MS = 40_000;
const ACTION_TIMEOUT_MS = 8_000;

export class GameSocket {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private stopped = false;
  private lastHeard = Date.now();
  private retryTimer: number | null = null;
  private pingTimer: number | null = null;
  private seq = 0;
  private pending = new Map<string, { resolve: (o: ActionOutcome) => void; timer: number }>();

  constructor(private readonly opts: Options) {
    document.addEventListener("visibilitychange", this.onWake);
    window.addEventListener("online", this.onWake);
    window.addEventListener("focus", this.onWake);
  }

  connect() {
    if (this.stopped) return;
    this.clearRetry();
    this.opts.onStatus(this.attempts === 0 ? "connecting" : "reconnecting");
    const ws = new WebSocket(`${WS_URL}/api/rooms/${this.opts.code}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.lastHeard = Date.now();
      ws.send(JSON.stringify({ type: "hello", role: this.opts.role, token: this.opts.getToken() }));
      this.startPing();
    };
    ws.onmessage = (ev) => {
      this.lastHeard = Date.now();
      if (ev.data === "pong") return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.type === "welcome") this.opts.onStatus("open");
      if ((msg.type === "ack" || msg.type === "error") && msg.ref) this.settle(msg.ref, msg);
      if (msg.type === "joined" && msg.ref) this.settle(msg.ref, { type: "ack", ref: msg.ref, action: "join" });
      if (msg.type === "kicked") {
        this.stopped = true;
        this.opts.onStatus("kicked");
      }
      if (msg.type === "roomClosed") {
        this.stopped = true;
        this.opts.onStatus("notFound");
      }
      this.opts.onMessage(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopPing();
      this.failPending("Connection lost — try again");
      if (ev.code === 4404) {
        this.stopped = true;
        this.opts.onStatus("notFound");
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  /** Send an action; resolves when the server acks or rejects it. */
  send(action: Action): Promise<ActionOutcome> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.resolve({ ok: false, code: "offline", message: "Not connected — reconnecting…" });
    }
    const ref = `m${++this.seq}-${Date.now().toString(36)}`;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(ref);
        resolve({ ok: false, code: "timeout", message: "No response from the server" });
      }, ACTION_TIMEOUT_MS);
      this.pending.set(ref, { resolve, timer });
      ws.send(JSON.stringify({ type: "action", ref, action }));
    });
  }

  /** Re-authenticate on the existing socket (e.g. after joining or clearing a seat). */
  rehello() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "hello", role: this.opts.role, token: this.opts.getToken() }));
    }
  }

  close() {
    this.stopped = true;
    this.clearRetry();
    this.stopPing();
    document.removeEventListener("visibilitychange", this.onWake);
    window.removeEventListener("online", this.onWake);
    window.removeEventListener("focus", this.onWake);
    this.ws?.close(1000, "bye");
    this.ws = null;
  }

  private settle(ref: string, msg: ServerMessage) {
    const p = this.pending.get(ref);
    if (!p) return;
    this.pending.delete(ref);
    clearTimeout(p.timer);
    if (msg.type === "error") p.resolve({ ok: false, code: msg.code, message: msg.message });
    else p.resolve({ ok: true });
  }

  private failPending(message: string) {
    for (const [ref, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, code: "offline", message });
      this.pending.delete(ref);
    }
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    this.attempts += 1;
    this.opts.onStatus("reconnecting");
    const delay = Math.min(5000, 400 * 2 ** Math.min(this.attempts - 1, 4)) * (0.75 + Math.random() * 0.5);
    this.retryTimer = window.setTimeout(() => this.connect(), delay);
  }

  private clearRetry() {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      const ws = this.ws;
      if (!ws) return;
      if (Date.now() - this.lastHeard > SILENCE_LIMIT_MS) {
        ws.close(4000, "silent");
        this.ws = null;
        this.stopPing();
        this.failPending("Connection lost — try again");
        this.scheduleReconnect();
        return;
      }
      if (ws.readyState === WebSocket.OPEN) ws.send(PING);
    }, PING_EVERY_MS);
  }

  private stopPing() {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private onWake = () => {
    if (this.stopped || document.visibilityState === "hidden") return;
    const ws = this.ws;
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      this.attempts = Math.max(this.attempts, 1);
      this.connect();
    } else if (ws.readyState === WebSocket.OPEN) {
      ws.send(PING); // prompt a quick liveness check
    }
  };
}
