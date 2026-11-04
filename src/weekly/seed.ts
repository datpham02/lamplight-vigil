// src/weekly owns the deterministic half of Online Vigil: the week key, the
// seed, the §14.4 block schedule and the override layer that applies a resolved
// modifier to a run. The table itself is data in `src/config` (§14.1 rule 4).
//
// Nothing here reads a clock, touches storage or makes a request. Every function
// takes its inputs and returns an answer, because `docs/design.md` §14.3 is a
// contract a server written against D4 must be able to reproduce byte for byte —
// and because D4 is still pending, so there is no server to ask.
//
// `docs/design.md` §14.3 is the specification for this file. The two hash
// functions are transcribed from it deliberately literally: an "improvement"
// here is a silent disagreement with every client and every stored score.

/**
 * §14.3 — FNV-1a, 32 bits, over the UTF-8 bytes of `input`.
 *
 * Not `crypto.subtle`: that is asynchronous, and a promise between pressing a
 * key and a run starting would spend part of pillar 3's 1.0 s restart budget.
 * Not a security primitive either, and it does not need to be — nobody gains
 * anything by predicting next week's modifier, and the table is published in
 * `docs/design.md`.
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5; // offset basis
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0; // prime 16777619
  }
  return hash >>> 0;
}

/**
 * §14.3 — mulberry32. Returns a **uint32** per call, not a float in [0, 1):
 * §14.4 takes `next() % n`, and a float there would be a different schedule.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return (t ^ (t >>> 14)) >>> 0; // uint32, not a float
  };
}

/** 2^32 — the divisor that turns a uint32 into a fraction of a whole turn. */
const UINT32_RANGE = 0x1_0000_0000;

/**
 * A random source `src/enemies`' field can rewind.
 *
 * `Math.random` satisfies this structurally with no `rewind`, which is exactly
 * the Free Play path (§14.8): unseeded, and a restart is a different hollow. A
 * seeded source carries `rewind`, so pressing R inside a weekly run replays the
 * week's spawn sequence rather than continuing its stream — `docs/vision.md`
 * §5b.3 B5 wants two clients on one week key to see the same pattern, and a
 * player on their fourth attempt is one of those two clients.
 */
export interface RunRandom {
  (): number;
  /** Rewind to the first draw. Absent on an unseeded source. */
  readonly rewind?: () => void;
}

/**
 * A rewindable, seeded source of floats in [0, 1), for gameplay that wants a
 * fraction rather than the raw word the schedule works in.
 *
 * The division by 2^32 is the only place the two differ, and it is here rather
 * than in `mulberry32` so that §14.4's `next() % n` keeps reading the published
 * generator unchanged.
 */
export function seededUnitRandom(seed: number): RunRandom {
  let next = mulberry32(seed);
  const random: RunRandom = Object.assign(() => next() / UINT32_RANGE, {
    rewind: (): void => {
      next = mulberry32(seed);
    },
  });
  return random;
}
