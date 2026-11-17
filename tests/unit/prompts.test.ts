import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../../shared/constants";
import { createGame } from "../../shared/engine/engine";
import { applyAction } from "../../shared/engine/engine";
import { seededRandom } from "../../shared/engine/random";
import { PROMPTS, validatePromptBank } from "../../shared/prompts";
import bank from "../../shared/data/prompts.json";

describe("prompt bank", () => {
  it("has at least 100 valid, unique prompts", () => {
    const { prompts, errors } = validatePromptBank(bank);
    expect(errors).toEqual([]);
    expect(prompts.length).toBeGreaterThanOrEqual(100);
    expect(new Set(prompts.map((p) => p.id)).size).toBe(prompts.length);
  });

  it("covers every category with enough prompts for a 10-round game plus skips", () => {
    for (const c of CATEGORIES) {
      expect(PROMPTS.filter((p) => p.category === c).length).toBeGreaterThanOrEqual(20);
    }
  });

  it("keeps prompts short and family-friendly", () => {
    const banned = /\b(kill|murder|sex|sexy|drunk|beer|wine|drug|gun|blood|die|dead|hate|stupid|damn|hell)\b/i;
    for (const p of PROMPTS) {
      expect(p.text.length).toBeLessThanOrEqual(120);
      expect(p.text).not.toMatch(banned);
      expect(p.text.trim().endsWith("?") || p.text.trim().endsWith(".")).toBe(true);
    }
  });

  it("rejects malformed bank entries", () => {
    const { errors } = validatePromptBank({
      version: 1,
      prompts: [
        { id: "ok-1", category: "silly", text: "What is a fine question?" },
        { id: "ok-1", category: "silly", text: "What is another fine question?" },
        { id: "Bad Id", category: "silly", text: "What is a fine question too?" },
        { id: "x-2", category: "spicy", text: "Unknown category question?" },
        { id: "x-3", category: "family", text: "short" },
      ],
    });
    expect(errors.some((e) => e.includes("duplicate id"))).toBe(true);
    expect(errors.some((e) => e.includes("id must be"))).toBe(true);
    expect(errors.some((e) => e.includes("unknown category"))).toBe(true);
    expect(errors.some((e) => e.includes("10-120"))).toBe(true);
  });
});

describe("prompt selection", () => {
  function playThrough(seed: number, categories = [...CATEGORIES], skips = 0) {
    const state = createGame("BCDF", "h", 0);
    const ctx = { now: 0, random: seededRandom(seed), prompts: PROMPTS };
    state.config.categories = categories;
    state.config.rounds = 10;
    for (const n of ["a", "b", "c"]) {
      applyAction(state, { kind: "guest" }, { type: "join", name: n, avatar: state.players.length }, ctx);
    }
    state.players.forEach((p) => (p.connected = true));
    applyAction(state, { kind: "host" }, { type: "start" }, ctx);
    const seen: string[] = [state.round!.prompt.id];
    for (let i = 0; i < skips; i++) {
      applyAction(state, { kind: "host" }, { type: "skipPrompt", round: 1, promptId: state.round!.prompt.id }, ctx);
      seen.push(state.round!.prompt.id);
    }
    // Simulate remaining rounds by drawing prompts as the engine would on each new round.
    for (let r = 2; r <= 10; r++) {
      state.phase = "scoreboard";
      applyAction(state, { kind: "host" }, { type: "advance", from: { phase: "scoreboard", round: r - 1 } }, ctx);
      seen.push(state.round!.prompt.id);
    }
    return seen;
  }

  it("never repeats a prompt within a game, even with many skips", () => {
    const seen = playThrough(7, [...CATEGORIES], 40);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("only uses selected categories", () => {
    const seen = playThrough(3, ["family"]);
    const byId = new Map(PROMPTS.map((p) => [p.id, p]));
    expect(seen.every((id) => byId.get(id)!.category === "family")).toBe(true);
  });

  it("selects prompts randomly (different seeds → different orders)", () => {
    expect(playThrough(1)).not.toEqual(playThrough(2));
  });
});
