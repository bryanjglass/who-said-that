# Architecture

## Overview

```
 Phones (player)  ─┐
 Host tab (host)  ─┼── WebSocket ──▶ Worker router ──▶ GameRoom Durable Object (one per room code)
 TV tab (tv)      ─┘     /api/rooms/:code/ws              │
                                                          ├─ RoomCore   auth · validation · persistence · broadcast
                                                          ├─ engine     pure state machine + scoring
                                                          ├─ projection per-role views (secrecy boundary)
                                                          └─ storage    "state" key + alarm (server timer)
```

No Fib Factory framework was present in the repository, so the game was built standalone. The reusable pieces are separate from the game rules:

- `server/roomCore.ts`: rooms, identities, reconnection, broadcast and alarms.
- `web/src/lib/socket.ts`: a client WebSocket with reconnection and keepalive.
- `web/src/components/TvStage.tsx`: a fixed 1920×1080 cast-friendly stage.
- The QR, avatar and timer components.

Another party game would reuse these and swap out `shared/engine`.

## State machine

```
lobby ─start─▶ prompt ─(6s or host)─▶ submission ─(all answered | timer | host)─▶ guessing
                 ▲                         │ fewer than 2 answers                     │ (all locked | timer | host)
                 │                         ▼                                          ▼
                 │                     scoreboard ◀─(after last answer)── reveal (per answer: suspects 5s → author 6s, or host)
                 └──(12s or host)──────────┤
                                           └──(12s or host, after final round)─▶ gameOver ─rematch─▶ prompt | lobby
```

- **Hands-free after Start.** Every in-game phase, including each reveal step and the scoreboard, runs on a server timer, so a game plays to `gameOver` with no host input. The host can still pause/resume, skip ahead with `advance`, skip a prompt, or end the game. `gameOver` waits for the host to start a rematch. The durations live in `LIMITS` in `shared/constants.ts`.

- Every transition happens in `shared/engine/engine.ts`. The engine is pure: time and randomness are passed in through `EngineContext`, which makes it deterministic in tests.
- Actions that aren't valid in the current phase are rejected with a typed error code: `wrong_phase`, `too_late`, `stale`, `already_locked`, `unauthorized`, and so on.
- The host's `advance` carries a `from` snapshot of the phase, round, reveal index and stage. A double-click or a replayed message no longer matches and gets `stale`, so it can never skip ahead twice. `skipPrompt` carries the prompt id for the same reason.
- **Scoring happens once**, when guessing closes, and is guarded by `round.results`. Repeated advances, alarms that fire twice, hibernation and replays have no effect, as the tests show.

## Timers

Timers run on the server. Each timed phase stores an absolute `deadline`, or `pausedRemainingMs` while paused, in Durable Object storage. The object's single storage alarm is set to the earliest of three times:

- the phase deadline;
- the end of a disconnected player's presence grace period;
- the room's expiry.

`tick()` runs on every alarm *and* before every incoming message. So even if an alarm fires late, a submission sent after the deadline is still rejected as `too_late`. Clients render the countdown from `deadline` plus a clock offset they estimate from `serverNow`.

Pausing freezes the remaining time. Players can keep typing while the game is paused, and a phase reached while paused starts with its timer frozen.

## Secrecy: per-role projections

The server never sends its own state to clients. `projection.ts` builds a separate `ClientView` for each role. The rules, each enforced by tests including a scan of every message for response-id/author-id pairs, are:

| Data | When it becomes visible |
| --- | --- |
| Answer text | Never during submission, except your own answer on your own phone. Everyone sees it once guessing starts. |
| Who answered | During submission, as identities and a count only. |
| Authorship | Per answer, only at that answer's **author** stage of the reveal. |
| Other players' guesses | Never before the reveal. At the *suspects* stage only anonymous tallies ("Dad ×2") are sent, never who voted for whom, because the one player missing from the voter list would give the author away. Full guesses are sent at the author stage. |
| Points | Scores shown during the reveal are `scoresBefore` plus only the answers revealed so far. |
| Tokens | Never included in any view. A player's token is sent once, to that player, when they join. |

`authorIds`, the list of valid guess targets, is sorted by join order, not response order, so it reveals nothing. Response ids are random (`r_` plus 10 random characters) and aren't derived from player ids or submission order. The shuffle happens once, with crypto randomness, when submission closes.

The host controller deliberately gets the same secrecy as the TV, because the host is often also a player.

## Protocol and authentication

- Client to server messages: `hello {role, token?}`, then `action {ref, action}`. Every message is parsed with zod. Unknown, oversized or malformed messages get `bad_message`.
- Identity comes from the connection, not from the message. After `hello`, the socket's attachment records `{role, playerId}`. Actions never carry a player id, so a client can't claim to be someone else.
- **The host** is authenticated by a 32-character random `hostToken` returned when the room is created and kept in that browser's localStorage.
- **Players** are authenticated by a 32-character random token issued on join, also in localStorage, keyed by room code. It's used for reconnection.
- **The TV** needs no secret, because its view contains only public information.
- Server to client messages: `welcome`, `state {view}`, `joined {playerId, token}`, `ack {ref}`, `error {code, message, ref}`, `kicked`, `roomClosed`. Phones use `ack` and `error` to show "✓ Saved" and "Answer submitted".
- Keepalive: the client sends the plain text `ping` every 15 seconds. The runtime answers `pong` through `setWebSocketAutoResponse` without waking a hibernated object. If the client hears nothing for 40 seconds, it reconnects.

## Reliability

- **Durable Object hibernation.** The room uses the WebSocket Hibernation API. Sockets survive eviction, and identity lives in `serializeAttachment`. State is written with `storage.put` before any broadcast, because output gates hold messages until the write completes. The constructor reloads state in `blockConcurrencyWhile`.
- **Presence** is worked out from the sockets that are actually open (`reconcilePresence`) on every event. That keeps it correct after hibernation or a restart.
- **Reconnection.** Clients use exponential backoff with jitter, reconnect immediately on `visibilitychange`, `online` or `focus`, and re-send `hello` with the stored token. Refreshing a phone, the TV or the host tab restores the exact current view.
- **Never stuck.** Every in-game phase has a timer, including the reveal steps and the scoreboard, so a game finishes even if nobody touches anything. The host can also end a phase early, skip a prompt, or end the game.
- **Auto-advance** happens when every player is done, or when every *present* player is done and at least one player is present. A player counts as present while connected, or for 15 seconds after disconnecting, so a phone that briefly sleeps isn't skipped.
- **Animations never gate state.** Screens animate in when they mount, but nothing waits for an exit animation, so the DOM always shows the latest server state. An earlier `AnimatePresence` version could leave the TV a step behind, and could freeze in background tabs where requestAnimationFrame is paused. Animations are skippable, because the host can always advance, and the reveal timers are long enough for them to finish, and they respect `prefers-reduced-motion` through `MotionConfig reducedMotion="user"` and the CSS rules.

## Design decisions

These are areas where the spec left room, and what was chosen.

- **Two-stage reveal (suspects, then author)**, each step paced by a server timer (the host can skip ahead). This gives the dramatic pause and keeps authorship off the wire until the moment it's revealed.
- **The Prompt phase is a 6-second "get ready"** that the host can skip.
- **Skipping a prompt** replaces it within the same round: answers are discarded, no points are awarded, and the round number doesn't change.
- **A round with fewer than 2 answers** counts as played. It shows a "round skipped" scoreboard and awards no points, so the game can't loop forever if players are idle.
- **Answer limit:** 140 Unicode code points, so emoji count as one character. Newlines, control characters, zero-width characters and bidi-override characters are stripped, and whitespace is collapsed. Answers are always rendered as React text, never as HTML.
- **Names:** at most 14 characters, NFKC-normalized, compared case-insensitively. **Avatars are unique** within a room, which keeps the TV readable.
- **Guess targets** are players who submitted this round, excluding yourself. Guessing a non-author is rejected, which avoids pointless red herrings. Locking with partial guesses is allowed after an on-phone confirmation.
- **Kicking** (lobby only) lets the host clear out typos or stale seats. A kicked player's token stops working.
- **Rematch** offers either "Rematch" (start immediately with the same roster and settings) or "Change Settings / New Players" (back to the lobby, roster kept). Both reset scores and statistics, and prefer prompts not used in earlier games.
- **End Game** lets the host finish early. A round still in progress is discarded, and points already earned stand.
- **Rooms expire** after 12 hours with no connections and no activity.
- **Highlights and awards** shared by every player are hidden, because a "highlight" everyone shares isn't one.
- **Sound** is synthesized with WebAudio (no assets), off by default, and switched on per TV tab.

## Known limitations

- **Host identity is tied to one browser** through its localStorage token. If the host clears site data, or switches computers, they lose host controls for that room, though the game state survives. You can open the TV, or join as a player, from any device.
- **A player on a different phone or browser can't rejoin a game in progress.** Seats are bound to the browser that joined. A player who loses their seat mid-game can come back at the next rematch-to-lobby.
- **Players can only change their avatar, and only in the lobby.** There's no rename button: to fix a misspelled name, the host removes the player in the lobby and they rejoin.
- **There's no content moderation** of player answers beyond the length and character rules. Only the host can skip a prompt, and there's no way to hide a single answer.
- **There's no rate limiting** on room creation beyond Cloudflare's platform defaults. Add a Cloudflare rate-limiting rule if the Worker is public.
- **Browser coverage:** iOS Safari and Android Chrome are emulated in Playwright (viewport, user agent, touch) on Chromium. A real-device pass on WebKit is recommended.
- **The prompt bank is English only.**
