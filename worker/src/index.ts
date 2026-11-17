/**
 * Worker entry point: a tiny HTTP router in front of the GameRoom Durable Objects.
 *
 *   POST /api/rooms              → create a room, returns { code, hostToken }
 *   GET  /api/rooms/:code        → { exists, phase, players, joinable }
 *   GET  /api/rooms/:code/ws     → WebSocket upgrade, forwarded to the room's DO
 *   GET  /api/health             → "ok"
 *
 * Each room code maps to its own Durable Object (idFromName), so concurrent
 * games are fully isolated from one another.
 */
import { isValidRoomCode, normalizeRoomCode, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "../../shared/constants";
import { cryptoRandom, randomId, randomString } from "../../shared/engine/random";
import type { Env } from "./env";

export { GameRoom } from "./gameRoom";

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS ?? "*").split(",").map((s) => s.trim()).filter(Boolean);
  const allowOrigin = allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : "";
  return allowOrigin
    ? {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      }
    : {};
}

function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true; // non-browser clients
  const allowed = (env.ALLOWED_ORIGINS ?? "*").split(",").map((s) => s.trim());
  return allowed.includes("*") || allowed.includes(origin);
}

function json(data: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (url.pathname === "/api/health") return json({ ok: true }, 200, cors);

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      if (!originAllowed(request, env)) return json({ error: "Origin not allowed" }, 403, cors);
      for (let attempt = 0; attempt < 12; attempt++) {
        const code = randomString(cryptoRandom, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH);
        const hostToken = randomId(cryptoRandom, 32);
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const res = await stub.fetch("https://room/init", {
          method: "POST",
          body: JSON.stringify({ code, hostToken }),
        });
        if (res.status === 201) return json({ code, hostToken }, 201, cors);
      }
      return json({ error: "Could not allocate a room code, please try again" }, 503, cors);
    }

    const match = url.pathname.match(/^\/api\/rooms\/([A-Za-z]+)(\/ws)?$/);
    if (match) {
      const code = normalizeRoomCode(match[1]!);
      if (!isValidRoomCode(code)) return json({ error: "Invalid room code" }, 400, cors);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      if (match[2]) {
        if (!originAllowed(request, env)) return new Response("Origin not allowed", { status: 403 });
        return stub.fetch("https://room/ws", request);
      }
      const res = await stub.fetch("https://room/info");
      return json(await res.json(), 200, cors);
    }

    return json({ error: "Not found" }, 404, cors);
  },
} satisfies ExportedHandler<Env>;
