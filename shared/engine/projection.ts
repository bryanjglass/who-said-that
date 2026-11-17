/**
 * Per-role client projections — the security boundary of the game.
 *
 * Rules enforced here (and asserted by tests/unit/projection.test.ts):
 *  - Answer text is not included anywhere before guessing begins (except a
 *    player's own answer, sent only to that player).
 *  - Authorship is never included before that response's author stage.
 *  - Other players' guesses are never included before the reveal, and even
 *    then only as anonymous suspect tallies until the author stage.
 *  - Points from unrevealed responses are excluded from visible scores.
 *  - Reconnect tokens are never included in any projection.
 */
import { LIMITS, responseLabel } from "../constants";
import type {
  ClientView,
  FinalView,
  MyPrivateView,
  PlayerPublic,
  RevealCardView,
  RevealView,
  Role,
  RoundSummaryView,
  RoundView,
} from "../views";
import { startBlockers } from "./engine";
import { buildStandings, finalAwards, pointsFromRevealed, rankScores, roundHighlights } from "./scoring";
import type { GameState, Prompt, ServerPlayer } from "./state";

export interface ProjectionContext {
  now: number;
  hostConnected: boolean;
  tvConnections: number;
  prompts: readonly Prompt[];
}

export interface Viewer {
  role: Role;
  playerId?: string | null;
}

/** Scores as they should currently be visible (gated during the reveal). */
export function visibleScores(state: GameState): Record<string, number> {
  const round = state.round;
  if (state.phase === "reveal" && round?.results) {
    const revealedCount = round.revealIndex + (round.revealStage === "author" ? 1 : 0);
    const gained = pointsFromRevealed(round.results, revealedCount);
    return Object.fromEntries(
      state.players.map((p) => [p.id, (round.scoresBefore[p.id] ?? 0) + (gained[p.id] ?? 0)]),
    );
  }
  return Object.fromEntries(state.players.map((p) => [p.id, p.score]));
}

function byJoinOrder(state: GameState): ServerPlayer[] {
  return [...state.players].sort((a, b) => a.joinOrder - b.joinOrder);
}

function projectRound(state: GameState): RoundView | null {
  const round = state.round;
  if (!round || state.phase === "lobby" || state.phase === "gameOver") return null;
  const roster = byJoinOrder(state);
  const showResponses =
    (state.phase === "guessing" || state.phase === "reveal" || state.phase === "scoreboard") &&
    round.responses !== null;

  let reveal: RevealView | null = null;
  if (state.phase === "reveal" && round.responses && round.results) {
    const i = round.revealIndex;
    const response = round.responses[i]!;
    const result = round.results.byResponse[i]!;
    const authorStage = round.revealStage === "author";
    const tally = new Map<string, number>();
    for (const g of result.guesses) tally.set(g.guessedId, (tally.get(g.guessedId) ?? 0) + 1);
    const joinOrder = new Map(roster.map((p) => [p.id, p.joinOrder]));
    const suspects = [...tally.entries()]
      .map(([playerId, count]) => ({ playerId, count }))
      .sort((a, b) => b.count - a.count || (joinOrder.get(a.playerId) ?? 0) - (joinOrder.get(b.playerId) ?? 0));
    const current: RevealCardView = {
      index: i,
      responseId: response.id,
      label: responseLabel(i),
      text: response.text,
      suspects,
      totalGuesses: result.guesses.length,
      authorId: authorStage ? response.authorId : null,
      guesses: authorStage ? result.guesses.map((g) => ({ ...g })) : null,
      correctGuesserIds: authorStage ? [...result.correctGuesserIds] : null,
      fooledIds: authorStage ? [...result.fooledIds] : null,
      authorPoints: authorStage ? result.authorPoints : null,
    };
    const revealedCount = i + (authorStage ? 1 : 0);
    const revealedAuthors: Record<string, string> = {};
    for (const r of round.responses.slice(0, revealedCount)) revealedAuthors[r.id] = r.authorId;
    reveal = {
      index: i,
      total: round.responses.length,
      stage: round.revealStage,
      current,
      revealedAuthors,
    };
  }

  const authorIdSet = new Set(round.responses?.map((r) => r.authorId) ?? []);
  return {
    number: round.number,
    total: state.config.rounds,
    prompt: { id: round.prompt.id, text: round.prompt.text, category: round.prompt.category },
    submittedIds: roster.filter((p) => round.answers[p.id]).map((p) => p.id),
    lockedIds: roster.filter((p) => round.locked.includes(p.id)).map((p) => p.id),
    responses: showResponses
      ? round.responses!.map((r, idx) => ({ id: r.id, label: responseLabel(idx), text: r.text }))
      : null,
    // Sorted by join order — deliberately NOT in response order.
    authorIds: showResponses ? roster.filter((p) => authorIdSet.has(p.id)).map((p) => p.id) : null,
    reveal,
    skipped: round.skipped,
  };
}

function projectScoreboard(state: GameState): RoundSummaryView | null {
  const round = state.round;
  if (state.phase !== "scoreboard" || !round) return null;
  const scores = Object.fromEntries(state.players.map((p) => [p.id, p.score]));
  const roundPoints = Object.fromEntries(
    Object.entries(round.results?.pointsByPlayer ?? {}).map(([id, pts]) => [id, pts.total]),
  );
  return {
    number: round.number,
    promptText: round.prompt.text,
    skipped: !!round.skipped,
    standings: buildStandings(byJoinOrder(state), scores, round.scoresBefore, roundPoints),
    highlights: round.results ? roundHighlights(round.results) : [],
  };
}

function projectFinal(state: GameState): FinalView | null {
  if (state.phase !== "gameOver") return null;
  const scores = Object.fromEntries(state.players.map((p) => [p.id, p.score]));
  const standings = buildStandings(byJoinOrder(state), scores, null, {});
  const winnerIds = standings.filter((s) => s.rank === 1).map((s) => s.playerId);
  return {
    standings,
    winnerIds,
    awards: finalAwards(byJoinOrder(state), state.history, winnerIds),
    roundsPlayed: state.history.length,
  };
}

function projectMe(state: GameState, playerId: string): MyPrivateView | null {
  const me = state.players.find((p) => p.id === playerId);
  if (!me) return null;
  const round = state.round;
  const inRound = round && state.phase !== "lobby" && state.phase !== "gameOver";
  const myResponse = inRound ? round.responses?.find((r) => r.authorId === me.id) : undefined;
  const pts = state.phase === "scoreboard" ? round?.results?.pointsByPlayer[me.id] : undefined;
  return {
    id: me.id,
    name: me.name,
    avatar: me.avatar,
    answer: inRound ? (round.answers[me.id]?.text ?? null) : null,
    myResponseId: myResponse?.id ?? null,
    guesses: inRound ? { ...(round.guesses[me.id] ?? {}) } : {},
    locked: inRound ? round.locked.includes(me.id) : false,
    roundPoints: pts ? { ...pts } : null,
  };
}

export function projectView(state: GameState, viewer: Viewer, ctx: ProjectionContext): ClientView {
  const scores = visibleScores(state);
  const ranked = rankScores(byJoinOrder(state).map((p) => ({ ...p, score: scores[p.id] ?? 0 })));
  const rankOf = new Map(ranked.map((r) => [r.id, r.rank]));
  const players: PlayerPublic[] = byJoinOrder(state).map((p) => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    connected: p.connected,
    score: scores[p.id] ?? 0,
    rank: rankOf.get(p.id) ?? 1,
  }));

  const timer = state.timer
    ? {
        deadline: state.timer.deadline,
        remainingMs:
          state.timer.deadline === null
            ? (state.timer.pausedRemainingMs ?? 0)
            : Math.max(0, state.timer.deadline - ctx.now),
        durationMs: state.timer.durationMs,
        paused: state.timer.deadline === null,
      }
    : null;

  const blockers = viewer.role === "host" && state.phase === "lobby" ? startBlockers(state, ctx.prompts) : [];

  return {
    role: viewer.role,
    roomCode: state.code,
    version: state.version,
    serverNow: ctx.now,
    gameNumber: state.gameNumber,
    phase: state.phase,
    paused: state.paused,
    config: { ...state.config, categories: [...state.config.categories] },
    players,
    hostConnected: ctx.hostConnected,
    round: projectRound(state),
    timer,
    scoreboard: projectScoreboard(state),
    final: projectFinal(state),
    me: viewer.role === "player" && viewer.playerId ? projectMe(state, viewer.playerId) : null,
    host:
      viewer.role === "host"
        ? {
            canStart: state.phase === "lobby" && blockers.length === 0,
            startBlockers: blockers,
            tvConnections: ctx.tvConnections,
          }
        : null,
  };
}

export const MAX_PLAYERS = LIMITS.maxPlayers;
