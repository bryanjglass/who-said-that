/**
 * Runtime configuration.
 *
 *  VITE_SERVER_URL  Base URL of the Cloudflare Worker (e.g. https://who-said-that.you.workers.dev).
 *                   Leave unset in development: the Vite dev server proxies /api.
 *  VITE_PUBLIC_URL  Optional public URL of the frontend, used for the join QR
 *                   code (useful when the host opened the app via localhost).
 */
const trim = (s: string | undefined) => (s ?? "").trim().replace(/\/+$/, "");

export const SERVER_URL = trim(import.meta.env.VITE_SERVER_URL) || window.location.origin;
export const WS_URL = SERVER_URL.replace(/^http/, "ws");

export function publicAppUrl(): string {
  const configured = trim(import.meta.env.VITE_PUBLIC_URL);
  if (configured) return configured;
  return `${window.location.origin}${window.location.pathname}`.replace(/\/+$/, "").replace(/\/index\.html$/, "");
}

export function joinUrl(code: string): string {
  return `${publicAppUrl()}/#/play/${code}`;
}

/** Short, human-friendly host + path shown under the QR code. */
export function displayJoinHost(): string {
  return publicAppUrl().replace(/^https?:\/\//, "");
}
