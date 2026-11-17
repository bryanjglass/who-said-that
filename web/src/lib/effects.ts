import confetti from "canvas-confetti";

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function burstConfetti(intensity: "small" | "big" = "small") {
  if (prefersReducedMotion()) return;
  const colors = ["#FFD23F", "#FF4F8B", "#2DE1FC", "#3DDC84", "#9B6BFF"];
  if (intensity === "small") {
    confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 }, colors, disableForReducedMotion: true });
    return;
  }
  const end = Date.now() + 2500;
  const frame = () => {
    confetti({ particleCount: 6, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors, disableForReducedMotion: true });
    confetti({ particleCount: 6, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors, disableForReducedMotion: true });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  frame();
}
