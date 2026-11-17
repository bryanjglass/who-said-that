import { describe, expect, it } from "vitest";
import { LIMITS } from "../../shared/constants";
import type { ClientView } from "../../shared/views";
import {
  createRoom,
  FakeWorld,
  hostAdvance,
  joinPlayer,
  responseIdByText,
  setupRoom,
  startToSubmission,
  type TestRoom,
} from "../helpers";

const P = (room: TestRoom, name: string) => room.players.find((p) => p.name === name)!;

async function submitAll(room: TestRoom, answers: Record<string, string>) {
  const round = room.world.state.round!.number;
  for (const [name, text] of Object.entries(answers)) {
    await room.world.act(P(room, name).socket, { type: "submitAnswer", round, text });
  }
}

/** guesses: guesserName → (answerText → guessedAuthorName) */
async function guessAll(room: TestRoom, guesses: Record<string, Record<string, string>>, lock = true) {
  const round = room.world.state.round!.number;
  for (const [name, map] of Object.entries(guesses)) {
    const me = P(room, name);
    for (const [text, author] of Object.entries(map)) {
      await room.world.act(me.socket, {
        type: "setGuess",
        round,
        responseId: responseIdByText(room.world, text),
        authorId: P(room, author).id,
      });
    }
  }
  if (lock) {
    for (const name of Object.keys(guesses)) {
      if (room.world.state.phase !== "guessing") break;
      await room.world.act(P(room, name).socket, { type: "lockGuesses", round });
    }
  }
}

async function revealAll(room: TestRoom) {
  while (room.world.state.phase === "reveal") await hostAdvance(room.world, room.host);
}

const scores = (room: TestRoom) =>
  Object.fromEntries(room.world.state.players.map((p) => [p.name, p.score]));

const ANSWERS = {
  Abby: "Nobody is allowed to talk before 10 AM.",
  Owen: "All meetings must be conducted on trampolines.",
  Mom: "Pizza must be served at every meal.",
  Dad: "Parents must ask permission before using TikTok.",
};

/** Walks a JSON value and reports any object containing both values. */
function containsPair(value: unknown, a: string, b: string): boolean {
  if (!value || typeof value !== "object") return false;
  const vals = Object.values(value as Record<string, unknown>);
  const flat = vals.filter((v) => typeof v === "string");
  if (flat.includes(a) && flat.includes(b)) return true;
  // keyed maps like { responseId: authorId }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if ((k === a && v === b) || (k === b && v === a)) return true;
  }
  return vals.some((v) => containsPair(v, a, b));
}

// ---------------------------------------------------------------------------

describe("game creation & lobby", () => {
  it("creates a room once; the same code cannot be created twice", async () => {
    const world = new FakeWorld();
    expect(await world.core.create("BCDF", "h1")).toBe(true);
    expect(await world.core.create("BCDF", "h2")).toBe(false);
    expect(world.state.hostToken).toBe("h1");
    expect(world.core.info()).toMatchObject({ exists: true, phase: "lobby", joinable: true });
  });

  it("joins players and updates every lobby screen in real time", async () => {
    const { world, host, tv } = await createRoom();
    host.clear();
    tv.clear();
    await joinPlayer(world, "Abby", 0);
    expect(tv.lastView().players.map((p) => p.name)).toEqual(["Abby"]);
    expect(host.lastView().players[0]).toMatchObject({ name: "Abby", connected: true, avatar: 0 });
  });

  it("validates names: required, trimmed, max length, case-insensitive duplicates", async () => {
    const { world } = await createRoom();
    await joinPlayer(world, "  Abby  ", 0);
    expect(world.state.players[0]!.name).toBe("Abby");
    const s = world.connect();
    await world.send(s, { type: "hello", role: "player" });
    for (const [name, code] of [
      ["   ", "invalid"],
      ["ABBY", "name_taken"],
      ["abby", "name_taken"],
      ["x".repeat(LIMITS.maxNameLength + 1), "invalid"],
    ] as const) {
      await world.act(s, { type: "join", name, avatar: 3 });
      expect(s.lastError()?.code).toBe(code);
    }
    expect(world.state.players).toHaveLength(1);
  });

  it("offers at least 12 avatars and prevents two players taking the same one", async () => {
    expect(LIMITS.avatarCount).toBeGreaterThanOrEqual(12);
    const { world } = await createRoom();
    await joinPlayer(world, "Abby", 5);
    const s = world.connect();
    await world.send(s, { type: "hello", role: "player" });
    await world.act(s, { type: "join", name: "Owen", avatar: 5 });
    expect(s.lastError()?.code).toBe("invalid");
    await world.act(s, { type: "join", name: "Owen", avatar: 99 });
    expect(s.lastError()?.code).toBe("invalid");
  });

  it("supports 3–10 players: cannot start with 2, the 11th cannot join", async () => {
    const { world, host } = await createRoom();
    await joinPlayer(world, "A", 0);
    await joinPlayer(world, "B", 1);
    await world.act(host, { type: "start" });
    expect(host.lastError()?.code).toBe("not_enough_players");
    expect(host.lastView().host!.canStart).toBe(false);
    for (let i = 2; i < 10; i++) await joinPlayer(world, `P${i}`, i);
    expect(world.state.players).toHaveLength(10);
    const s = world.connect();
    await world.send(s, { type: "hello", role: "player" });
    await world.act(s, { type: "join", name: "Eleven", avatar: 12 });
    expect(s.lastError()?.code).toBe("room_full");
    expect(host.lastView().host!.canStart).toBe(true);
  });

  it("requires 3 *connected* players to start", async () => {
    const room = await setupRoom(["A", "B", "C"]);
    await room.world.disconnect(room.players[2]!.socket);
    await room.world.act(room.host, { type: "start" });
    expect(room.host.lastError()?.code).toBe("not_enough_players");
  });

  it("lets the host configure rounds, timers and categories (validated)", async () => {
    const { world, host } = await createRoom();
    await world.act(host, { type: "configure", config: { rounds: 7, submissionSeconds: 45, guessingSeconds: 30, categories: ["family", "silly"] } });
    expect(world.state.config).toEqual({ rounds: 7, submissionSeconds: 45, guessingSeconds: 30, categories: ["silly", "family"] });
    for (const bad of [{ rounds: 6 }, { submissionSeconds: 2 }, { guessingSeconds: 9999 }, { categories: [] }]) {
      await world.act(host, { type: "configure", config: bad });
      expect(host.lastError()?.code).toBe("invalid");
    }
    expect(world.state.config.rounds).toBe(7);
  });

  it("only the host can start, pause, advance, skip, kick, end or rematch", async () => {
    const room = await setupRoom();
    const abby = P(room, "Abby").socket;
    const actions = [
      { type: "start" },
      { type: "configure", config: { rounds: 10 } },
      { type: "pause" },
      { type: "resume" },
      { type: "advance", from: { phase: "lobby", round: 0 } },
      { type: "skipPrompt", round: 1, promptId: "x" },
      { type: "kick", playerId: P(room, "Owen").id },
      { type: "endGame" },
      { type: "rematch" },
    ] as const;
    for (const a of actions) {
      for (const sock of [abby, room.tv]) {
        await room.world.act(sock, a as never);
        expect(sock.lastError()?.code).toBe("unauthorized");
      }
    }
    expect(room.world.state.phase).toBe("lobby");
    expect(room.world.state.players).toHaveLength(4);
  });

  it("tells the host when the TV display connects and disconnects", async () => {
    const { world, host, tv } = await createRoom();
    expect(host.lastView().host!.tvConnections).toBe(1);
    const tv2 = world.connect();
    await world.send(tv2, { type: "hello", role: "tv" });
    expect(host.lastView().host!.tvConnections).toBe(2);
    await world.disconnect(tv);
    await world.disconnect(tv2);
    expect(host.lastView().host!.tvConnections).toBe(0);
    expect(host.lastView().hostConnected).toBe(true);
  });

  it("rejects a forged host token", async () => {
    const { world } = await createRoom();
    const evil = world.connect();
    await world.send(evil, { type: "hello", role: "host", token: "guess" });
    expect(evil.lastError()?.code).toBe("invalid_token");
    await world.act(evil, { type: "start" });
    expect(evil.lastError()?.code).toBe("not_authenticated");
  });

  it("host can remove a player in the lobby; their token stops working", async () => {
    const room = await setupRoom();
    const owen = P(room, "Owen");
    await room.world.act(room.host, { type: "kick", playerId: owen.id });
    expect(owen.socket.messages().some((m) => m.type === "kicked")).toBe(true);
    const again = room.world.connect();
    await room.world.send(again, { type: "hello", role: "player", token: owen.token });
    expect(again.lastError()?.code).toBe("invalid_token");
  });
});

describe("answer submission", () => {
  it("sends every player the same prompt, then opens submission", async () => {
    const room = await setupRoom();
    await room.world.act(room.host, { type: "start" });
    const prompts = room.players.map((p) => p.socket.lastView().round!.prompt.text);
    expect(new Set(prompts).size).toBe(1);
    expect(room.tv.lastView().phase).toBe("prompt");
    await room.world.advance(LIMITS.promptSeconds * 1000);
    expect(room.world.state.phase).toBe("submission");
  });

  it("trims, rejects empty / too-long answers, and allows editing", async () => {
    const room = await setupRoom();
    await startToSubmission(room);
    const abby = P(room, "Abby");
    await room.world.act(abby.socket, { type: "submitAnswer", round: 1, text: "   " });
    expect(abby.socket.lastError()?.code).toBe("invalid");
    await room.world.act(abby.socket, { type: "submitAnswer", round: 1, text: "x".repeat(141) });
    expect(abby.socket.lastError()?.code).toBe("invalid");
    await room.world.act(abby.socket, { type: "submitAnswer", round: 1, text: "😀".repeat(140) });
    expect(room.world.state.round!.answers[abby.id]!.text).toHaveLength(280); // 140 code points
    await room.world.act(abby.socket, { type: "submitAnswer", round: 1, text: "  first   draft  " }, "r1");
    expect(abby.socket.messages()).toContainEqual({ type: "ack", ref: "r1", action: "submitAnswer" });
    expect(abby.socket.lastView().me!.answer).toBe("first draft");
    await room.world.act(abby.socket, { type: "submitAnswer", round: 1, text: "final answer" });
    expect(room.world.state.round!.answers[abby.id]!.text).toBe("final answer");
    expect(room.tv.lastView().round!.submittedIds).toEqual([abby.id]);
  });

  it("never sends answer text to the host, TV or other players during submission", async () => {
    const room = await setupRoom();
    await startToSubmission(room);
    const secret = "my super secret answer";
    await room.world.act(P(room, "Abby").socket, { type: "submitAnswer", round: 1, text: secret });
    for (const s of [room.host, room.tv, P(room, "Owen").socket, P(room, "Mom").socket]) {
      expect(s.sent.join("\n")).not.toContain(secret);
    }
    expect(room.tv.lastView().round!.submittedIds).toHaveLength(1);
  });

  it("advances automatically when everyone has answered", async () => {
    const room = await setupRoom();
    await startToSubmission(room);
    await submitAll(room, ANSWERS);
    expect(room.world.state.phase).toBe("guessing");
  });

  it("advances automatically on timer expiry and rejects late submissions", async () => {
    const room = await setupRoom();
    await startToSubmission(room);
    await submitAll(room, { Abby: ANSWERS.Abby, Owen: ANSWERS.Owen });
    await room.world.advance(room.world.state.config.submissionSeconds * 1000 + 1);
    expect(room.world.state.phase).toBe("guessing");
    const mom = P(room, "Mom");
    await room.world.act(mom.socket, { type: "submitAnswer", round: 1, text: "too late!" });
    expect(mom.socket.lastError()?.code).toBe("too_late");
    expect(room.world.state.round!.responses).toHaveLength(2);
  });

  it("rejects a late submission even if the alarm has not fired yet", async () => {
    const room = await setupRoom();
    await startToSubmission(room);
    await submitAll(room, { Abby: ANSWERS.Abby, Owen: ANSWERS.Owen });
    room.world.now = room.world.state.timer!.deadline! + 5; // alarm delayed
    const mom = P(room, "Mom");
    await room.world.act(mom.socket, { type: "submitAnswer", round: 1, text: "sneaky" });
    expect(mom.socket.lastError()?.code).toBe("too_late");
  });

  it("skips a round with fewer than two answers, awarding no points", async () => {
    const room = await setupRoom();
    await startToSubmission(room);
    await submitAll(room, { Abby: ANSWERS.Abby });
    await room.world.advance(room.world.state.config.submissionSeconds * 1000 + 1);
    expect(room.world.state.phase).toBe("scoreboard");
    expect(room.tv.lastView().round!.skipped).toBe("not_enough_answers");
    expect(Object.values(scores(room)).every((s) => s === 0)).toBe(true);
    await hostAdvance(room.world, room.host);
    expect(room.world.state.round!.number).toBe(2);
  });

  it("renders answers as plain data (no HTML interpretation server-side)", async () => {
    const room = await setupRoom();
    await startToSubmission(room);
    const xss = '<img src=x onerror="alert(1)">';
    await submitAll(room, { ...ANSWERS, Abby: xss });
    const card = room.tv.lastView().round!.responses!.find((r) => r.text === xss);
    expect(card).toBeDefined(); // stored verbatim; the client renders it as text
  });
});

describe("guessing", () => {
  async function toGuessing() {
    const room = await setupRoom();
    await startToSubmission(room);
    await submitAll(room, ANSWERS);
    return room;
  }

  it("shuffles once: every client sees the same order, with random IDs", async () => {
    const room = await toGuessing();
    const orders = [room.tv, room.host, ...room.players.map((p) => p.socket)].map((s) =>
      s.lastView().round!.responses!.map((r) => `${r.id}:${r.label}:${r.text}`).join("|"),
    );
    expect(new Set(orders).size).toBe(1);
    const ids = room.world.state.round!.responses!.map((r) => r.id);
    for (const id of ids) {
      expect(id).toMatch(/^r_[a-z0-9]{10}$/);
      for (const p of room.players) expect(id).not.toContain(p.id.slice(2));
    }
    // Refreshing / hibernating does not reshuffle.
    room.world.hibernate();
    const tv2 = room.world.connect();
    await room.world.send(tv2, { type: "hello", role: "tv" });
    expect(tv2.lastView().round!.responses!.map((r) => r.id)).toEqual(ids);
  });

  it("shuffles differently across rounds/games (not submission order)", async () => {
    const orders = new Set<string>();
    for (let seed = 0; seed < 6; seed++) {
      const room = await setupRoom();
      room.world.random = (await import("../../shared/engine/random")).seededRandom(seed);
      await startToSubmission(room);
      await submitAll(room, ANSWERS);
      orders.add(room.world.state.round!.responses!.map((r) => r.text).join("|"));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it("does not disclose authorship or others' guesses before the reveal", async () => {
    const room = await toGuessing();
    await guessAll(room, { Owen: { [ANSWERS.Abby]: "Dad" } }, false);
    const responses = room.world.state.round!.responses!;
    for (const s of [room.tv, room.host, ...room.players.map((p) => p.socket)]) {
      const viewer = room.players.find((p) => p.socket === s);
      for (const msg of s.messages()) {
        for (const r of responses) {
          if (viewer && viewer.id === r.authorId) continue; // you may know your own answer
          expect(containsPair(msg, r.id, r.authorId)).toBe(false);
        }
      }
      if (viewer?.name !== "Owen") expect(JSON.stringify(s.lastView())).not.toContain(P(room, "Dad").id + '"}');
      expect(s.lastView().round!.reveal).toBeNull();
    }
    expect(P(room, "Abby").socket.lastView().me!.guesses).toEqual({});
  });

  it("marks the player's own answer privately and rejects guessing it", async () => {
    const room = await toGuessing();
    const abby = P(room, "Abby");
    const own = responseIdByText(room.world, ANSWERS.Abby);
    expect(abby.socket.lastView().me!.myResponseId).toBe(own);
    expect(P(room, "Owen").socket.lastView().me!.myResponseId).not.toBe(own);
    expect(room.tv.lastView().me).toBeNull();
    await room.world.act(abby.socket, { type: "setGuess", round: 1, responseId: own, authorId: abby.id });
    expect(abby.socket.lastError()?.code).toBe("invalid");
    await room.world.act(abby.socket, {
      type: "setGuess",
      round: 1,
      responseId: responseIdByText(room.world, ANSWERS.Owen),
      authorId: abby.id,
    });
    expect(abby.socket.lastError()?.code).toBe("invalid");
  });

  it("allows assigning the same author to several answers, revising and clearing", async () => {
    const room = await toGuessing();
    const mom = P(room, "Mom");
    const [a, o] = [responseIdByText(room.world, ANSWERS.Abby), responseIdByText(room.world, ANSWERS.Owen)];
    await room.world.act(mom.socket, { type: "setGuess", round: 1, responseId: a, authorId: P(room, "Dad").id });
    await room.world.act(mom.socket, { type: "setGuess", round: 1, responseId: o, authorId: P(room, "Dad").id });
    expect(mom.socket.lastView().me!.guesses).toEqual({ [a]: P(room, "Dad").id, [o]: P(room, "Dad").id });
    await room.world.act(mom.socket, { type: "setGuess", round: 1, responseId: a, authorId: P(room, "Abby").id });
    await room.world.act(mom.socket, { type: "setGuess", round: 1, responseId: o, authorId: null }, "clear");
    expect(mom.socket.lastView().me!.guesses).toEqual({ [a]: P(room, "Abby").id });
    expect(mom.socket.messages()).toContainEqual({ type: "ack", ref: "clear", action: "setGuess" });
  });

  it("rejects invalid guesses: unknown response, non-author target", async () => {
    const room = await setupRoom();
    await startToSubmission(room);
    await submitAll(room, { Abby: ANSWERS.Abby, Owen: ANSWERS.Owen, Mom: ANSWERS.Mom });
    await room.world.advance(room.world.state.config.submissionSeconds * 1000 + 1);
    const mom = P(room, "Mom");
    await room.world.act(mom.socket, { type: "setGuess", round: 1, responseId: "r_nope", authorId: P(room, "Abby").id });
    expect(mom.socket.lastError()?.code).toBe("invalid");
    await room.world.act(mom.socket, {
      type: "setGuess",
      round: 1,
      responseId: responseIdByText(room.world, ANSWERS.Abby),
      authorId: P(room, "Dad").id, // Dad didn't answer
    });
    expect(mom.socket.lastError()?.code).toBe("invalid");
    expect(room.tv.lastView().round!.authorIds).toHaveLength(3);
  });

  it("locks guesses: locked guesses can't change; repeated locks are rejected", async () => {
    const room = await toGuessing();
    const owen = P(room, "Owen");
    await guessAll(room, { Owen: { [ANSWERS.Abby]: "Dad" } }, false);
    await room.world.act(owen.socket, { type: "lockGuesses", round: 1 }, "lock");
    expect(owen.socket.messages()).toContainEqual({ type: "ack", ref: "lock", action: "lockGuesses" });
    expect(owen.socket.lastView().me!.locked).toBe(true);
    expect(room.tv.lastView().round!.lockedIds).toEqual([owen.id]);
    await room.world.act(owen.socket, {
      type: "setGuess",
      round: 1,
      responseId: responseIdByText(room.world, ANSWERS.Abby),
      authorId: P(room, "Mom").id,
    });
    expect(owen.socket.lastError()?.code).toBe("already_locked");
    await room.world.act(owen.socket, { type: "lockGuesses", round: 1 });
    expect(owen.socket.lastError()?.code).toBe("already_locked");
    expect(room.world.state.round!.guesses[owen.id]).toEqual({
      [responseIdByText(room.world, ANSWERS.Abby)]: P(room, "Dad").id,
    });
  });

  it("ends when everyone locks in, or on timer expiry (partial guesses count)", async () => {
    const room = await toGuessing();
    await guessAll(room, { Owen: { [ANSWERS.Abby]: "Dad" }, Mom: { [ANSWERS.Abby]: "Abby" } }, false);
    await room.world.act(P(room, "Owen").socket, { type: "lockGuesses", round: 1 });
    expect(room.world.state.phase).toBe("guessing");
    await room.world.advance(room.world.state.config.guessingSeconds * 1000 + 1);
    expect(room.world.state.phase).toBe("reveal");
    // Owen (locked) fooled by Abby; Mom (unlocked, partial) correct.
    expect(scores(room)).toEqual({ Abby: 250, Owen: 0, Mom: 500, Dad: 0 });
    const late = P(room, "Dad");
    await room.world.act(late.socket, { type: "setGuess", round: 1, responseId: responseIdByText(room.world, ANSWERS.Mom), authorId: P(room, "Mom").id });
    expect(late.socket.lastError()?.code).toBe("too_late");
    await room.world.act(late.socket, { type: "lockGuesses", round: 1 });
    expect(late.socket.lastError()?.code).toBe("too_late");
  });

  it("lets players who missed submission still guess", async () => {
    const room = await setupRoom();
    await startToSubmission(room);
    await submitAll(room, { Abby: ANSWERS.Abby, Owen: ANSWERS.Owen, Mom: ANSWERS.Mom });
    await room.world.advance(room.world.state.config.submissionSeconds * 1000 + 1);
    const dad = P(room, "Dad");
    expect(dad.socket.lastView().me!.myResponseId).toBeNull();
    await guessAll(room, {
      Dad: { [ANSWERS.Abby]: "Abby", [ANSWERS.Owen]: "Mom", [ANSWERS.Mom]: "Mom" },
      Abby: { [ANSWERS.Owen]: "Owen", [ANSWERS.Mom]: "Owen" },
      Owen: { [ANSWERS.Abby]: "Mom", [ANSWERS.Mom]: "Mom" },
      Mom: { [ANSWERS.Abby]: "Abby", [ANSWERS.Owen]: "Owen" },
    });
    expect(room.world.state.phase).toBe("reveal");
    // Deception goes to the author of the answer that was mis-guessed.
    expect(scores(room)).toEqual({ Dad: 1000, Abby: 500 + 250, Owen: 500 + 250, Mom: 1000 + 250 });
  });
});

describe("reveal & scoring", () => {
  async function playStandardRound(room: TestRoom) {
    await submitAll(room, ANSWERS);
    await guessAll(room, {
      Abby: { [ANSWERS.Owen]: "Owen", [ANSWERS.Mom]: "Dad", [ANSWERS.Dad]: "Mom" },
      Owen: { [ANSWERS.Abby]: "Abby", [ANSWERS.Mom]: "Mom", [ANSWERS.Dad]: "Dad" },
      Mom: { [ANSWERS.Abby]: "Owen", [ANSWERS.Owen]: "Owen", [ANSWERS.Dad]: "Abby" },
      Dad: { [ANSWERS.Abby]: "Abby", [ANSWERS.Owen]: "Abby", [ANSWERS.Mom]: "Mom" },
    });
  }
  const EXPECTED = { Abby: 750, Owen: 1750, Mom: 750, Dad: 1500 };

  it("scores a full round exactly", async () => {
    const room = await setupRoom();
    await startToSubmission(room);
    await playStandardRound(room);
    expect(room.world.state.phase).toBe("reveal");
    expect(scores(room)).toEqual(EXPECTED);
  });

  it("reveals one response at a time: suspects first, then the author; scores gated", async () => {
    const room = await setupRoom();
    await startToSubmission(room);
    await playStandardRound(room);
    let view = room.tv.lastView();
    expect(view.round!.reveal!.stage).toBe("suspects");
    expect(view.round!.reveal!.current.authorId).toBeNull();
    expect(view.round!.reveal!.current.guesses).toBeNull();
    expect(view.round!.reveal!.current.suspects.reduce((n, s) => n + s.count, 0)).toBe(3);
    expect(view.players.every((p) => p.score === 0)).toBe(true); // nothing revealed yet

    const total = view.round!.reveal!.total;
    expect(total).toBe(4);
    for (let i = 0; i < total; i++) {
      await hostAdvance(room.world, room.host);
      view = room.tv.lastView();
      const rv = view.round!.reveal!;
      expect(rv.stage).toBe("author");
      const response = room.world.state.round!.responses![i]!;
      expect(rv.current.authorId).toBe(response.authorId);
      expect(rv.current.guesses!.length).toBe(3);
      expect(rv.current.correctGuesserIds!.length + rv.current.fooledIds!.length).toBe(3);
      // Later responses' authors are still hidden.
      for (const later of room.world.state.round!.responses!.slice(i + 1)) {
        expect(rv.revealedAuthors[later.id]).toBeUndefined();
      }
      if (i < total - 1) await hostAdvance(room.world, room.host);
    }
    expect(view.players.reduce((n, p) => n + p.score, 0)).toBe(4750);
    await hostAdvance(room.world, room.host);
    expect(room.world.state.phase).toBe("scoreboard");
    const sb = room.tv.lastView().scoreboard!;
    expect(sb.standings.map((s) => [s.name, s.score, s.rank])).toEqual([
      ["Owen", 1750, 1],
      ["Dad", 1500, 2],
      ["Abby", 750, 3],
      ["Mom", 750, 3],
    ]);
    expect(P(room, "Owen").socket.lastView().me!.roundPoints).toEqual({ guessing: 1500, deception: 250, total: 1750 });
  });

  it("never duplicates points: repeated advances, alarms, hibernation and replays", async () => {
    const room = await setupRoom();
    await startToSubmission(room);
    await submitAll(room, ANSWERS);
    await guessAll(room, {
      Abby: { [ANSWERS.Owen]: "Owen", [ANSWERS.Mom]: "Dad", [ANSWERS.Dad]: "Mom" },
      Owen: { [ANSWERS.Abby]: "Abby", [ANSWERS.Mom]: "Mom", [ANSWERS.Dad]: "Dad" },
      Mom: { [ANSWERS.Abby]: "Owen", [ANSWERS.Owen]: "Owen", [ANSWERS.Dad]: "Abby" },
      Dad: { [ANSWERS.Abby]: "Abby", [ANSWERS.Owen]: "Abby", [ANSWERS.Mom]: "Mom" },
    }, false);
    const stale = { type: "advance", from: { phase: "guessing", round: 1 } } as const;
    await room.world.act(room.host, stale);
    await room.world.act(room.host, stale);
    expect(room.host.lastError()?.code).toBe("stale");
    await room.world.advance(10 * 60 * 1000); // any lingering alarm
    room.world.hibernate();
    await room.world.core.onAlarm();
    expect(scores(room)).toEqual(EXPECTED);
    // Double-click on reveal advance only moves one step.
    const from = { phase: "reveal", round: 1, revealIndex: 0, revealStage: "suspects" } as const;
    await room.world.act(room.host, { type: "advance", from });
    await room.world.act(room.host, { type: "advance", from });
    expect(room.world.state.round!.revealStage).toBe("author");
    expect(room.world.state.round!.revealIndex).toBe(0);
    await revealAll(room);
    await room.world.act(room.host, { type: "advance", from: { phase: "reveal", round: 1, revealIndex: 3, revealStage: "author" } });
    expect(scores(room)).toEqual(EXPECTED);
    expect(room.world.state.history).toHaveLength(1);
  });

  it("tracks cumulative totals over rounds and ends after the configured rounds with tied winners", async () => {
    const room = await setupRoom(["A", "B", "C"]);
    await room.world.act(room.host, { type: "configure", config: { rounds: 5 } });
    await room.world.act(room.host, { type: "start" });
    for (let r = 1; r <= 5; r++) {
      await hostAdvance(room.world, room.host); // prompt → submission
      const ans = { A: `a${r}`, B: `b${r}`, C: `c${r}` };
      await submitAll(room, ans);
      // A and B always guess each other right; C guesses wrong → A & B fooled C? No: C guesses A↔B swapped.
      await guessAll(room, {
        A: { [ans.B]: "B", [ans.C]: "B" },
        B: { [ans.A]: "A", [ans.C]: "A" },
        C: { [ans.A]: "B", [ans.B]: "A" },
      });
      await revealAll(room);
      expect(room.world.state.phase).toBe("scoreboard");
      expect(room.tv.lastView().scoreboard!.number).toBe(r);
      await hostAdvance(room.world, room.host);
    }
    expect(room.world.state.phase).toBe("gameOver");
    const final = room.tv.lastView().final!;
    // per round: A 500 + 250(fooled C) + 250 (C fooled A on c? no — A guessed B for c → C +250), same for B.
    expect(final.standings.map((s) => [s.name, s.score, s.rank])).toEqual([
      ["A", 3750, 1],
      ["B", 3750, 1],
      ["C", 2500, 3],
    ]);
    expect(final.winnerIds).toEqual([P(room, "A").id, P(room, "B").id]);
    expect(final.awards[0]!.id).toBe("champion");
  });
});

describe("timers", () => {
  it("pause freezes the server timer; resume continues with the remaining time", async () => {
    const room = await setupRoom();
    await startToSubmission(room);
    await room.world.advance(10_000);
    await room.world.act(room.host, { type: "pause" });
    const view = room.tv.lastView();
    expect(view.paused).toBe(true);
    expect(view.timer).toMatchObject({ paused: true, deadline: null, remainingMs: 65_000 });
    await room.world.advance(10 * 60_000);
    expect(room.world.state.phase).toBe("submission");
    // Players may still answer while paused.
    await room.world.act(P(room, "Abby").socket, { type: "submitAnswer", round: 1, text: "while paused" });
    expect(P(room, "Abby").socket.lastError()).toBeUndefined();
    await room.world.act(room.host, { type: "resume" });
    expect(room.tv.lastView().timer!.deadline).toBe(room.world.now + 65_000);
    await room.world.advance(64_000);
    expect(room.world.state.phase).toBe("submission");
    await room.world.advance(1_001);
    expect(room.world.state.phase).toBe("scoreboard"); // only one answer → skipped
  });

  it("timers survive hibernation (state + alarm reloaded from storage)", async () => {
    const room = await setupRoom();
    await startToSubmission(room);
    await submitAll(room, { Abby: "one", Owen: "two" });
    room.world.hibernate();
    await room.world.advance(room.world.state.config.submissionSeconds * 1000 + 1);
    expect(room.world.state.phase).toBe("guessing");
    expect(room.world.state.round!.responses).toHaveLength(2);
  });

  it("never gets stuck: a round completes with nobody acting", async () => {
    const room = await setupRoom();
    await room.world.act(room.host, { type: "start" });
    await room.world.advance(60 * 60_000);
    expect(room.world.state.phase).toBe("scoreboard");
  });

  it("does not wait for a player who has disconnected (after a grace period)", async () => {
    const room = await setupRoom();
    await startToSubmission(room);
    await room.world.disconnect(P(room, "Dad").socket);
    await submitAll(room, { Abby: "a", Owen: "o", Mom: "m" });
    expect(room.world.state.phase).toBe("submission"); // grace period
    await room.world.advance(LIMITS.presenceGraceMs + 1);
    expect(room.world.state.phase).toBe("guessing");
  });

  it("host can skip a prompt (new prompt, same round, no points)", async () => {
    const room = await setupRoom();
    await startToSubmission(room);
    await submitAll(room, { Abby: "a" });
    const first = room.world.state.round!.prompt.id;
    await room.world.act(room.host, { type: "skipPrompt", round: 1, promptId: first });
    await room.world.act(room.host, { type: "skipPrompt", round: 1, promptId: first }); // duplicate click
    expect(room.host.lastError()?.code).toBe("stale");
    expect(room.world.state.round!.number).toBe(1);
    expect(room.world.state.round!.prompt.id).not.toBe(first);
    expect(room.world.state.round!.answers).toEqual({});
    expect(room.world.state.phase).toBe("prompt");
  });
});

describe("reconnection & recovery", () => {
  it("restores a player's identity and current state after a refresh", async () => {
    const room = await setupRoom();
    await startToSubmission(room);
    const abby = P(room, "Abby");
    await room.world.act(abby.socket, { type: "submitAnswer", round: 1, text: "kept" });
    await room.world.disconnect(abby.socket);
    expect(room.host.lastView().players.find((p) => p.id === abby.id)!.connected).toBe(false);
    const again = room.world.connect();
    await room.world.send(again, { type: "hello", role: "player", token: abby.token });
    expect(again.messages()).toContainEqual({ type: "welcome", role: "player", playerId: abby.id });
    const v = again.lastView();
    expect(v.phase).toBe("submission");
    expect(v.me).toMatchObject({ id: abby.id, answer: "kept" });
    expect(room.host.lastView().players.find((p) => p.id === abby.id)!.connected).toBe(true);
  });

  it("refreshing the TV or host restores the current phase without resetting", async () => {
    const room = await setupRoom();
    await startToSubmission(room);
    await submitAll(room, ANSWERS);
    await room.world.disconnect(room.host);
    await room.world.disconnect(room.tv);
    const tv = room.world.connect();
    await room.world.send(tv, { type: "hello", role: "tv" });
    const host = room.world.connect();
    await room.world.send(host, { type: "hello", role: "host", token: "host-secret-token" });
    expect(tv.lastView().phase).toBe("guessing");
    expect(host.lastView().phase).toBe("guessing");
    expect(host.lastView().round!.responses).toHaveLength(4);
    expect(host.lastView().host).not.toBeNull();
    expect(tv.lastView().host).toBeNull();
  });

  it("new players cannot join an active game, but originals can rejoin", async () => {
    const room = await setupRoom();
    await room.world.act(room.host, { type: "start" });
    const s = room.world.connect();
    await room.world.send(s, { type: "hello", role: "player" });
    expect(s.lastView().me).toBeNull();
    await room.world.act(s, { type: "join", name: "Late", avatar: 9 });
    expect(s.lastError()?.code).toBe("game_in_progress");
    const owen = P(room, "Owen");
    await room.world.send(s, { type: "hello", role: "player", token: owen.token });
    expect(s.lastView().me!.id).toBe(owen.id);
  });

  it("an impostor cannot act as another player without their token", async () => {
    const room = await setupRoom();
    await startToSubmission(room);
    const s = room.world.connect();
    await room.world.send(s, { type: "hello", role: "player", token: "not-a-real-token" });
    expect(s.lastError()?.code).toBe("invalid_token");
    await room.world.act(s, { type: "submitAnswer", round: 1, text: "hi" });
    expect(s.lastError()?.code).toBe("unauthorized");
    // Messages can't claim an identity: there is no playerId field in actions.
    await room.world.send(s, { type: "action", action: { type: "submitAnswer", round: 1, text: "x", playerId: P(room, "Abby").id } });
    expect(room.world.state.round!.answers).toEqual({});
  });

  it("recovers when every browser disconnects and the object hibernates", async () => {
    const room = await setupRoom();
    await startToSubmission(room);
    await submitAll(room, ANSWERS);
    for (const s of [...room.world.sockets]) await room.world.disconnect(s);
    room.world.hibernate();
    await room.world.advance(5_000);
    expect(room.world.state.phase).toBe("guessing");
    const abby = room.world.connect();
    await room.world.send(abby, { type: "hello", role: "player", token: P(room, "Abby").token });
    const v: ClientView = abby.lastView();
    expect(v.phase).toBe("guessing");
    expect(v.round!.responses).toHaveLength(4);
    expect(v.me!.myResponseId).toBe(responseIdByText(room.world, ANSWERS.Abby));
  });

  it("completed rounds and scores survive reactivation", async () => {
    const room = await setupRoom();
    await startToSubmission(room);
    await submitAll(room, ANSWERS);
    await guessAll(room, { Owen: { [ANSWERS.Abby]: "Abby" }, Mom: { [ANSWERS.Abby]: "Dad" }, Dad: {}, Abby: {} });
    await revealAll(room);
    room.world.hibernate();
    expect(room.world.state.history).toHaveLength(1);
    expect(scores(room)).toEqual({ Abby: 250, Owen: 500, Mom: 0, Dad: 0 });
  });

  it("ignores malformed and oversized messages", async () => {
    const room = await setupRoom();
    const s = P(room, "Abby").socket;
    await room.world.core.onMessage(s, "{not json");
    expect(s.lastError()?.code).toBe("bad_message");
    await room.world.core.onMessage(s, JSON.stringify({ type: "action", action: { type: "explode" } }));
    expect(s.lastError()?.code).toBe("bad_message");
    await room.world.core.onMessage(s, "x".repeat(10_000));
    expect(s.lastError()?.code).toBe("bad_message");
    await room.world.core.onMessage(s, "ping");
    expect(s.sent[s.sent.length - 1]).toBe("pong");
  });

  it("deletes abandoned rooms after the TTL", async () => {
    const room = await setupRoom();
    for (const s of [...room.world.sockets]) await room.world.disconnect(s);
    await room.world.advance(LIMITS.roomTtlMs + 1000);
    expect(room.world.storage).toBeNull();
    expect(room.world.core.info().exists).toBe(false);
  });
});

describe("multiple rooms", () => {
  it("keeps two rooms completely independent", async () => {
    const a = await setupRoom(["A1", "A2", "A3"]);
    const b = await setupRoom(["A1", "B2", "B3"]); // same name allowed in another room
    await a.world.act(a.host, { type: "start" });
    expect(a.world.state.phase).toBe("prompt");
    expect(b.world.state.phase).toBe("lobby");
    // A token from room A means nothing in room B.
    const s = b.world.connect();
    await b.world.send(s, { type: "hello", role: "player", token: a.players[0]!.token });
    expect(s.lastError()?.code).toBe("invalid_token");
    await b.world.send(s, { type: "hello", role: "host", token: "wrong" });
    expect(s.lastError()?.code).toBe("invalid_token");
  });
});

describe("game over & rematch", () => {
  async function playToEnd(room: TestRoom) {
    await room.world.act(room.host, { type: "start" });
    while (room.world.state.phase !== "gameOver") {
      const phase = room.world.state.phase;
      if (phase === "submission") {
        const r = room.world.state.round!.number;
        await submitAll(room, { Abby: `abby ${r}`, Owen: `owen ${r}`, Mom: `mom ${r}`, Dad: `dad ${r}` });
      } else if (phase === "guessing") {
        const r = room.world.state.round!.number;
        await guessAll(room, { Owen: { [`abby ${r}`]: "Abby" }, Abby: {}, Mom: {}, Dad: {} });
      } else {
        await hostAdvance(room.world, room.host);
      }
    }
  }

  it("rematch resets scores and stats, keeps the roster, and uses fresh prompts", async () => {
    const room = await setupRoom();
    await playToEnd(room);
    expect(scores(room).Owen).toBe(2500);
    const firstGamePrompts = room.world.state.history.map((h) => h.promptText);
    const roster = room.world.state.players.map((p) => p.id);
    await room.world.act(room.host, { type: "rematch" });
    expect(room.world.state.phase).toBe("prompt");
    expect(room.world.state.gameNumber).toBe(2);
    expect(room.world.state.players.map((p) => p.id)).toEqual(roster);
    expect(Object.values(scores(room)).every((s) => s === 0)).toBe(true);
    expect(room.world.state.players.every((p) => p.stats.correctGuesses === 0)).toBe(true);
    expect(room.world.state.history).toEqual([]);
    expect(firstGamePrompts).not.toContain(room.world.state.round!.prompt.text);
    for (const p of room.players) expect(p.socket.lastView().me!.id).toBeTruthy();
  });

  it("rematch can return to the lobby for new settings", async () => {
    const room = await setupRoom();
    await playToEnd(room);
    await room.world.act(room.host, { type: "rematch", toLobby: true });
    expect(room.world.state.phase).toBe("lobby");
    await room.world.act(room.host, { type: "configure", config: { rounds: 10 } });
    expect(room.world.state.config.rounds).toBe(10);
  });

  it("host can end the game early", async () => {
    const room = await setupRoom();
    await startToSubmission(room);
    await room.world.act(room.host, { type: "endGame" });
    expect(room.world.state.phase).toBe("gameOver");
    expect(room.tv.lastView().final!.roundsPlayed).toBe(0);
  });
});
