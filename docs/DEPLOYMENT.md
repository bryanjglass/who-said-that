# Deployment

The game deploys as two pieces, and both work on free tiers:

1. **Backend**: a Cloudflare Worker with the `GameRoom` Durable Object. The Durable Object is SQLite-backed, which the Workers Free plan supports.
2. **Frontend**: static files on GitHub Pages.

## 1. Deploy the Cloudflare backend

```bash
npx wrangler login
```

```bash
npm run deploy:worker
```

Wrangler prints the Worker URL, for example `https://who-said-that.<your-subdomain>.workers.dev`. Check it:

```bash
curl https://who-said-that.<your-subdomain>.workers.dev/api/health
```

That should return `{"ok":true}`.

**Lock down origins.** Once you know your Pages origin, edit `worker/wrangler.toml`:

```toml
[vars]
ALLOWED_ORIGINS = "https://<your-user>.github.io"
```

Then redeploy. Several origins are comma-separated, for example to also allow `http://localhost:5173`.

**Optional, from GitHub:** the `Deploy backend to Cloudflare` workflow (`.github/workflows/deploy-worker.yml`, run manually) deploys with the repository secrets `CLOUDFLARE_API_TOKEN` (needs the "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID`.

## 2. Deploy the frontend to GitHub Pages

1. Push the repository to GitHub.
2. Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Go to **Settings → Secrets and variables → Actions → Variables** and add:
   - `VITE_SERVER_URL` = your Worker URL from step 1, with no trailing slash.
   - Optionally `VITE_BASE`. The default is `/<repo-name>/`, which is right for project pages. Use `/` for a user site or a custom domain.
4. Push to `main`, or run **Deploy frontend to GitHub Pages** manually.

The site is published at `https://<your-user>.github.io/<repo>/`. The app uses hash routes (`#/host/ABCD`, `#/tv/ABCD`, `#/play/ABCD`), so no SPA fallback configuration is needed.

### Building manually

```bash
VITE_SERVER_URL=https://who-said-that.<sub>.workers.dev VITE_BASE=/who-said-that/ npm run build
```

Then upload `dist/` to any static host.

## Setting production WebSocket URLs

The frontend derives everything from `VITE_SERVER_URL`:

- HTTP: `${VITE_SERVER_URL}/api/rooms`
- WebSocket: `${VITE_SERVER_URL}` with `http` replaced by `ws`, plus `/api/rooms/<CODE>/ws`. An `https://` Worker therefore becomes `wss://`.

The value is baked in at build time, so changing it means rebuilding the frontend.

## Hosting multiple concurrent game rooms

There's nothing to configure. Each room code maps to its own Durable Object instance (`ROOMS.idFromName(code)`), so rooms are isolated by construction. They have separate state, sockets, timers (alarms) and storage. Cloudflare places and scales objects automatically.

- Room codes are 4 consonants, giving 160,000 combinations. The Worker retries on the rare collision with an active room.
- An abandoned room (no sockets and no activity for 12 hours) deletes its own storage from an alarm.
- Each object handles up to 10 players plus any number of host and TV tabs. The per-room message volume is tiny.

## Casting the TV display

On the computer running the host tab:

1. Click **Open TV Display**. It opens in a new tab or window.
2. In that tab, open the Chrome menu, choose **Cast…**, then **Cast tab**, and pick your TV or Chromecast.
3. Keep the TV tab in its own window if you can. Chrome keeps cast tabs rendering, and the game never depends on animations finishing, so a background TV tab still shows the correct state.

Sound is off by default because browsers block autoplay. Click **🔇 Sound off** on the TV tab once to enable the synthesized sound effects.
