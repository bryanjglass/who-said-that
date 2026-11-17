/**
 * Test harness: an in-memory RoomPlatform with a manual clock, fake sockets,
 * fake storage (JSON round-tripped, like Durable Object storage) and a fake
 * alarm. `hibernate()` throws away the RoomCore instance and rebuilds it from
 * storage exactly as a Durable Object would after eviction.
 */
import { seededRandom } from "../shared/engine/random";
import type { GameState } from "../shared/engine/state";
import type { Action } from "../shared/protocol";
import type { ServerMessage } from "../shared/protocol";
import type { ClientView } from "../shared/views";
import { RoomCore, type ConnMeta, type Connection, type RoomPlatform } from "../server/roomCore";

export class FakeSocket implements Connection {
  meta: ConnMeta | null = null;
  sent: string[] = [];
  open = true;
  constructor(private readonly world: FakeWorld) {}
  send(data: string) {
    if (!this.open) throw new Error("socket closed");
    this.sent.push(data);
  }
  close() {
    this.open = false;
    this.world.sockets.delete(this);
  }
  getMeta() {
    return this.meta ? { ...this.meta } : null;
  }
  setMeta(meta: ConnMeta) {
    this.meta = JSON.parse(JSON.stringify(meta));
  }
  messages(): ServerMessage[] {
    return this.sent.filter((s) => s !== "pong").map((s) => JSON.parse(s) as ServerMessage);
  }
  lastView(): ClientView {
    const states = this.messages().filter((m) => m.type === "state");
    const last = states[states.length - 1];
    if (!last || last.type !== "state") throw new Error("no state received");
    return last.view;
  }
  lastError() {
    return this.messages().filter((m) => m.type === "error").pop() as Extract<ServerMessage, { type: "error" }> | undefined;
  }
  clear() {
    this.sent = [];
  }
}

let worldCounter = 0;

export class FakeWorld {
  now = 1_700_000_000_000;
  sockets = new Set<FakeSocket>();
  storage: string | null = null;
  alarm: number | null = null;
  core: RoomCore;
  random = seededRandom(42 + 7919 * ++worldCounter);
  private connSeq = 0;
  readonly platform: RoomPlatform;

  constructor() {
    this.platform = {
      now: () => this.now,
      random: () => this.random(),
      connections: () => [...this.sockets],
      save: (state: GameState) => {
        this.storage = JSON.stringify(state);
      },
      deleteAll: () => {
        this.storage = null;
      },
      setAlarm: (at) => {
        this.alarm = at;
      },
    };
    this.core = new RoomCore(this.platform, null);
  }

  /** Simulate Durable Object eviction + reactivation: rebuild from storage only. */
  hibernate() {
    this.core = new RoomCore(this.platform, this.storage ? (JSON.parse(this.storage) as GameState) : null);
  }

  get state(): GameState {
    return this.core.state!;
  }

  connect(): FakeSocket {
    const s = new FakeSocket(this);
    this.sockets.add(s);
    this.core.onConnect(s, `c${++this.connSeq}`);
    return s;
  }

  async disconnect(s: FakeSocket) {
    this.sockets.delete(s);
    s.open = false;
    await this.core.onClose(s);
  }

  async send(s: FakeSocket, msg: unknown) {
    await this.core.onMessage(s, JSON.stringify(msg));
  }

  async act(s: FakeSocket, action: Action, ref?: string) {
    await this.send(s, { type: "action", action, ref });
  }

  /** Advance the clock, firing the alarm if it falls due (like the DO runtime). */
  async advance(ms: number) {
    const target = this.now + ms;
    let guard = 0;
    while (this.alarm !== null && this.alarm <= target) {
      if (++guard > 1000) throw new Error("alarm loop");
      this.now = Math.max(this.now, this.alarm);
      this.alarm = null;
      await this.core.onAlarm();
    }
    this.now = target;
  }
}

export interface TestRoom {
  world: FakeWorld;
  host: FakeSocket;
  tv: FakeSocket;
  players: { name: string; socket: FakeSocket; id: string; token: string }[];
}

export async function createRoom(world = new FakeWorld(), code = "BCDF", hostToken = "host-secret-token"): Promise<{ world: FakeWorld; host: FakeSocket; tv: FakeSocket }> {
  await world.core.create(code, hostToken);
  const host = world.connect();
  await world.send(host, { type: "hello", role: "host", token: hostToken });
  const tv = world.connect();
  await world.send(tv, { type: "hello", role: "tv" });
  return { world, host, tv };
}

export async function joinPlayer(world: FakeWorld, name: string, avatar: number) {
  const socket = world.connect();
  await world.send(socket, { type: "hello", role: "player" });
  await world.act(socket, { type: "join", name, avatar }, "join");
  const joined = socket.messages().find((m) => m.type === "joined");
  if (!joined || joined.type !== "joined") throw new Error(`join failed: ${JSON.stringify(socket.lastError())}`);
  return { name, socket, id: joined.playerId, token: joined.token };
}

export async function setupRoom(names = ["Abby", "Owen", "Mom", "Dad"]): Promise<TestRoom> {
  const { world, host, tv } = await createRoom();
  const players = [];
  for (const [i, n] of names.entries()) players.push(await joinPlayer(world, n, i));
  return { world, host, tv, players };
}

export function hostAdvance(world: FakeWorld, host: FakeSocket) {
  const s = world.state;
  return world.act(host, {
    type: "advance",
    from: {
      phase: s.phase,
      round: s.round?.number ?? 0,
      revealIndex: s.round?.revealIndex,
      revealStage: s.round?.revealStage,
    },
  });
}

/** Start the game and move into submission for round 1. */
export async function startToSubmission(room: TestRoom) {
  await room.world.act(room.host, { type: "start" });
  await hostAdvance(room.world, room.host);
}

export function responseIdByText(world: FakeWorld, text: string): string {
  const r = world.state.round!.responses!.find((x) => x.text === text);
  if (!r) throw new Error(`no response ${text}`);
  return r.id;
}
