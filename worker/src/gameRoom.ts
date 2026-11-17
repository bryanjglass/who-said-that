/**
 * GameRoom Durable Object — one instance per room code.
 *
 * Uses the WebSocket Hibernation API: sockets stay open while the object is
 * evicted from memory, and each socket's authenticated identity lives in its
 * serialized attachment. Game state is persisted to Durable Object storage on
 * every change and reloaded in the constructor, and the server timer is a
 * storage alarm, so timers and scores survive hibernation and restarts.
 */
import { DurableObject } from "cloudflare:workers";
import { cryptoRandom } from "../../shared/engine/random";
import type { GameState } from "../../shared/engine/state";
import { PING, PONG } from "../../shared/protocol";
import { RoomCore, type ConnMeta, type Connection, type RoomPlatform } from "../../server/roomCore";
import type { Env } from "./env";

const STATE_KEY = "state";

function wrap(ws: WebSocket): Connection {
  return {
    send: (data) => ws.send(data),
    close: (code, reason) => {
      try {
        ws.close(code, reason);
      } catch {
        /* already closed */
      }
    },
    getMeta: () => (ws.deserializeAttachment() as ConnMeta | null) ?? null,
    setMeta: (meta) => ws.serializeAttachment(meta),
  };
}

export class GameRoom extends DurableObject<Env> {
  private core!: RoomCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking a hibernated object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    const platform: RoomPlatform = {
      now: () => Date.now(),
      random: cryptoRandom,
      connections: () => ctx.getWebSockets().map(wrap),
      save: (state) => ctx.storage.put(STATE_KEY, state),
      deleteAll: () => ctx.storage.deleteAll(),
      setAlarm: async (at) => {
        if (at === null) await ctx.storage.deleteAlarm();
        else await ctx.storage.setAlarm(at);
      },
    };
    ctx.blockConcurrencyWhile(async () => {
      const saved = (await ctx.storage.get<GameState>(STATE_KEY)) ?? null;
      this.core = new RoomCore(platform, saved);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/init" && request.method === "POST") {
      const { code, hostToken } = (await request.json()) as { code: string; hostToken: string };
      const created = await this.core.create(code, hostToken);
      return Response.json({ created }, { status: created ? 201 : 409 });
    }
    if (url.pathname === "/info") {
      return Response.json(this.core.info());
    }
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      if (!this.core.info().exists) return new Response("Room not found", { status: 404 });
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);
      this.core.onConnect(wrap(server), crypto.randomUUID());
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    await this.core.onMessage(wrap(ws), message);
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "closing");
    } catch {
      /* already closed */
    }
    await this.core.onClose(wrap(ws));
  }

  async webSocketError(ws: WebSocket) {
    await this.core.onClose(wrap(ws));
  }

  async alarm() {
    await this.core.onAlarm();
  }
}
