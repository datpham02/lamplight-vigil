// `docs/design.md` §14.8 — what a run is played under, in each of the two modes.
//
// The override layer itself is not here. `src/config/weeklyModifiers.ts` owns
// how a cell is applied to a config and `src/config/tuning.ts` owns the config
// it is applied to, both landed by OV-3 so that `npm run sim -- --modifiers`
// could sweep the table. This module is the other consumer of exactly that
// surface: it resolves *this* week, applies *that* cell, and hands the result to
// `src/enemies` with the dice to roll it. One override layer, two callers.
//
// It must not change shipped behaviour at the base config: `BASE_TUNING` passes
// through untouched for Free Play, and the existing `npm run sim` output plus
// `CrawlerField.test.ts` are the regression that says so.

import { WEEKLY_SEED_NAMESPACE } from '../config/index';
import { BASE_TUNING, type TuningConfig } from '../config/tuning';
import { applyWeeklyModifier } from '../config/weeklyModifiers';
import { fnv1a32, seededUnitRandom, type RunRandom } from './seed';
import { resolveWeekAt, type ResolvedWeek } from './schedule';

/**
 * What `src/enemies` and `src/scenes` need in order to start a run: the numbers
 * to play at, the dice to roll, and the week to name on screen.
 */
export interface RunSetup {
  /** §14.8 — null in Free Play, which resolves no entry and shows no week. */
  readonly week: ResolvedWeek | null;
  readonly config: TuningConfig;
  readonly random: RunRandom;
}

/**
 * The seed the week's spawn sequence is drawn from.
 *
 * Follows §14.3's convention — the namespace, then `|`-joined fields — and is
 * keyed on the week key alone, which is what makes `docs/vision.md` §5b.3 B5
 * true: two clients starting a weekly run in the same week produce the identical
 * crawler pattern. The schedule version in `WEEKLY_SEED_NAMESPACE` reshuffles
 * this with everything else.
 */
export function weeklySpawnSeed(key: string): number {
  return fnv1a32(`${WEEKLY_SEED_NAMESPACE}|${key}|spawn`);
}

/** The weekly run for an already-resolved week. */
export function weeklyRun(week: ResolvedWeek, base: TuningConfig = BASE_TUNING): RunSetup {
  return {
    week,
    config: applyWeeklyModifier(base, week.entry, week.valueIndex),
    random: seededUnitRandom(weeklySpawnSeed(week.key)),
  };
}

/**
 * The weekly run for an instant. §14.2: call this **once**, at the transition to
 * PLAYING, and hold the result for the whole run. The clock is read by the
 * caller and passed in, so nothing below this line can read it a second time and
 * disagree with the week already on screen.
 */
export function weeklyRunAt(nowMs: number, base: TuningConfig = BASE_TUNING): RunSetup {
  return weeklyRun(resolveWeekAt(nowMs), base);
}

/**
 * §14.8 — Free Play. Unseeded, unranked, and carrying no modifier: it runs the
 * shipped `src/config` exactly as committed, never reads the clock for a week
 * key, never resolves an entry, and never submits a score.
 */
export function freePlayRun(random: RunRandom = Math.random): RunSetup {
  return { week: null, config: BASE_TUNING, random };
}
