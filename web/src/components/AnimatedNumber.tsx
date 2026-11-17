import { animate, useMotionValue, useReducedMotion, useTransform, motion } from "framer-motion";
import { useEffect } from "react";

/** Counts up/down to `value`. Purely cosmetic — the final number is always the server's. */
export function AnimatedNumber({ value, className = "", duration = 1.2 }: { value: number; className?: string; duration?: number }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => Math.round(v).toLocaleString("en-US"));
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration, ease: "easeOut" });
    return () => controls.stop();
  }, [value, reduce, mv, duration]);
  return <motion.span className={`tabular-nums ${className}`}>{text}</motion.span>;
}
