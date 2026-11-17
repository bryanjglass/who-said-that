/**
 * Game-wide constants shared by the server (Durable Object) and all clients.
 */

export const PHASES = [
  "lobby",
  "prompt",
  "submission",
  "guessing",
  "reveal",
  "scoreboard",
  "gameOver",
] as const;
export type Phase = (typeof PHASES)[number];

export const CATEGORIES = ["silly", "family", "hypothetical", "wildcard"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  silly: "Silly",
  family: "Family",
  hypothetical: "Hypothetical",
  wildcard: "Wild Card",
};

export const CATEGORY_BLURBS: Record<Category, string> = {
  silly: "Goofy, absurd, and a little bit ridiculous",
  family: "Home life, chores, pets, and family quirks",
  hypothetical: "What would you do if…",
  wildcard: "Anything goes (still family-friendly!)",
};

export const ROUND_OPTIONS = [5, 7, 10] as const;
export const SUBMISSION_TIMER_OPTIONS = [15, 30, 45, 60, 75, 90, 120, 180] as const;
export const GUESSING_TIMER_OPTIONS = [15, 30, 45, 60, 90, 120] as const;

export const LIMITS = {
  minPlayers: 3,
  maxPlayers: 10,
  recommendedPlayers: 4,
  maxAnswerLength: 140,
  minNameLength: 1,
  maxNameLength: 14,
  avatarCount: 16,
  /** "Get ready" prompt reveal before answering opens. */
  promptSeconds: 6,
  minTimerSeconds: 10,
  maxTimerSeconds: 300,
  /**
   * A player who drops off for less than this long is still treated as
   * present when deciding whether "everyone" has answered / locked in, so a
   * phone that briefly sleeps doesn't cause the round to skip them.
   */
  presenceGraceMs: 15_000,
  /** Rooms with no activity for this long are deleted from storage. */
  roomTtlMs: 12 * 60 * 60 * 1000,
  /** Answer cards shown per page on the TV before paginating. */
  tvCardsPerPage: 6,
} as const;

export const POINTS = {
  correctGuess: 500,
  deception: 250,
} as const;

export const DEFAULT_CONFIG = {
  rounds: 5,
  submissionSeconds: 75,
  guessingSeconds: 60,
  categories: [...CATEGORIES] as Category[],
};

/** Room codes use consonants only (no vowels → no accidental words, no I/O/0/1 confusion). */
export const ROOM_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_PATTERN = /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/;

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z]/g, "");
}

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code);
}

export function responseLabel(index: number): string {
  return String.fromCharCode(65 + index);
}
