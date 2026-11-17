/**
 * Typed WebSocket protocol. Every inbound message is parsed with zod before it
 * reaches the game engine; anything that fails validation is rejected.
 */
import { z } from "zod";
import { CATEGORIES, LIMITS, PHASES } from "./constants";
import type { ClientView, Role } from "./views";

const id = z.string().min(1).max(64);
const roundNo = z.number().int().min(1).max(1000);

export const helloSchema = z.object({
  type: z.literal("hello"),
  role: z.enum(["host", "tv", "player"]),
  /** host token for role=host, player token for role=player (optional → guest). */
  token: z.string().max(128).optional(),
  ref: z.string().max(64).optional(),
});

export const configPatchSchema = z
  .object({
    rounds: z.number().int(),
    submissionSeconds: z.number().int(),
    guessingSeconds: z.number().int(),
    categories: z.array(z.enum(CATEGORIES)).max(CATEGORIES.length),
  })
  .partial();

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join"), name: z.string().max(64), avatar: z.number().int() }),
  z.object({
    type: z.literal("updateProfile"),
    name: z.string().max(64).optional(),
    avatar: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("submitAnswer"),
    round: roundNo,
    text: z.string().max(LIMITS.maxAnswerLength * 4),
  }),
  z.object({
    type: z.literal("setGuess"),
    round: roundNo,
    responseId: id,
    authorId: id.nullable(),
  }),
  z.object({ type: z.literal("lockGuesses"), round: roundNo }),
  z.object({ type: z.literal("configure"), config: configPatchSchema }),
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("resume") }),
  z.object({
    type: z.literal("advance"),
    /** The state the host was looking at; stale/duplicate clicks are rejected. */
    from: z.object({
      phase: z.enum(PHASES),
      round: z.number().int().min(0),
      revealIndex: z.number().int().min(0).optional(),
      revealStage: z.enum(["suspects", "author"]).optional(),
    }),
  }),
  z.object({ type: z.literal("skipPrompt"), round: roundNo, promptId: id }),
  z.object({ type: z.literal("kick"), playerId: id }),
  z.object({ type: z.literal("endGame") }),
  z.object({ type: z.literal("rematch"), toLobby: z.boolean().optional() }),
]);

export type HelloMessage = z.infer<typeof helloSchema>;
export type Action = z.infer<typeof actionSchema>;
export type ActionType = Action["type"];
export type ConfigPatch = z.infer<typeof configPatchSchema>;

export const clientMessageSchema = z.union([
  helloSchema,
  z.object({ type: z.literal("action"), ref: z.string().max(64).optional(), action: actionSchema }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type ErrorCode =
  | "bad_message"
  | "not_authenticated"
  | "unauthorized"
  | "invalid_token"
  | "wrong_phase"
  | "stale"
  | "too_late"
  | "invalid"
  | "name_taken"
  | "room_full"
  | "game_in_progress"
  | "not_enough_players"
  | "already_locked"
  | "not_found";

export type ServerMessage =
  | { type: "welcome"; role: Role; playerId: string | null }
  | { type: "state"; view: ClientView }
  | { type: "joined"; playerId: string; token: string; ref?: string }
  | { type: "ack"; ref: string; action: ActionType }
  | { type: "error"; code: ErrorCode; message: string; ref?: string; action?: ActionType }
  | { type: "kicked" }
  | { type: "roomClosed" };

/** Plain-text keepalive — answered by the Durable Object runtime without waking the room. */
export const PING = "ping";
export const PONG = "pong";
