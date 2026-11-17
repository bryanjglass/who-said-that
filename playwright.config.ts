import { defineConfig } from "@playwright/test";

const WORKER_PORT = 8788;
const WEB_PORT = 5174;

export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: "off",
    browserName: "chromium",
  },
  webServer: [
    {
      command: `npx wrangler dev --config worker/wrangler.toml --port ${WORKER_PORT} --ip 127.0.0.1 --persist-to .wrangler/e2e-state`,
      url: `http://127.0.0.1:${WORKER_PORT}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { WRANGLER_SEND_METRICS: "false" },
      stdout: "ignore",
    },
    {
      command: `npx vite --config web/vite.config.ts --port ${WEB_PORT} --host 127.0.0.1`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: { DEV_WORKER_URL: `http://127.0.0.1:${WORKER_PORT}`, WEB_PORT: String(WEB_PORT) },
    },
  ],
});
