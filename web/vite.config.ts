import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, "");
  return {
    root,
    envDir: projectRoot,
    // GitHub Pages serves project sites from /<repo>/ — set VITE_BASE accordingly.
    base: env.VITE_BASE || "/",
    plugins: [react()],
    css: { postcss: root },
    build: {
      outDir: fileURLToPath(new URL("../dist", import.meta.url)),
      emptyOutDir: true,
      sourcemap: true,
    },
    server: {
      port: Number(env.WEB_PORT || 5173),
      strictPort: true,
      proxy: {
        // Local development: the Vite dev server forwards API + WebSocket
        // traffic to `wrangler dev`, so the app works from one origin (and from
        // phones on your LAN when started with --host).
        "/api": { target: env.DEV_WORKER_URL || "http://127.0.0.1:8787", ws: true, changeOrigin: true },
      },
    },
    preview: { port: 4173 },
  };
});
