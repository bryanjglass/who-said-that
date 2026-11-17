import { useEffect, useState, type ReactNode } from "react";

/**
 * Renders children on a fixed 1920×1080 canvas, uniformly scaled to fit the
 * window. Layout is therefore identical on every TV / cast target.
 */
export function TvStage({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <div className="fixed inset-0 overflow-hidden bg-ink-900">
      <div
        className="tv-stage absolute left-1/2 top-1/2 overflow-hidden"
        style={{ width: 1920, height: 1080, transform: `translate(-50%, -50%) scale(${scale})`, transformOrigin: "center" }}
      >
        {children}
      </div>
    </div>
  );
}
