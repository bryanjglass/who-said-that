import { useEffect, useState } from "react";
import type { TimerView } from "../../../shared/views";
import { useGame } from "../store/gameStore";

/** Remaining ms for a server timer, ticking locally, corrected by the server clock offset. */
export function useCountdown(timer: TimerView | null | undefined): { remainingMs: number; fraction: number; paused: boolean } {
  const offset = useGame((s) => s.clockOffset);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timer || timer.paused) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [timer]);
  if (!timer) return { remainingMs: 0, fraction: 0, paused: false };
  const remainingMs = timer.paused || timer.deadline === null
    ? timer.remainingMs
    : Math.max(0, timer.deadline - (now + offset));
  return {
    remainingMs,
    fraction: timer.durationMs > 0 ? Math.min(1, remainingMs / timer.durationMs) : 0,
    paused: timer.paused,
  };
}
