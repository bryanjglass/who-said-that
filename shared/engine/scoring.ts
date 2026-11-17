/**
 * Pure, deterministic scoring logic.
 *
 *  - +500 to a guesser for each correctly identified author of ANOTHER player's response.
 *  - +250 to a response's author for each OTHER player who guessed a wrong author.
 *  - Missing guesses score nothing for anyone (they don't count as "fooled").
 *  - Nobody can score from their own response (self-guesses are ignored).
 */
import { POINTS } from "../constants";
import type { Award, Highlight, StandingRow } from "../views";
import type {
  PlayerRoundPoints,
  ResponseResult,
  RoundHistoryEntry,
  RoundResults,
  ServerPlayer,
  ServerResponse,
} from "./state";

export function scoreRound(
  responses: ServerResponse[],
  guesses: Record<string, Record<string, string>>,
  /** All players in the game, in a stable order (join order). */
  playerIds: string[],
): RoundResults {
  const authorIds = new Set(responses.map((r) => r.authorId));
  const pointsByPlayer: Record<string, PlayerRoundPoints> = {};
  for (const pid of playerIds) pointsByPlayer[pid] = { guessing: 0, deception: 0, total: 0 };

  const byResponse: ResponseResult[] = responses.map((response) => {
    const result: ResponseResult = {
      responseId: response.id,
      authorId: response.authorId,
      guesses: [],
      correctGuesserIds: [],
      fooledIds: [],
      authorPoints: 0,
    };
    for (const guesserId of playerIds) {
      if (guesserId === response.authorId) continue; // can't guess (or fool) yourself
      const guessedId = guesses[guesserId]?.[response.id];
      if (!guessedId) continue; // missing guess: no points either way
      if (guessedId === guesserId) continue; // self-accusation is not a valid guess
      if (!authorIds.has(guessedId)) continue; // not a possible author: invalid
      const correct = guessedId === response.authorId;
      result.guesses.push({ guesserId, guessedId, correct });
      if (correct) {
        result.correctGuesserIds.push(guesserId);
        add(pointsByPlayer, guesserId, "guessing", POINTS.correctGuess);
      } else {
        result.fooledIds.push(guesserId);
        result.authorPoints += POINTS.deception;
        add(pointsByPlayer, response.authorId, "deception", POINTS.deception);
      }
    }
    return result;
  });

  return { byResponse, pointsByPlayer };
}

function add(
  map: Record<string, PlayerRoundPoints>,
  pid: string,
  kind: "guessing" | "deception",
  pts: number,
) {
  const entry = (map[pid] ??= { guessing: 0, deception: 0, total: 0 });
  entry[kind] += pts;
  entry.total += pts;
}

/** Points earned from the first `count` responses (used to gate scores during reveal). */
export function pointsFromRevealed(results: RoundResults, count: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of results.byResponse.slice(0, count)) {
    for (const g of r.correctGuesserIds) out[g] = (out[g] ?? 0) + POINTS.correctGuess;
    if (r.authorPoints) out[r.authorId] = (out[r.authorId] ?? 0) + r.authorPoints;
  }
  return out;
}

/**
 * Standard competition ranking ("1224"): tied scores share a rank, and the
 * next rank skips accordingly. Sorted highest score first; ties keep join order.
 */
export function rankScores<T extends { id: string; score: number; joinOrder: number }>(
  entries: T[],
): (T & { rank: number })[] {
  const sorted = [...entries].sort((a, b) => b.score - a.score || a.joinOrder - b.joinOrder);
  return sorted.map((e) => ({ ...e, rank: 1 + sorted.filter((o) => o.score > e.score).length }));
}

export function buildStandings(
  players: Pick<ServerPlayer, "id" | "name" | "avatar" | "joinOrder">[],
  scores: Record<string, number>,
  previousScores: Record<string, number> | null,
  roundPoints: Record<string, number>,
): StandingRow[] {
  const prevRanks = previousScores
    ? Object.fromEntries(
        rankScores(players.map((p) => ({ ...p, score: previousScores[p.id] ?? 0 }))).map((r) => [
          r.id,
          r.rank,
        ]),
      )
    : null;
  return rankScores(players.map((p) => ({ ...p, score: scores[p.id] ?? 0 }))).map((p) => ({
    playerId: p.id,
    name: p.name,
    avatar: p.avatar,
    score: p.score,
    rank: p.rank,
    previousRank: prevRanks ? (prevRanks[p.id] ?? null) : null,
    roundPoints: roundPoints[p.id] ?? 0,
  }));
}

function leaders(counts: Record<string, number>): string[] {
  const max = Math.max(0, ...Object.values(counts));
  if (max <= 0) return [];
  return Object.keys(counts).filter((k) => counts[k] === max);
}

/** Per-round highlights shown on the scoreboard. */
export function roundHighlights(results: RoundResults): Highlight[] {
  const fooled: Record<string, number> = {};
  const correct: Record<string, number> = {};
  const exposed: string[] = [];
  for (const r of results.byResponse) {
    fooled[r.authorId] = (fooled[r.authorId] ?? 0) + r.fooledIds.length;
    for (const g of r.correctGuesserIds) correct[g] = (correct[g] ?? 0) + 1;
    if (r.guesses.length > 0 && r.fooledIds.length === 0 && !exposed.includes(r.authorId)) {
      exposed.push(r.authorId);
    }
  }
  const out: Highlight[] = [];
  const mysterious = leaders(fooled);
  if (mysterious.length) {
    const n = fooled[mysterious[0]!]!;
    out.push({
      kind: "mostMysterious",
      title: "Most Mysterious",
      description: `Fooled ${n} ${n === 1 ? "player" : "players"}`,
      playerIds: mysterious,
    });
  }
  const readers = leaders(correct);
  if (readers.length) {
    const n = correct[readers[0]!]!;
    out.push({
      kind: "mindReader",
      title: "Mind Reader",
      description: `${n} correct ${n === 1 ? "guess" : "guesses"}`,
      playerIds: readers,
    });
  }
  if (exposed.length) {
    out.push({
      kind: "totallyExposed",
      title: "Totally Exposed",
      description: "Everyone saw right through them",
      playerIds: exposed,
    });
  }
  return out;
}

/** End-of-game awards computed from the whole game's history. */
export function finalAwards(
  players: ServerPlayer[],
  history: RoundHistoryEntry[],
  winnerIds: string[],
): Award[] {
  const fooled: Record<string, number> = {};
  const correct: Record<string, number> = {};
  const exposed: Record<string, number> = {};
  const accused: Record<string, number> = {};
  const firsts: Record<string, number> = {};
  for (const round of history) {
    if (round.firstAnswerBy) firsts[round.firstAnswerBy] = (firsts[round.firstAnswerBy] ?? 0) + 1;
    if (!round.results) continue;
    for (const r of round.results.byResponse) {
      fooled[r.authorId] = (fooled[r.authorId] ?? 0) + r.fooledIds.length;
      exposed[r.authorId] = (exposed[r.authorId] ?? 0) + r.correctGuesserIds.length;
      for (const g of r.correctGuesserIds) correct[g] = (correct[g] ?? 0) + 1;
      for (const g of r.guesses) {
        if (!g.correct) accused[g.guessedId] = (accused[g.guessedId] ?? 0) + 1;
      }
    }
  }
  const avgLen: Record<string, number> = {};
  for (const p of players) {
    if (p.stats.answers >= 2) avgLen[p.id] = p.stats.answerChars / p.stats.answers;
  }

  const awards: Award[] = [];
  const push = (a: Omit<Award, "playerIds">, ids: string[]) => {
    if (ids.length && ids.length < players.length) awards.push({ ...a, playerIds: ids });
  };
  if (winnerIds.length) {
    awards.push({
      id: "champion",
      emoji: "👑",
      title: winnerIds.length > 1 ? "Co-Champions" : "Champion",
      description: "Top of the leaderboard",
      playerIds: winnerIds,
    });
  }
  push(
    { id: "masterOfDisguise", emoji: "🥸", title: "Master of Disguise", description: "Fooled the most players all game" },
    leaders(fooled),
  );
  push(
    { id: "mindReader", emoji: "🔮", title: "Mind Reader", description: "Most correct guesses" },
    leaders(correct),
  );
  push(
    { id: "openBook", emoji: "📖", title: "Open Book", description: "Most often identified correctly" },
    leaders(exposed),
  );
  push(
    { id: "usualSuspect", emoji: "🕵️", title: "The Usual Suspect", description: "Wrongly accused the most" },
    leaders(accused),
  );
  push(
    { id: "quickDraw", emoji: "⚡", title: "Quick Draw", description: "First to answer most often" },
    leaders(firsts),
  );
  const longest = leaders(avgLen);
  push(
    { id: "novelist", emoji: "✍️", title: "The Novelist", description: "Longest answers on average" },
    longest,
  );
  return awards;
}
