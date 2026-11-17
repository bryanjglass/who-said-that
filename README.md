# Who Said That?

A browser-based multiplayer party game for family game night. Everyone secretly answers a silly question on their phone, the answers show up anonymously on the TV, and then everyone guesses who wrote what. You score for spotting your family, and you score for fooling them.

- **Host controller**: a desktop Chrome tab that creates the room and runs the game.
- **TV display**: a second tab you cast to the television. It's a fixed 1920×1080 stage scaled to fit the screen.
- **Player controllers**: phones (iOS Safari or Android Chrome). Players join with a 4-letter code or a QR scan. There are no accounts and nothing to install.

Built with React, TypeScript, Vite, Zustand and Tailwind on the frontend, and Cloudflare Workers with Durable Objects and WebSockets on the backend. Tests use Vitest and Playwright. There's no database, no auth provider and no AI service.

---

## Quick start (local development)

Requires Node 20 or later.

```bash
npm install
```

```bash
npm run dev
```

That starts two things:

| Process | URL | What it does |
| --- | --- | --- |
| `wrangler dev` | http://127.0.0.1:8787 | Worker + Durable Objects, running locally in workerd |
| `vite` | http://localhost:5173 | Frontend. It proxies `/api` (HTTP and WebSocket) to the Worker |

Open http://localhost:5173, click **Create a Room**, then **Open TV Display**. Join from other browser windows, or from phones as described below.

**Playing with real phones locally:** phones can't reach `localhost`. Start the frontend on your LAN instead, and open the host page through your computer's LAN IP so the QR code points somewhere phones can reach:

```bash
npm run dev:worker
```

```bash
npm run dev:web:lan
```

Then browse to `http://<your-LAN-IP>:5173` on the computer. You can also set `VITE_PUBLIC_URL` (see `.env.example`).

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Worker + frontend together |
| `npm run dev:worker` / `npm run dev:web` | Run each one on its own |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run test:e2e` | Playwright end-to-end test. Starts its own Worker on :8788 and Vite on :5174 |
| `npm run typecheck` | TypeScript for the frontend, shared code and Worker |
| `npm run build` | Typecheck, then build the production frontend into `dist/` |
| `npm run deploy:worker` | Deploy the Cloudflare backend |

---

## How to play

1. **Lobby**: the host creates a room. The TV shows a QR code and room code. Each player picks a name (duplicates are rejected, ignoring case) and one of 16 cartoon avatars. The host chooses 5, 7 or 10 rounds, the answer and guess timers, and the question categories. A game needs 3 to 10 connected players, and 4 or more is best.
2. **Prompt**: the question appears on the TV, with a 6-second "get ready" countdown.
3. **Answer**: everyone types a secret answer of up to 140 characters and can edit it until time runs out. The TV only shows *how many* answers are in.
4. **Guess**: the answers appear in shuffled order, labelled A, B, C… Each player assigns an author to every answer except their own, which is marked "Your Answer" on their phone only. The same person can be picked for several answers. Players then **Lock In**.
5. **Big Reveal**: the host steps through each answer. First the TV shows *who was accused* (vote counts only). Then the real author is revealed, correct guessers glow green, people who were fooled fade out, and points fly.
6. **Scoreboard**: standings with rank movement, plus *Most Mysterious*, *Mind Reader* and *Totally Exposed* highlights.
7. **Final results**: the winner (or tied winners) gets confetti and a crown, and there are fun awards. Then the host can start a **Rematch**.

### Scoring (computed only on the server)

- **+500**: you correctly identify the author of someone else's answer.
- **+250 to the author**: for each other player who guessed the wrong person for their answer.
- Missing guesses score nothing for anyone, and nobody can score from their own answer.
- Points are applied exactly once, when guessing closes. Clients only see them as each answer is revealed.

---

## Configuration

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_SERVER_URL` | frontend build | Worker URL, for example `https://who-said-that.you.workers.dev`. WebSocket URLs are derived from it (`https` becomes `wss`). Leave it unset in development. |
| `VITE_BASE` | frontend build | Base path. GitHub Pages project sites need `/<repo>/`. |
| `VITE_PUBLIC_URL` | frontend build | Optional override for the URL inside the join QR code. |
| `ALLOWED_ORIGINS` | `worker/wrangler.toml` `[vars]` | Comma-separated browser origins allowed to create and join rooms. The default `*` is fine for development. In production set it to your Pages origin, for example `https://you.github.io`. |

See `.env.example`. Deployment steps are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## Testing

```bash
npm test
```

That runs 71 Vitest tests covering:

- Pure scoring, ranking, highlights and awards (`tests/unit/scoring.test.ts`)
- Prompt bank validation, random selection, and no repeats even with 40 skips (`tests/unit/prompts.test.ts`)
- The room server driven through fake sockets, storage and alarms (`tests/integration/room.test.ts`). This covers joining, limits, submission, anonymity and leak scans, shuffling, guessing, locking, duplicate, stale and late messages, timers, pause and resume, **simulated Durable Object hibernation**, reconnection, host and TV refresh, unauthorized commands, multiple rooms, ties, and rematches.
- The real Worker router and `GameRoom` Durable Object class against in-memory storage (`tests/integration/worker.test.ts`). This covers room-code collisions and retries, and the origin allow-list.

```bash
npm run test:e2e
```

That's the Playwright end-to-end test (`e2e/full-game.spec.ts`), run against the real `wrangler dev` backend:

- One host controller, plus a TV display opened through the host's **Open TV Display** button.
- Four phones: two emulating iPhone and two emulating Android Chrome.
- All five rounds, including:
  - automatic timer transitions (the prompt countdown, a submission timeout when one player doesn't answer, and a guessing timeout when one player never locks in);
  - partial guesses and an answer edited before the deadline;
  - a mix of correct and incorrect guesses from a deterministic guess plan.
- Exact score assertions after every round, on the host, the TV and every phone. Final totals are hand-checked and ties are ranked correctly.
- The final results, a rematch (same roster, scores reset), and recovery after refreshing a phone, the TV and the host.

---

## Project layout

```
shared/            Code used by both the server and the browser
  constants.ts     Phases, limits, points, room-code alphabet
  protocol.ts      zod-validated WebSocket messages
  views.ts         Client-facing projection types (all that's ever sent to browsers)
  prompts.ts       Question bank loader + validator
  data/prompts.json  120 original prompts (see docs/PROMPTS.md)
  engine/
    engine.ts      Authoritative state machine (pure: time + randomness injected)
    scoring.ts     Scoring, rankings, highlights, awards
    projection.ts  Per-role projections (the secrecy boundary)
    state.ts       Server-only state types
server/roomCore.ts Transport-agnostic room: auth, validation, persistence, alarms, broadcast
worker/            Cloudflare Worker router + GameRoom Durable Object + wrangler.toml
web/               React app (host / TV / player), Zustand store, resilient socket client
tests/             Vitest unit + integration tests
e2e/               Playwright end-to-end test
docs/              Architecture, deployment, prompt format
```

More detail is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), which covers the state machine, protocol, security model, reliability, design decisions and known limitations.
