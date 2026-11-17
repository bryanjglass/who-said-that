import { useEffect, useState } from "react";

/** Hash-based routing (GitHub Pages has no SPA fallback). */
export type Route =
  | { name: "home" }
  | { name: "host"; code: string }
  | { name: "tv"; code: string }
  | { name: "play"; code: string };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const code = (parts[1] ?? "").toUpperCase();
  if (parts[0] === "host" && code) return { name: "host", code };
  if (parts[0] === "tv" && code) return { name: "tv", code };
  if (parts[0] === "play" && code) return { name: "play", code };
  return { name: "home" };
}

export function navigate(path: string) {
  window.location.hash = path;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
