/**
 * The authoritative game state machine.
 *
 *   lobby → prompt → submission → guessing → reveal → scoreboard ─┬→ prompt (next round)
 *                     │ (<2 answers) ────────────────→ scoreboard  └→ gameOver → (rematch) → prompt | lobby
 *
 * All functions are pure with respect to I/O: time and randomness are injected
 * through EngineContext, and the state object is mutated in place only after
 * an action has been fully validated. The Durable Object persists the state
 * after every successful change.
 */
import {
  CATEGORIES,
  LIMITS,
  ROUND_OPTIONS,
  type Category,
  type Phase,
} from "../constants";
import type { Action, ConfigPatch, ErrorCode } from "../protocol";
import type { GameConfig } from "../views";
import { DEFAULT_CONFIG } from "../constants";
import { randomId, shuffle, type RandomSource } from "./random";
import { scoreRound } from "./scoring";
import type { GameState, PlayerStats, Prompt, ServerPlayer, ServerRound } from "./state";

export interface EngineContext {
  now: number;
  random: RandomSource;
  prompts: readonly Prompt[];
}

export type Actor =
  | { kind: "host" }
  | { kind: "tv" }
  | { kind: "guest" }
  | { kind: "player"; playerId: string };

export type ActionResult =
  | { ok: true; changed: boolean; joined?: { playerId: string; token: string }; kickedPlayerId?: string }
  | { ok: false; code: ErrorCode; message: string };

const fail = (code: ErrorCode, message: string): ActionResult => ({ ok: false, code, message });
const OK_UNCHANGED: ActionResult = { ok: true, changed: false };
const OK_CHANGED: ActionResult = { ok: true, changed: true };

const HOST_ACTIONS = new Set<Action["type"]>([
  "configure",
  "start",
  "pause",
  "resume",
  "advance",
  "skipPrompt",
  "kick",
  "endGame",
  "rematch",
]);
const PLAYER_ACTIONS = new Set<Action["type"]>(["updateProfile", "submitAnswer", "setGuess", "lockGuesses"]);

const emptyStats = (): PlayerStats => ({
  answers: 0,
  answerChars: 0,
  correctGuesses: 0,
  guessesMade: 0,
  playersFooled: 0,
  timesExposed: 0,
  firstToAnswer: 0,
});

export function createGame(code: string, hostToken: string, now: number): GameState {
  return {
    schemaVersion: 1,
    code,
    hostToken,
    createdAt: now,
    lastActivity: now,
    version: 1,
    gameNumber: 1,
    config: { ...DEFAULT_CONFIG, categories: [...DEFAULT_CONFIG.categories] },
    phase: "lobby",
    players: [],
    nextJoinOrder: 0,
    round: null,
    history: [],
    promptQueue: [],
    usedPromptIds: [],
    previousGamePromptIds: [],
    timer: null,
    paused: false,
    closed: false,
  };
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Strip control characters, collapse whitespace, trim. */
// Control chars, zero-width & bidi-override characters.
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]", "g");

export function cleanText(input: string): string {

  return input.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

/** Length in user-perceived code points (so emoji count as one, matching the client counter). */
export function textLength(text: string): number {
  return [...text].length;
}

export function normalizeName(name: string): string {
  return cleanText(name).normalize("NFKC");
}

function nameKey(name: string): string {
  return normalizeName(name).toLocaleLowerCase("en-US");
}

// ---------------------------------------------------------------------------
// Presence / eligibility
// ---------------------------------------------------------------------------

export function isPresent(p: ServerPlayer, now: number): boolean {
  return p.connected || now - p.lastSeenAt < LIMITS.presenceGraceMs;
}

export function connectedCount(state: GameState): number {
  return state.players.filter((p) => p.connected).length;
}

/**
 * "Everyone is done" if every player is done, or — so a vanished phone can't
 * stall the room — every *present* player is done (and at least one is present).
 */
function everyoneDone(state: GameState, now: number, done: (p: ServerPlayer) => boolean): boolean {
  if (state.players.length === 0) return false;
  if (state.players.every(done)) return true;
  const present = state.players.filter((p) => isPresent(p, now));
  return present.length > 0 && present.every(done);
}

/** Update a player's connection flag. Returns true if anything changed. */
export function setPresence(state: GameState, playerId: string, connected: boolean, now: number): boolean {
  const p = state.players.find((x) => x.id === playerId);
  if (!p || p.connected === connected) return false;
  p.connected = connected;
  p.lastSeenAt = now;
  bump(state, now);
  return true;
}

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

function setPhaseTimer(state: GameState, seconds: number, now: number) {
  const ms = seconds * 1000;
  state.timer = state.paused
    ? { deadline: null, pausedRemainingMs: ms, durationMs: ms }
    : { deadline: now + ms, pausedRemainingMs: null, durationMs: ms };
}

export function remainingMs(state: GameState, now: number): number {
  if (!state.timer) return 0;
  if (state.timer.deadline === null) return state.timer.pausedRemainingMs ?? 0;
  return Math.max(0, state.timer.deadline - now);
}

/** The next moment the engine needs to be woken (timer expiry or presence-grace expiry). */
export function nextWakeTime(state: GameState, now: number): number | null {
  let next: number | null = state.timer?.deadline ?? null;
  if (state.phase === "submission" || state.phase === "guessing") {
    for (const p of state.players) {
      if (!p.connected) {
        const t = p.lastSeenAt + LIMITS.presenceGraceMs;
        if (t > now && (next === null || t < next)) next = t;
      }
    }
  }
  return next;
}

/**
 * Advance the game for the passage of time: expire timers and re-check
 * auto-advance conditions. Safe to call at any time, any number of times.
 */
export function tick(state: GameState, ctx: EngineContext): boolean {
  let changed = false;
  if (state.timer?.deadline != null && ctx.now >= state.timer.deadline) {
    changed = onTimerExpired(state, ctx) || changed;
  }
  changed = autoAdvance(state, ctx) || changed;
  if (changed) bump(state, ctx.now);
  return changed;
}

function onTimerExpired(state: GameState, ctx: EngineContext): boolean {
  switch (state.phase) {
    case "prompt":
      openSubmission(state, ctx);
      return true;
    case "submission":
      closeSubmission(state, ctx);
      return true;
    case "guessing":
      closeGuessing(state, ctx);
      return true;
    default:
      state.timer = null;
      return true;
  }
}

/** Advance early when everyone eligible has finished the current step. */
export function autoAdvance(state: GameState, ctx: EngineContext): boolean {
  const round = state.round;
  if (!round) return false;
  if (state.phase === "submission" && everyoneDone(state, ctx.now, (p) => !!round.answers[p.id])) {
    closeSubmission(state, ctx);
    return true;
  }
  if (state.phase === "guessing" && everyoneDone(state, ctx.now, (p) => round.locked.includes(p.id))) {
    closeGuessing(state, ctx);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Phase transitions
// ---------------------------------------------------------------------------

function bump(state: GameState, now: number) {
  state.version += 1;
  state.lastActivity = now;
}

function promptPool(state: GameState, prompts: readonly Prompt[]): Prompt[] {
  return prompts.filter((p) => state.config.categories.includes(p.category));
}

function buildPromptQueue(state: GameState, ctx: EngineContext) {
  const pool = promptPool(state, ctx.prompts);
  const fresh = pool.filter((p) => !state.previousGamePromptIds.includes(p.id));
  // Prefer prompts not seen in earlier games in this room, if there are enough
  // (with headroom for skips); otherwise fall back to the whole pool.
  const source = fresh.length >= state.config.rounds + 5 ? fresh : pool;
  state.promptQueue = shuffle(source, ctx.random).map((p) => p.id);
}

function takeNextPrompt(state: GameState, ctx: EngineContext): Prompt {
  const byId = new Map(ctx.prompts.map((p) => [p.id, p]));
  const pull = (): Prompt | undefined => {
    while (state.promptQueue.length) {
      const id = state.promptQueue.shift()!;
      const p = byId.get(id);
      if (p && !state.usedPromptIds.includes(id)) return p;
    }
    return undefined;
  };
  let prompt = pull();
  if (!prompt) {
    // Queue exhausted (many skips): draw from any unused prompt in the categories.
    const pool = promptPool(state, ctx.prompts).filter((p) => !state.usedPromptIds.includes(p.id));
    state.promptQueue = shuffle(pool, ctx.random).map((p) => p.id);
    prompt = pull();
  }
  if (!prompt) {
    // Every prompt in the chosen categories has been used in this game — only
    // reachable after ~100 skips. Allow repeats rather than getting stuck.
    state.usedPromptIds = [];
    buildPromptQueue(state, ctx);
    prompt = pull()!;
  }
  state.usedPromptIds.push(prompt.id);
  return prompt;
}

function startRound(state: GameState, number: number, ctx: EngineContext) {
  const prompt = takeNextPrompt(state, ctx);
  state.round = newRound(state, number, prompt);
  state.phase = "prompt";
  setPhaseTimer(state, LIMITS.promptSeconds, ctx.now);
}

function newRound(state: GameState, number: number, prompt: Prompt): ServerRound {
  return {
    number,
    prompt,
    answers: {},
    submissionOpenedAt: null,
    responses: null,
    guesses: {},
    locked: [],
    results: null,
    scoresBefore: Object.fromEntries(state.players.map((p) => [p.id, p.score])),
    revealIndex: 0,
    revealStage: "suspects",
    skipped: null,
  };
}

function openSubmission(state: GameState, ctx: EngineContext) {
  state.phase = "submission";
  state.round!.submissionOpenedAt = ctx.now;
  setPhaseTimer(state, state.config.submissionSeconds, ctx.now);
}

function closeSubmission(state: GameState, ctx: EngineContext) {
  const round = state.round!;
  const roster = state.players;
  const entries = roster
    .filter((p) => round.answers[p.id])
    .map((p) => ({ player: p, answer: round.answers[p.id]! }));

  if (entries.length < 2) {
    round.skipped = "not_enough_answers";
    round.responses = null;
    finishRound(state, ctx);
    return;
  }

  for (const { player, answer } of entries) {
    player.stats.answers += 1;
    player.stats.answerChars += textLength(answer.text);
  }
  const usedIds = new Set<string>();
  round.responses = shuffle(entries, ctx.random).map(({ player, answer }) => {
    let id: string;
    do id = `r_${randomId(ctx.random, 10)}`;
    while (usedIds.has(id));
    usedIds.add(id);
    return { id, authorId: player.id, text: answer.text };
  });
  state.phase = "guessing";
  setPhaseTimer(state, state.config.guessingSeconds, ctx.now);
}

/** Close guessing and score the round. Scoring is applied exactly once per round. */
function closeGuessing(state: GameState, ctx: EngineContext) {
  const round = state.round!;
  state.phase = "reveal";
  state.timer = null;
  round.revealIndex = 0;
  round.revealStage = "suspects";
  if (round.results) return; // idempotency guard — never score twice
  const results = scoreRound(
    round.responses ?? [],
    round.guesses,
    state.players.map((p) => p.id),
  );
  round.results = results;
  for (const p of state.players) {
    p.score += results.pointsByPlayer[p.id]?.total ?? 0;
  }
  for (const r of results.byResponse) {
    const author = state.players.find((p) => p.id === r.authorId);
    if (author) {
      author.stats.playersFooled += r.fooledIds.length;
      author.stats.timesExposed += r.correctGuesserIds.length;
    }
    for (const g of r.guesses) {
      const guesser = state.players.find((p) => p.id === g.guesserId);
      if (!guesser) continue;
      guesser.stats.guessesMade += 1;
      if (g.correct) guesser.stats.correctGuesses += 1;
    }
  }
  void ctx;
}

function finishRound(state: GameState, ctx: EngineContext) {
  const round = state.round!;
  state.phase = "scoreboard";
  state.timer = null;
  if (state.history.some((h) => h.number === round.number)) return;
  let firstAnswerBy: string | null = null;
  if (!round.skipped) {
    let best = Infinity;
    for (const [pid, a] of Object.entries(round.answers)) {
      if (a.firstSubmittedAt < best) {
        best = a.firstSubmittedAt;
        firstAnswerBy = pid;
      }
    }
    const first = state.players.find((p) => p.id === firstAnswerBy);
    if (first) first.stats.firstToAnswer += 1;
  }
  state.history.push({
    number: round.number,
    promptText: round.prompt.text,
    skipped: !!round.skipped,
    results: round.results,
    firstAnswerBy,
  });
  void ctx;
}

function endGame(state: GameState) {
  state.phase = "gameOver";
  state.timer = null;
  state.paused = false;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function validateConfig(config: GameConfig): string | null {
  if (!(ROUND_OPTIONS as readonly number[]).includes(config.rounds)) return "Rounds must be 5, 7, or 10";
  for (const [label, v] of [
    ["Answer timer", config.submissionSeconds],
    ["Guess timer", config.guessingSeconds],
  ] as const) {
    if (!Number.isInteger(v) || v < LIMITS.minTimerSeconds || v > LIMITS.maxTimerSeconds) {
      return `${label} must be ${LIMITS.minTimerSeconds}–${LIMITS.maxTimerSeconds} seconds`;
    }
  }
  if (config.categories.length === 0) return "Choose at least one category";
  if (new Set(config.categories).size !== config.categories.length) return "Duplicate category";
  if (config.categories.some((c) => !CATEGORIES.includes(c))) return "Unknown category";
  return null;
}

export function startBlockers(state: GameState, prompts: readonly Prompt[]): string[] {
  const out: string[] = [];
  const connected = connectedCount(state);
  if (connected < LIMITS.minPlayers) {
    out.push(`Need at least ${LIMITS.minPlayers} connected players (${connected} now)`);
  }
  if (state.players.length > LIMITS.maxPlayers) out.push(`At most ${LIMITS.maxPlayers} players`);
  const pool = promptPool(state, prompts).length;
  if (pool < state.config.rounds) out.push("Not enough prompts in the selected categories");
  return out;
}

function validateName(state: GameState, raw: string, selfId: string | null): ActionResult | string {
  const name = normalizeName(raw);
  if (textLength(name) < LIMITS.minNameLength) return fail("invalid", "Please enter a name");
  if (textLength(name) > LIMITS.maxNameLength) {
    return fail("invalid", `Names can be at most ${LIMITS.maxNameLength} characters`);
  }
  const key = nameKey(name);
  if (state.players.some((p) => p.id !== selfId && nameKey(p.name) === key)) {
    return fail("name_taken", `"${name}" is already taken — try another name`);
  }
  return name;
}

function validateAvatar(state: GameState, avatar: number, selfId: string | null): ActionResult | null {
  if (!Number.isInteger(avatar) || avatar < 0 || avatar >= LIMITS.avatarCount) {
    return fail("invalid", "Unknown avatar");
  }
  if (state.players.some((p) => p.id !== selfId && p.avatar === avatar)) {
    return fail("invalid", "Someone already picked that avatar");
  }
  return null;
}

/** Phase gate for round-scoped player actions: distinguishes "too late" from "not now". */
function roundGate(state: GameState, phase: Phase, round: number, ctx: EngineContext): ActionResult | null {
  const current = state.round;
  if (!current || current.number !== round) {
    return current && round < current.number
      ? fail("too_late", "That round is over")
      : fail("wrong_phase", "That round isn't active");
  }
  const order: Phase[] = ["prompt", "submission", "guessing", "reveal", "scoreboard"];
  if (state.phase !== phase) {
    return order.indexOf(state.phase) > order.indexOf(phase)
      ? fail("too_late", "Time's up — that step is closed")
      : fail("wrong_phase", "Not yet!");
  }
  if (state.timer?.deadline != null && ctx.now >= state.timer.deadline) {
    return fail("too_late", "Time's up — that step is closed");
  }
  return null;
}

// ---------------------------------------------------------------------------
// Action dispatch
// ---------------------------------------------------------------------------

export function applyAction(state: GameState, actor: Actor, action: Action, ctx: EngineContext): ActionResult {
  if (state.closed) return fail("not_found", "This room has closed");
  if (HOST_ACTIONS.has(action.type) && actor.kind !== "host") {
    return fail("unauthorized", "Only the host can do that");
  }
  if (PLAYER_ACTIONS.has(action.type) && actor.kind !== "player") {
    return fail("unauthorized", "Only players can do that");
  }
  if (action.type === "join" && actor.kind !== "guest") {
    return fail(actor.kind === "player" ? "invalid" : "unauthorized", "Already joined");
  }
  const result = dispatch(state, actor, action, ctx);
  if (result.ok && result.changed) {
    autoAdvance(state, ctx);
    bump(state, ctx.now);
  }
  return result;
}

function dispatch(state: GameState, actor: Actor, action: Action, ctx: EngineContext): ActionResult {
  const me = actor.kind === "player" ? state.players.find((p) => p.id === actor.playerId) : undefined;
  if (actor.kind === "player" && !me) return fail("invalid_token", "You are no longer in this game");

  switch (action.type) {
    case "join": {
      if (state.phase !== "lobby") return fail("game_in_progress", "This game has already started");
      if (state.players.length >= LIMITS.maxPlayers) return fail("room_full", "This room is full (10 players max)");
      const name = validateName(state, action.name, null);
      if (typeof name !== "string") return name;
      const avatarError = validateAvatar(state, action.avatar, null);
      if (avatarError) return avatarError;
      let playerId: string;
      do playerId = `p_${randomId(ctx.random, 8)}`;
      while (state.players.some((p) => p.id === playerId));
      const token = randomId(ctx.random, 32);
      state.players.push({
        id: playerId,
        token,
        name,
        avatar: action.avatar,
        joinOrder: state.nextJoinOrder++,
        score: 0,
        connected: false,
        lastSeenAt: ctx.now,
        stats: emptyStats(),
      });
      return { ok: true, changed: true, joined: { playerId, token } };
    }

    case "updateProfile": {
      if (state.phase !== "lobby") return fail("wrong_phase", "You can only change your profile in the lobby");
      let name = me!.name;
      if (action.name !== undefined) {
        const v = validateName(state, action.name, me!.id);
        if (typeof v !== "string") return v;
        name = v;
      }
      if (action.avatar !== undefined) {
        const err = validateAvatar(state, action.avatar, me!.id);
        if (err) return err;
      }
      const avatar = action.avatar ?? me!.avatar;
      if (name === me!.name && avatar === me!.avatar) return OK_UNCHANGED;
      me!.name = name;
      me!.avatar = avatar;
      return OK_CHANGED;
    }

    case "submitAnswer": {
      const gate = roundGate(state, "submission", action.round, ctx);
      if (gate) return gate;
      const text = cleanText(action.text);
      if (!text) return fail("invalid", "Your answer can't be empty");
      if (textLength(text) > LIMITS.maxAnswerLength) {
        return fail("invalid", `Answers can be at most ${LIMITS.maxAnswerLength} characters`);
      }
      const round = state.round!;
      const existing = round.answers[me!.id];
      if (existing?.text === text) return OK_UNCHANGED;
      round.answers[me!.id] = {
        text,
        submittedAt: ctx.now,
        firstSubmittedAt: existing?.firstSubmittedAt ?? ctx.now,
      };
      return OK_CHANGED;
    }

    case "setGuess": {
      const gate = roundGate(state, "guessing", action.round, ctx);
      if (gate) return gate;
      const round = state.round!;
      if (round.locked.includes(me!.id)) return fail("already_locked", "Your guesses are locked in");
      const response = round.responses?.find((r) => r.id === action.responseId);
      if (!response) return fail("invalid", "Unknown answer");
      if (response.authorId === me!.id) return fail("invalid", "That's your own answer!");
      const mine = (round.guesses[me!.id] ??= {});
      if (action.authorId === null) {
        if (!(action.responseId in mine)) return OK_UNCHANGED;
        delete mine[action.responseId];
        return OK_CHANGED;
      }
      if (action.authorId === me!.id) return fail("invalid", "You can't guess yourself for someone else's answer");
      if (!round.responses!.some((r) => r.authorId === action.authorId)) {
        return fail("invalid", "That player didn't write an answer this round");
      }
      if (mine[action.responseId] === action.authorId) return OK_UNCHANGED;
      mine[action.responseId] = action.authorId;
      return OK_CHANGED;
    }

    case "lockGuesses": {
      const gate = roundGate(state, "guessing", action.round, ctx);
      if (gate) return gate;
      const round = state.round!;
      if (round.locked.includes(me!.id)) return fail("already_locked", "Your guesses are already locked in");
      round.locked.push(me!.id);
      return OK_CHANGED;
    }

    case "configure": {
      if (state.phase !== "lobby") return fail("wrong_phase", "Settings can only be changed in the lobby");
      const next = mergeConfig(state.config, action.config);
      const err = validateConfig(next);
      if (err) return fail("invalid", err);
      if (JSON.stringify(next) === JSON.stringify(state.config)) return OK_UNCHANGED;
      state.config = next;
      return OK_CHANGED;
    }

    case "start": {
      if (state.phase !== "lobby") return fail("wrong_phase", "The game has already started");
      const blockers = startBlockers(state, ctx.prompts);
      if (blockers.length) {
        return fail(connectedCount(state) < LIMITS.minPlayers ? "not_enough_players" : "invalid", blockers[0]!);
      }
      beginGame(state, ctx);
      return OK_CHANGED;
    }

    case "pause": {
      if (state.phase === "lobby" || state.phase === "gameOver") return fail("wrong_phase", "Nothing to pause");
      if (state.paused) return OK_UNCHANGED;
      state.paused = true;
      if (state.timer && state.timer.deadline !== null) {
        state.timer.pausedRemainingMs = Math.max(0, state.timer.deadline - ctx.now);
        state.timer.deadline = null;
      }
      return OK_CHANGED;
    }

    case "resume": {
      if (!state.paused) return OK_UNCHANGED;
      state.paused = false;
      if (state.timer && state.timer.deadline === null) {
        state.timer.deadline = ctx.now + (state.timer.pausedRemainingMs ?? 0);
        state.timer.pausedRemainingMs = null;
      }
      return OK_CHANGED;
    }

    case "advance": {
      const { from } = action;
      const round = state.round;
      if (from.phase !== state.phase || from.round !== (round?.number ?? 0)) {
        return fail("stale", "The game has already moved on");
      }
      if (
        state.phase === "reveal" &&
        (from.revealIndex !== round!.revealIndex || from.revealStage !== round!.revealStage)
      ) {
        return fail("stale", "That answer has already been revealed");
      }
      switch (state.phase) {
        case "prompt":
          openSubmission(state, ctx);
          return OK_CHANGED;
        case "submission":
          closeSubmission(state, ctx);
          return OK_CHANGED;
        case "guessing":
          closeGuessing(state, ctx);
          return OK_CHANGED;
        case "reveal": {
          const r = round!;
          if (r.revealStage === "suspects") {
            r.revealStage = "author";
          } else if (r.revealIndex < (r.responses?.length ?? 0) - 1) {
            r.revealIndex += 1;
            r.revealStage = "suspects";
          } else {
            finishRound(state, ctx);
          }
          return OK_CHANGED;
        }
        case "scoreboard":
          if (round!.number >= state.config.rounds) endGame(state);
          else startRound(state, round!.number + 1, ctx);
          return OK_CHANGED;
        default:
          return fail("wrong_phase", "Nothing to advance");
      }
    }

    case "skipPrompt": {
      if (!["prompt", "submission", "guessing"].includes(state.phase)) {
        return fail("wrong_phase", "Prompts can only be skipped before the reveal");
      }
      const round = state.round!;
      if (round.number !== action.round || round.prompt.id !== action.promptId) {
        return fail("stale", "That prompt was already skipped");
      }
      const prompt = takeNextPrompt(state, ctx);
      state.round = newRound(state, round.number, prompt);
      state.phase = "prompt";
      setPhaseTimer(state, LIMITS.promptSeconds, ctx.now);
      return OK_CHANGED;
    }

    case "kick": {
      if (state.phase !== "lobby") return fail("wrong_phase", "Players can only be removed in the lobby");
      const idx = state.players.findIndex((p) => p.id === action.playerId);
      if (idx < 0) return fail("invalid", "No such player");
      state.players.splice(idx, 1);
      return { ok: true, changed: true, kickedPlayerId: action.playerId };
    }

    case "endGame": {
      if (state.phase === "lobby" || state.phase === "gameOver") return fail("wrong_phase", "No game in progress");
      if (state.phase !== "reveal" && state.phase !== "scoreboard") state.round = null; // discard unscored round
      endGame(state);
      return OK_CHANGED;
    }

    case "rematch": {
      if (state.phase !== "gameOver") return fail("wrong_phase", "Rematches start from the final results");
      if (!action.toLobby && connectedCount(state) < LIMITS.minPlayers) {
        return fail("not_enough_players", `Need at least ${LIMITS.minPlayers} connected players`);
      }
      resetForRematch(state);
      if (action.toLobby) {
        state.phase = "lobby";
      } else {
        beginGame(state, ctx);
      }
      return OK_CHANGED;
    }
  }
}

function mergeConfig(current: GameConfig, patch: ConfigPatch): GameConfig {
  return {
    rounds: patch.rounds ?? current.rounds,
    submissionSeconds: patch.submissionSeconds ?? current.submissionSeconds,
    guessingSeconds: patch.guessingSeconds ?? current.guessingSeconds,
    categories: patch.categories
      ? CATEGORIES.filter((c) => patch.categories!.includes(c))
      : [...current.categories],
  } satisfies GameConfig;
}

function beginGame(state: GameState, ctx: EngineContext) {
  for (const p of state.players) {
    p.score = 0;
    p.stats = emptyStats();
  }
  state.history = [];
  state.usedPromptIds = [];
  state.paused = false;
  buildPromptQueue(state, ctx);
  startRound(state, 1, ctx);
}

function resetForRematch(state: GameState) {
  state.previousGamePromptIds = [...new Set([...state.previousGamePromptIds, ...state.usedPromptIds])];
  state.usedPromptIds = [];
  state.promptQueue = [];
  state.history = [];
  state.round = null;
  state.timer = null;
  state.paused = false;
  state.gameNumber += 1;
  for (const p of state.players) {
    p.score = 0;
    p.stats = emptyStats();
  }
}

export type { Category };
