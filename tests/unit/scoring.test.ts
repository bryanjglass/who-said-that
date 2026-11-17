import { describe, expect, it } from "vitest";
import { buildStandings, finalAwards, pointsFromRevealed, rankScores, roundHighlights, scoreRound } from "../../shared/engine/scoring";
import type { ServerPlayer } from "../../shared/engine/state";

const players = ["abby", "owen", "mom", "dad"];
const responses = [
  { id: "r1", authorId: "abby", text: "Nobody is allowed to talk before 10 AM." },
  { id: "r2", authorId: "owen", text: "All meetings must be conducted on trampolines." },
  { id: "r3", authorId: "mom", text: "Pizza must be served at every meal." },
  { id: "r4", authorId: "dad", text: "Parents must ask permission before using TikTok." },
];

describe("scoreRound", () => {
  it("matches the worked example from the spec (Abby fools Owen and Dad; Mom guesses right)", () => {
    const res = scoreRound(
      responses,
      { owen: { r1: "dad" }, mom: { r1: "abby" }, dad: { r1: "owen" } },
      players,
    );
    expect(res.pointsByPlayer.abby).toEqual({ guessing: 0, deception: 500, total: 500 });
    expect(res.pointsByPlayer.mom).toEqual({ guessing: 500, deception: 0, total: 500 });
    expect(res.pointsByPlayer.owen!.total).toBe(0);
    expect(res.pointsByPlayer.dad!.total).toBe(0);
    expect(res.byResponse[0]!.correctGuesserIds).toEqual(["mom"]);
    expect(res.byResponse[0]!.fooledIds).toEqual(["owen", "dad"]);
    expect(res.byResponse[0]!.authorPoints).toBe(500);
  });

  it("awards exactly 500 per correct guess and 250 per fooled player across a full round", () => {
    const guesses = {
      abby: { r2: "owen", r3: "dad", r4: "mom" }, // 1 correct; fooled by mom(r3) & dad(r4)
      owen: { r1: "abby", r3: "mom", r4: "dad" }, // 3 correct
      mom: { r1: "owen", r2: "owen", r4: "abby" }, // 1 correct; fooled by abby(r1) & dad(r4)
      dad: { r1: "abby", r2: "abby", r3: "mom" }, // 2 correct; fooled by owen(r2)
    };
    const res = scoreRound(responses, guesses, players);
    expect(res.pointsByPlayer.abby).toEqual({ guessing: 500, deception: 250, total: 750 });
    expect(res.pointsByPlayer.owen).toEqual({ guessing: 1500, deception: 250, total: 1750 });
    expect(res.pointsByPlayer.mom).toEqual({ guessing: 500, deception: 250, total: 750 });
    expect(res.pointsByPlayer.dad).toEqual({ guessing: 1000, deception: 500, total: 1500 });
  });

  it("ignores self-guesses on your own response and self-accusations on others", () => {
    const res = scoreRound(responses, { abby: { r1: "abby", r2: "abby" } }, players);
    expect(res.pointsByPlayer.abby!.total).toBe(0);
    expect(res.pointsByPlayer.owen!.total).toBe(0);
    expect(res.byResponse.every((r) => r.guesses.length === 0)).toBe(true);
  });

  it("does not count missing guesses as fooled (no deception points)", () => {
    const res = scoreRound(responses, { owen: { r1: "abby" } }, players);
    expect(res.pointsByPlayer.abby!.deception).toBe(0);
    expect(res.pointsByPlayer.owen!.guessing).toBe(500);
    expect(res.byResponse[0]!.guesses).toHaveLength(1);
  });

  it("ignores guesses naming a player who wrote no response", () => {
    const res = scoreRound(responses.slice(0, 2), { mom: { r1: "dad" } }, players);
    expect(res.pointsByPlayer.abby!.total).toBe(0);
    expect(res.byResponse[0]!.fooledIds).toEqual([]);
  });

  it("allows the same author to be guessed for several responses", () => {
    const res = scoreRound(responses, { mom: { r1: "abby", r2: "abby", r4: "abby" } }, players);
    expect(res.pointsByPlayer.mom!.guessing).toBe(500);
    expect(res.pointsByPlayer.owen!.deception).toBe(250);
    expect(res.pointsByPlayer.dad!.deception).toBe(250);
  });

  it("is deterministic", () => {
    const g = { abby: { r2: "mom" }, owen: { r1: "abby" } };
    expect(scoreRound(responses, g, players)).toEqual(scoreRound(responses, g, players));
  });

  it("reveals points progressively", () => {
    const res = scoreRound(responses, { owen: { r1: "abby", r3: "dad" } }, players);
    expect(pointsFromRevealed(res, 0)).toEqual({});
    expect(pointsFromRevealed(res, 1)).toEqual({ owen: 500 });
    expect(pointsFromRevealed(res, 3)).toEqual({ owen: 500, mom: 250 });
  });
});

describe("ranking", () => {
  it("gives tied players tied ranks (1,1,3) and sorts highest first", () => {
    const ranked = rankScores([
      { id: "a", score: 500, joinOrder: 0 },
      { id: "b", score: 1000, joinOrder: 1 },
      { id: "c", score: 1000, joinOrder: 2 },
      { id: "d", score: 0, joinOrder: 3 },
    ]);
    expect(ranked.map((r) => [r.id, r.rank])).toEqual([
      ["b", 1],
      ["c", 1],
      ["a", 3],
      ["d", 4],
    ]);
  });

  it("tracks rank movement between rounds", () => {
    const ps = [
      { id: "a", name: "A", avatar: 0, joinOrder: 0 },
      { id: "b", name: "B", avatar: 1, joinOrder: 1 },
    ];
    const rows = buildStandings(ps, { a: 500, b: 750 }, { a: 500, b: 0 }, { a: 0, b: 750 });
    expect(rows[0]).toMatchObject({ playerId: "b", rank: 1, previousRank: 2, roundPoints: 750 });
    expect(rows[1]).toMatchObject({ playerId: "a", rank: 2, previousRank: 1 });
  });
});

describe("highlights & awards", () => {
  it("computes Most Mysterious, Mind Reader and Totally Exposed", () => {
    const res = scoreRound(
      responses,
      {
        abby: { r2: "mom", r3: "mom", r4: "dad" },
        owen: { r1: "dad", r3: "mom", r4: "dad" },
        mom: { r1: "dad", r2: "dad", r4: "dad" },
        dad: { r1: "mom", r2: "mom", r3: "mom" },
      },
      players,
    );
    const h = roundHighlights(res);
    expect(h.find((x) => x.kind === "mostMysterious")!.playerIds).toEqual(["abby", "owen"]);
    expect(h.find((x) => x.kind === "mindReader")!.playerIds).toEqual(["abby", "owen"]);
    expect(h.find((x) => x.kind === "totallyExposed")!.playerIds).toEqual(["mom", "dad"]);
  });

  it("produces a champion award for tied winners", () => {
    const mk = (id: string): ServerPlayer => ({
      id, token: "t", name: id, avatar: 0, joinOrder: 0, score: 0, connected: true, lastSeenAt: 0,
      stats: { answers: 0, answerChars: 0, correctGuesses: 0, guessesMade: 0, playersFooled: 0, timesExposed: 0, firstToAnswer: 0 },
    });
    const awards = finalAwards([mk("a"), mk("b"), mk("c")], [], ["a", "b"]);
    expect(awards[0]).toMatchObject({ id: "champion", title: "Co-Champions", playerIds: ["a", "b"] });
  });
});
