/**
 * Client-facing state projections.
 *
 * These are the ONLY shapes the server ever sends to browsers. Each role
 * receives a projection built specifically for it (see engine/projection.ts);
 * secret data — answer authorship, other players' guesses, answer text during
 * submission, unrevealed points — is never placed in these objects before the
 * phase in which it becomes public.
 */
import type { Category, Phase } from "./constants";

export type Role = "host" | "tv" | "player" | "guest";

export interface GameConfig {
  rounds: number;
  submissionSeconds: number;
  guessingSeconds: number;
  categories: Category[];
}

export interface PlayerPublic {
  id: string;
  name: string;
  avatar: number;
  connected: boolean;
  /** Score as currently visible (excludes points whose reveal hasn't happened yet). */
  score: number;
  rank: number;
}

export interface TimerView {
  /** Server epoch ms when the phase ends; null while paused. */
  deadline: number | null;
  /** Remaining ms as of `serverNow`. */
  remainingMs: number;
  durationMs: number;
  paused: boolean;
}

export interface ResponseCard {
  id: string;
  label: string;
  text: string;
}

export interface SuspectTally {
  playerId: string;
  count: number;
}

export interface GuessOutcome {
  guesserId: string;
  guessedId: string;
  correct: boolean;
}

export interface RevealCardView {
  index: number;
  responseId: string;
  label: string;
  text: string;
  /** Who was accused, and how many times. Never says who accused them. */
  suspects: SuspectTally[];
  totalGuesses: number;
  /** --- Only present once the author stage is reached --- */
  authorId: string | null;
  guesses: GuessOutcome[] | null;
  correctGuesserIds: string[] | null;
  fooledIds: string[] | null;
  authorPoints: number | null;
}

export type RevealStage = "suspects" | "author";

export interface RevealView {
  index: number;
  total: number;
  stage: RevealStage;
  current: RevealCardView;
  /** Authors of responses whose author stage has been reached. */
  revealedAuthors: Record<string, string>;
}

export interface StandingRow {
  playerId: string;
  name: string;
  avatar: number;
  score: number;
  rank: number;
  previousRank: number | null;
  roundPoints: number;
}

export type HighlightKind = "mostMysterious" | "mindReader" | "totallyExposed";

export interface Highlight {
  kind: HighlightKind;
  title: string;
  description: string;
  playerIds: string[];
}

export interface RoundSummaryView {
  number: number;
  promptText: string;
  skipped: boolean;
  standings: StandingRow[];
  highlights: Highlight[];
}

export interface Award {
  id: string;
  emoji: string;
  title: string;
  description: string;
  playerIds: string[];
}

export interface FinalView {
  standings: StandingRow[];
  winnerIds: string[];
  awards: Award[];
  roundsPlayed: number;
}

export interface RoundView {
  number: number;
  total: number;
  prompt: { id: string; text: string; category: Category };
  /** Players who have submitted an answer (identity only, never content). */
  submittedIds: string[];
  /** Players who have locked their guesses. */
  lockedIds: string[];
  /** Anonymous, shuffled responses; null until guessing begins. */
  responses: ResponseCard[] | null;
  /** Players who wrote a response this round (the valid guess targets). */
  authorIds: string[] | null;
  reveal: RevealView | null;
  skipped: "not_enough_answers" | null;
}

export interface MyPrivateView {
  id: string;
  name: string;
  avatar: number;
  /** My own answer for the current round (only ever sent to me). */
  answer: string | null;
  myResponseId: string | null;
  /** My guesses: responseId → guessed author playerId. */
  guesses: Record<string, string>;
  locked: boolean;
  /** Points I earned in the current round — only once fully revealed. */
  roundPoints: { guessing: number; deception: number; total: number } | null;
}

export interface HostExtras {
  canStart: boolean;
  startBlockers: string[];
  tvConnections: number;
}

export interface ClientView {
  role: Role;
  roomCode: string;
  version: number;
  serverNow: number;
  gameNumber: number;
  phase: Phase;
  paused: boolean;
  config: GameConfig;
  players: PlayerPublic[];
  hostConnected: boolean;
  round: RoundView | null;
  timer: TimerView | null;
  scoreboard: RoundSummaryView | null;
  final: FinalView | null;
  me: MyPrivateView | null;
  host: HostExtras | null;
}
