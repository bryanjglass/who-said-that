/**
 * Tiny synthesized sound effects (WebAudio, no assets). Entirely optional:
 * the game is fully playable muted, and audio only starts after a click
 * (browser autoplay rules).
 */
let ctx: AudioContext | null = null;
let enabled = false;

export function setSoundEnabled(on: boolean) {
  enabled = on;
  if (on && !ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      ctx = null;
    }
  }
  void ctx?.resume?.();
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.15) {
  if (!ctx) return;
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

export const sfx = {
  tick() {
    if (enabled) tone(880, 0, 0.08, "square", 0.05);
  },
  whoosh() {
    if (!enabled) return;
    [330, 440, 554].forEach((f, i) => tone(f, i * 0.06, 0.25, "triangle", 0.1));
  },
  drumroll() {
    if (!enabled) return;
    for (let i = 0; i < 14; i++) tone(110 + (i % 2) * 10, i * 0.07, 0.06, "square", 0.05);
  },
  reveal() {
    if (!enabled) return;
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.4, "triangle", 0.14));
  },
  join() {
    if (enabled) tone(660, 0, 0.15, "sine", 0.12);
  },
  fanfare() {
    if (!enabled) return;
    [523, 523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.14, 0.35, "sawtooth", 0.07));
  },
};
