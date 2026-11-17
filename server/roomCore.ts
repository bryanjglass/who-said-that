/**
 * RoomCore — one game room's server logic, independent of the transport.
 *
 * The Cloudflare Durable Object (worker/src/gameRoom.ts) adapts hibernatable
 * WebSockets, storage and alarms to the small `RoomPlatform` interface below.
 * Tests drive the same class with in-memory fakes, including simulated
 * hibernation (discarding the instance and rebuilding it from storage).
 *
 * Invariants:
 *  - Every inbound message is schema-validated and authorised against the
 *    connection's authenticated identity (stored on the socket attachment).
 *  - Time-based transitions are applied (tick) before any action is handled,
 *    so a late alarm can never let a late submission sneak in.
 *  - State is persisted before broadcasts are sent.
 *  - Each connection only ever receives the projection for its own role.
 */
import { LIMITS } from "../shared/constants";
import { applyAction, createGame, nextWakeTime, setPresence, tick, type Actor, type EngineContext } from "../shared/engine/engine";
import { projectView } from "../shared/engine/projection";
import type { RandomSource } from "../shared/engine/random";
import type { GameState, Prompt } from "../shared/engine/state";
import { clientMessageSchema, PING, PONG, type ErrorCode, type ServerMessage } from "../shared/protocol";
import { PROMPTS } from "../shared/prompts";
import type { Role } from "../shared/views";

export interface ConnMeta {
  connId: string;
  role: Role | "pending";
  playerId: string | null;
}

export interface Connection {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  getMeta(): ConnMeta | null;
  setMeta(meta: ConnMeta): void;
}

export interface RoomPlatform {
  now(): number;
  random: RandomSource;
  connections(): Connection[];
  save(state: GameState): void | Promise<void>;
  deleteAll(): void | Promise<void>;
  setAlarm(at: number | null): void | Promise<void>;
  prompts?: readonly Prompt[];
}

export interface RoomInfo {
  exists: boolean;
  phase: string | null;
  players: number;
  joinable: boolean;
}

const MAX_MESSAGE_BYTES = 4096;

export class RoomCore {
  state: GameState | null;
  private readonly prompts: readonly Prompt[];

  constructor(
    private readonly platform: RoomPlatform,
    initialState: GameState | null,
  ) {
    this.state = initialState;
    this.prompts = platform.prompts ?? PROMPTS;
  }

  // -------------------------------------------------------------------------
  // Room lifecycle
  // -------------------------------------------------------------------------

  /** Initialise a brand-new room. Returns false if the code is already in use. */
  async create(code: string, hostToken: string): Promise<boolean> {
    if (this.state && !this.state.closed) return false;
    this.state = createGame(code, hostToken, this.platform.now());
    await this.platform.save(this.state);
    await this.scheduleAlarm();
    return true;
  }

  info(): RoomInfo {
    const s = this.state;
    if (!s || s.closed) return { exists: false, phase: null, players: 0, joinable: false };
    return {
      exists: true,
      phase: s.phase,
      players: s.players.length,
      joinable: s.phase === "lobby" && s.players.length < LIMITS.maxPlayers,
    };
  }

  // -------------------------------------------------------------------------
  // Connection events
  // -------------------------------------------------------------------------

  onConnect(conn: Connection, connId: string) {
    conn.setMeta({ connId, role: "pending", playerId: null });
  }

  async onMessage(conn: Connection, raw: string | ArrayBuffer) {
    if (typeof raw !== "string") return this.sendError(conn, "bad_message", "Text frames only");
    if (raw === PING) return conn.send(PONG);
    if (raw.length > MAX_MESSAGE_BYTES) return this.sendError(conn, "bad_message", "Message too large");
    const state = this.state;
    if (!state || state.closed) {
      this.send(conn, { type: "roomClosed" });
      return conn.close(4404, "Room not found");
    }

    let parsed;
    try {
      parsed = clientMessageSchema.safeParse(JSON.parse(raw));
    } catch {
      return this.sendError(conn, "bad_message", "Malformed JSON");
    }
    if (!parsed.success) return this.sendError(conn, "bad_message", "Invalid message");
    const msg = parsed.data;

    let changed = this.reconcilePresence();
    changed = tick(state, this.ctx()) || changed;

    const meta = conn.getMeta() ?? { connId: "unknown", role: "pending" as const, playerId: null };

    if (msg.type === "hello") {
      let role: Role;
      let playerId: string | null = null;
      if (msg.role === "host") {
        if (!msg.token || msg.token !== state.hostToken) {
          if (changed) await this.commit();
          return this.sendError(conn, "invalid_token", "This browser isn't the host of this room", msg.ref);
        }
        role = "host";
      } else if (msg.role === "tv") {
        role = "tv";
      } else {
        const player = msg.token ? state.players.find((p) => p.token === msg.token) : undefined;
        if (msg.token && !player) {
          this.sendError(conn, "invalid_token", "Your saved seat in this room no longer exists", msg.ref);
        }
        role = player ? "player" : "guest";
        playerId = player?.id ?? null;
      }
      conn.setMeta({ ...meta, role, playerId });
      this.send(conn, { type: "welcome", role, playerId });
      if (playerId) changed = setPresence(state, playerId, true, this.platform.now()) || changed;
      changed = tick(state, this.ctx()) || changed;
      if (changed) await this.commit();
      // Host/TV presence is shown to the host, so everyone gets a fresh view.
      else if (role === "host" || role === "tv") this.broadcast();
      else this.sendState(conn);
      return;
    }

    // --- actions ---
    const ref = msg.ref;
    const action = msg.action;
    if (meta.role === "pending") {
      if (changed) await this.commit();
      return this.sendError(conn, "not_authenticated", "Say hello first", ref, action.type);
    }
    const actor: Actor =
      meta.role === "player" && meta.playerId
        ? { kind: "player", playerId: meta.playerId }
        : { kind: meta.role === "player" ? "guest" : meta.role };

    const result = applyAction(state, actor, action, this.ctx());
    if (!result.ok) {
      if (changed) await this.commit();
      return this.sendError(conn, result.code, result.message, ref, action.type);
    }

    if (result.joined) {
      conn.setMeta({ ...meta, role: "player", playerId: result.joined.playerId });
      setPresence(state, result.joined.playerId, true, this.platform.now());
      this.send(conn, { type: "joined", playerId: result.joined.playerId, token: result.joined.token, ref });
      this.send(conn, { type: "welcome", role: "player", playerId: result.joined.playerId });
    }
    if (result.kickedPlayerId) {
      for (const c of this.platform.connections()) {
        const m = c.getMeta();
        if (m?.playerId === result.kickedPlayerId) {
          this.send(c, { type: "kicked" });
          c.setMeta({ ...m, role: "guest", playerId: null });
          c.close(4000, "Removed by host");
        }
      }
    }
    if (ref) this.send(conn, { type: "ack", ref, action: action.type });
    if (result.changed || changed || result.joined) await this.commit();
  }

  async onClose(conn: Connection) {
    if (!this.state) return;
    const changed = this.reconcilePresence(conn);
    const ticked = tick(this.state, this.ctx());
    if (changed || ticked) {
      await this.commit(conn);
    } else {
      const role = conn.getMeta()?.role;
      if (role === "host" || role === "tv") {
        this.closingConnId = conn.getMeta()?.connId ?? null;
        this.broadcast(conn);
        this.closingConnId = null;
      }
    }
  }

  async onAlarm() {
    const state = this.state;
    if (!state) return;
    const now = this.platform.now();
    const hasConnections = this.platform.connections().length > 0;
    if (state.closed || (!hasConnections && now - state.lastActivity >= LIMITS.roomTtlMs)) {
      // Abandoned room: wipe it so storage doesn't grow forever.
      this.state = null;
      await this.platform.setAlarm(null);
      await this.platform.deleteAll();
      return;
    }
    let changed = this.reconcilePresence();
    changed = tick(state, this.ctx()) || changed;
    if (changed) await this.commit();
    else await this.scheduleAlarm();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private ctx(): EngineContext {
    return { now: this.platform.now(), random: this.platform.random, prompts: this.prompts };
  }

  /**
   * Derive player presence from the sockets that are actually open. This is
   * what makes presence correct after hibernation or an eviction/restart.
   */
  private reconcilePresence(excluding?: Connection): boolean {
    const state = this.state;
    if (!state) return false;
    const online = new Set<string>();
    const skipId = excluding?.getMeta()?.connId;
    for (const c of this.platform.connections()) {
      const m = c.getMeta();
      if (skipId && m?.connId === skipId) continue;
      if (m?.role === "player" && m.playerId) online.add(m.playerId);
    }
    let changed = false;
    const now = this.platform.now();
    for (const p of state.players) {
      changed = setPresence(state, p.id, online.has(p.id), now) || changed;
    }
    return changed;
  }

  private async scheduleAlarm() {
    const state = this.state;
    if (!state) return;
    const wake = nextWakeTime(state, this.platform.now());
    const expiry = Math.max(state.lastActivity, this.platform.now()) + LIMITS.roomTtlMs;
    await this.platform.setAlarm(wake === null ? expiry : Math.min(wake, expiry));
  }

  /** Set while handling a close so the closing socket isn't counted as present. */
  private closingConnId: string | null = null;

  private async commit(excluding?: Connection) {
    if (!this.state) return;
    this.closingConnId = excluding?.getMeta()?.connId ?? null;
    await this.platform.save(this.state);
    await this.scheduleAlarm();
    this.broadcast(excluding);
    this.closingConnId = null;
  }

  private broadcast(excluding?: Connection) {
    const cache = new Map<string, string>();
    const skipId = excluding?.getMeta()?.connId;
    for (const conn of this.platform.connections()) {
      const meta = conn.getMeta();
      if (!meta || meta.role === "pending" || (skipId && meta.connId === skipId)) continue;
      const key = meta.role === "player" ? `player:${meta.playerId}` : meta.role;
      let payload = cache.get(key);
      if (!payload) {
        payload = this.serializeState(meta);
        cache.set(key, payload);
      }
      try {
        conn.send(payload);
      } catch {
        /* socket already closing — presence is reconciled on close */
      }
    }
  }

  private serializeState(meta: ConnMeta): string {
    const conns = this.platform.connections().map((c) => c.getMeta()).filter((m) => m?.connId !== this.closingConnId);
    const view = projectView(
      this.state!,
      { role: meta.role === "pending" ? "guest" : meta.role, playerId: meta.playerId },
      {
        now: this.platform.now(),
        hostConnected: conns.some((m) => m?.role === "host"),
        tvConnections: conns.filter((m) => m?.role === "tv").length,
        prompts: this.prompts,
      },
    );
    return JSON.stringify({ type: "state", view } satisfies ServerMessage);
  }

  private sendState(conn: Connection) {
    const meta = conn.getMeta();
    if (!meta || meta.role === "pending" || !this.state) return;
    conn.send(this.serializeState(meta));
  }

  private send(conn: Connection, msg: ServerMessage) {
    try {
      conn.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }

  private sendError(conn: Connection, code: ErrorCode, message: string, ref?: string, action?: string) {
    this.send(conn, { type: "error", code, message, ref, action: action as never });
  }
}
