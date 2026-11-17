/**
 * Exercises the real Worker router and the real GameRoom Durable Object class
 * against an in-memory DurableObjectNamespace / storage.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

const forced: number[] = [];
vi.mock("../../shared/engine/random", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../shared/engine/random")>();
  return { ...mod, cryptoRandom: () => (forced.length ? forced.shift()! : Math.random()) };
});

class FakeStorage {
  data = new Map<string, unknown>();
  alarm: number | null = null;
  async get(k: string) {
    const v = this.data.get(k);
    return v === undefined ? undefined : structuredClone(v);
  }
  async put(k: string, v: unknown) {
    this.data.set(k, structuredClone(v));
  }
  async deleteAll() {
    this.data.clear();
  }
  async setAlarm(t: number) {
    this.alarm = t;
  }
  async deleteAlarm() {
    this.alarm = null;
  }
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).WebSocketRequestResponsePair = class {
    constructor(
      public req: string,
      public res: string,
    ) {}
  };
});

async function makeEnv() {
  const { GameRoom } = await import("../../worker/src/gameRoom");
  const objects = new Map<string, { fetch: (r: Request | string, init?: RequestInit) => Promise<Response> }>();
  const storages = new Map<string, FakeStorage>();
  const ROOMS = {
    idFromName: (name: string) => name,
    get: (id: string) => {
      if (!objects.has(id)) {
        const storage = new FakeStorage();
        storages.set(id, storage);
        const ctx = {
          storage,
          setWebSocketAutoResponse: () => {},
          getWebSockets: () => [],
          acceptWebSocket: () => {},
          blockConcurrencyWhile: async (fn: () => Promise<void>) => {
            await fn();
          },
        };
        const obj = new GameRoom(ctx as never, {} as never);
        objects.set(id, {
          fetch: async (r, init) => {
            await new Promise((res) => setTimeout(res, 0)); // let blockConcurrencyWhile finish
            return obj.fetch(typeof r === "string" ? new Request(r, init) : r);
          },
        });
      }
      return objects.get(id)!;
    },
  };
  return { env: { ROOMS, ALLOWED_ORIGINS: "*" }, storages };
}

describe("worker router", () => {
  it("creates rooms with unique, easy-to-type codes and retries on collision", async () => {
    const worker = (await import("../../worker/src/index")).default;
    const { env, storages } = await makeEnv();
    const create = () => worker.fetch(new Request("https://x/api/rooms", { method: "POST" }), env as never);

    forced.push(0, 0, 0, 0); // → "BBBB"
    const first = (await (await create()).json()) as { code: string; hostToken: string };
    expect(first.code).toBe("BBBB");
    expect(first.hostToken).toMatch(/^[a-z0-9]{32}$/);

    forced.push(0, 0, 0, 0); // collide with BBBB → must retry
    const second = (await (await create()).json()) as { code: string };
    expect(second.code).not.toBe("BBBB");
    expect(second.code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(((await storages.get("BBBB")!.get("state")) as { hostToken: string }).hostToken).toBe(first.hostToken);

    const codes = new Set([first.code, second.code]);
    for (let i = 0; i < 20; i++) codes.add(((await (await create()).json()) as { code: string }).code);
    expect(codes.size).toBe(22);
  });

  it("reports room info and validates codes", async () => {
    const worker = (await import("../../worker/src/index")).default;
    const { env } = await makeEnv();
    const { code } = (await (
      await worker.fetch(new Request("https://x/api/rooms", { method: "POST" }), env as never)
    ).json()) as { code: string };
    const info = await (await worker.fetch(new Request(`https://x/api/rooms/${code.toLowerCase()}`), env as never)).json();
    expect(info).toMatchObject({ exists: true, phase: "lobby", players: 0, joinable: true });
    const missing = await (await worker.fetch(new Request("https://x/api/rooms/ZZZZ"), env as never)).json();
    expect(missing).toMatchObject({ exists: false });
    const bad = await worker.fetch(new Request("https://x/api/rooms/AEIO"), env as never);
    expect(bad.status).toBe(400);
  });

  it("enforces the origin allow-list when configured", async () => {
    const worker = (await import("../../worker/src/index")).default;
    const { env } = await makeEnv();
    const locked = { ...env, ALLOWED_ORIGINS: "https://family.github.io" };
    const evil = await worker.fetch(
      new Request("https://x/api/rooms", { method: "POST", headers: { Origin: "https://evil.example" } }),
      locked as never,
    );
    expect(evil.status).toBe(403);
    const good = await worker.fetch(
      new Request("https://x/api/rooms", { method: "POST", headers: { Origin: "https://family.github.io" } }),
      locked as never,
    );
    expect(good.status).toBe(201);
    expect(good.headers.get("Access-Control-Allow-Origin")).toBe("https://family.github.io");
  });
});
