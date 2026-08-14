/**
 * Small deterministic PRNG (mulberry32) so mock data generation is
 * reproducible per job/lead seed instead of relying on Math.random().
 * This keeps fake pipeline runs reviewable/debuggable — the same job id
 * always produces the same fake lead.
 */
export function makeSeededRandom(seedInput: string) {
  let seed = 0;
  for (let i = 0; i < seedInput.length; i++) {
    seed = (seed * 31 + seedInput.charCodeAt(i)) >>> 0;
  }
  if (seed === 0) seed = 0x9e3779b9;

  return function next(): number {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

export function pickWeighted<T>(rng: Rng, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [item, weight] of items) {
    roll -= weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1][0];
}

export function intBetween(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}
