/** Randomness helpers. The engine never calls Math.random directly — a source is injected. */
export type RandomSource = () => number;

const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export function randomId(random: RandomSource, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)];
  return out;
}

export function randomString(random: RandomSource, alphabet: string, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}

/** Fisher–Yates shuffle returning a new array. */
export function shuffle<T>(items: readonly T[], random: RandomSource): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Cryptographically secure source (Workers and modern browsers/Node expose WebCrypto). */
export const cryptoRandom: RandomSource = () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! / 0x1_0000_0000;
};

/** Deterministic PRNG for tests (mulberry32). */
export function seededRandom(seed: number): RandomSource {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
