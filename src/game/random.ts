/**
 * A small seeded random source (mulberry32).
 *
 * Math.random cannot be replayed. Anything that has to come out the same twice
 * — a sample game, a self-play run, eventually a recorded round — draws from
 * one of these instead.
 */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh seed for a new round. Recorded with the round, so it can be replayed. */
export function newSeed(): number {
  return (Math.random() * 2 ** 32) >>> 0;
}
