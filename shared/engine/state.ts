/**
 * Authoritative server-side game state. This object lives only inside the
 * Durable Object (and its storage). It is NEVER sent to clients directly —
 * see projection.ts for the per-role views that are.
 */
import type { Category, Phase } from "../constants";
import type { GameConfig, RevealStage } from "../views";

export interface Prompt {
  id: string;
  text: string;
  category: Category;
}

export interface PlayerStats {
  answers: number;
  answerChars: number;
  correctGuesses: number;
  guessesMade: number;
  playersFooled: number;
  timesExposed: number;
  firstToAnswer: number;
}

export interface ServerPlayer {
  id: string;
  /** Secret reconnect credential (only ever sent to this player, once, on join). */
  token: string;
  name: string;
  avatar: number;
  joinOrder: number;
  score: number;
  connected: boolean;
  /** Epoch ms of last connect/disconnect — used for the presence grace period. */
  lastSeenAt: number;
  stats: PlayerStats;
}

export interface Answer {
  text: string;
  submittedAt: number;
  firstSubmittedAt: number;
}

export interface ServerResponse {
  /** Random ID — not derived from the author or the submission order. */
  id: string;
  authorId: string;
  text: string;
}

export interface ResponseResult {
  responseId: string;
  authorId: string;
  guesses: { guesserId: string; guessedId: string; correct: boolean }[];
  correctGuesserIds: string[];
  fooledIds: string[];
  /** Deception points earned by the author for this response. */
  authorPoints: number;
}

export interface PlayerRoundPoints {
  guessing: number;
  deception: number;
  total: number;
}

export interface RoundResults {
  /** In the same (shuffled) order as round.responses. */
  byResponse: ResponseResult[];
  pointsByPlayer: Record<string, PlayerRoundPoints>;
}

export interface ServerRound {
  number: number;
  prompt: Prompt;
  /** playerId → answer. SECRET until guessing begins (and authorship until reveal). */
  answers: Record<string, Answer>;
  submissionOpenedAt: number | null;
  /** Shuffled once when submission closes. */
  responses: ServerResponse[] | null;
  /** guesserId → (responseId → guessed author id). SECRET until reveal. */
  guesses: Record<string, Record<string, string>>;
  locked: string[];
  /** Computed exactly once when guessing closes. */
  results: RoundResults | null;
  scoresBefore: Record<string, number>;
  revealIndex: number;
  revealStage: RevealStage;
  skipped: "not_enough_answers" | null;
}

export interface RoundHistoryEntry {
  number: number;
  promptText: string;
  skipped: boolean;
  results: RoundResults | null;
  firstAnswerBy: string | null;
}

export interface TimerState {
  /** Epoch ms deadline while running; null when paused. */
  deadline: number | null;
  /** Remaining ms captured when paused. */
  pausedRemainingMs: number | null;
  durationMs: number;
}

export interface GameState {
  schemaVersion: 1;
  code: string;
  hostToken: string;
  createdAt: number;
  lastActivity: number;
  /** Monotonic revision counter; bumps on every change. */
  version: number;
  gameNumber: number;
  config: GameConfig;
  phase: Phase;
  players: ServerPlayer[];
  nextJoinOrder: number;
  round: ServerRound | null;
  history: RoundHistoryEntry[];
  /** Remaining prompt ids for this game, in pre-shuffled order. */
  promptQueue: string[];
  /** Prompts used (asked or skipped) in this game — never repeated. */
  usedPromptIds: string[];
  /** Prompts used in previous games in this room (avoided by rematches when possible). */
  previousGamePromptIds: string[];
  timer: TimerState | null;
  /** Host pause: timers are frozen (new phase timers start frozen too). */
  paused: boolean;
  /** Room is shut down; awaiting deletion. */
  closed: boolean;
}
