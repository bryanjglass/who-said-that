import type { TimerView } from "../../../shared/views";
import { useCountdown } from "../lib/useCountdown";

function colorFor(fraction: number, secs: number) {
  if (secs <= 5) return "#FF5A5F";
  if (fraction < 0.33) return "#FF9F1C";
  return "#3DDC84";
}

/** Big circular countdown (TV). */
export function TimerRing({ timer, size = 180, testId }: { timer: TimerView | null; size?: number; testId?: string }) {
  const { remainingMs, fraction, paused } = useCountdown(timer);
  if (!timer) return null;
  const secs = Math.ceil(remainingMs / 1000);
  const r = 44;
  const c = 2 * Math.PI * r;
  const color = colorFor(fraction, secs);
  return (
    <div className="relative" style={{ width: size, height: size }} data-testid={testId} aria-label={`${secs} seconds left`}>
      <svg viewBox="0 0 100 100" width={size} height={size} className="-rotate-90">
        <circle cx="50" cy="50" r={r} fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.12)" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - fraction)}
          style={{ transition: "stroke-dashoffset 0.25s linear, stroke 0.3s" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center font-display font-bold leading-none">
        <span style={{ fontSize: size * 0.36, color: secs <= 5 && !paused ? "#FF5A5F" : undefined }} className={secs <= 5 && !paused ? "motion-safe:animate-pulse" : ""}>
          {paused ? "❚❚" : secs}
        </span>
        {paused && <span className="mt-1 text-[0.9em] uppercase tracking-widest text-pop-yellow" style={{ fontSize: size * 0.1 }}>Paused</span>}
      </div>
    </div>
  );
}

/** Slim countdown bar (phones + host). */
export function TimerBar({ timer, className = "" }: { timer: TimerView | null; className?: string }) {
  const { remainingMs, fraction, paused } = useCountdown(timer);
  if (!timer) return null;
  const secs = Math.ceil(remainingMs / 1000);
  return (
    <div className={`flex items-center gap-3 ${className}`} data-testid="timer-bar">
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full"
          style={{ width: `${fraction * 100}%`, background: colorFor(fraction, secs), transition: "width 0.25s linear" }}
        />
      </div>
      <span className="min-w-[3.5rem] text-right font-display text-xl font-bold tabular-nums" data-testid="timer-seconds">
        {paused ? "⏸" : `${secs}s`}
      </span>
    </div>
  );
}
