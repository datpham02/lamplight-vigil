// src/scenes owns the run and its bookkeeping.

import { SCORE_PER_BANISH, SCORE_PER_SECOND_SURVIVED } from '../config/index';

/**
 * docs/design.md §8:
 *
 *     score(t) = floor(t * SCORE_PER_SECOND_SURVIVED) + banished * SCORE_PER_BANISH
 *
 * Score accrues continuously and is displayed floored, so the HUD counts up
 * smoothly rather than ticking once a second. It is recomputed from elapsed time
 * rather than accumulated, so it cannot drift away from the clock.
 *
 * @param elapsedSeconds Run time so far (§2.4) — frame deltas, not wall clock.
 * @param banished Crawlers banished this run.
 */
export function runScore(elapsedSeconds: number, banished: number): number {
  return Math.floor(elapsedSeconds * SCORE_PER_SECOND_SURVIVED) + banished * SCORE_PER_BANISH;
}
