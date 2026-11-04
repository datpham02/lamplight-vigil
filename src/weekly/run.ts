// `docs/design.md` §14.5 and §14.8 — the override layer, and what a run is
// played under in each of the two modes.
//
// This is the "config-override surface" §14.9 asks the implementer for. It must
// not change shipped behaviour at the base config: `SHIPPED_RUN_CONFIG` passes
// through untouched, and the existing `npm run sim` output plus
// `CrawlerField.test.ts` are the regression that says so.

import {
  SHIPPED_RUN_CONFIG,
  WEEKLY_MODIFIERS,
  WEEKLY_SEED_NAMESPACE,
  widenedBeamConfig,
  type RunConfig,
  type WeeklyModifier,
  type WeeklyModifierValue,
} from '../config/index';
import { fnv1a32, seededUnitRandom, type RunRandom } from './seed';
import { resolveWeekAt, type ResolvedWeek } from './schedule';

/**
 * §14.5 — apply one resolved cell to a config, returning a new one.
 *
 * A modifier is a single IEEE-754 double multiply of a literal by a literal,
 * which is bit-identical on every platform and in every browser. Two players on
 * the same week are therefore playing the same numbers, whatever `3.2 × 0.94`
 * happens to be.
 *
 * `BEAM_WIDE_ANGLE_DEG` is the one entry other exports are derived from, so the
 * multiply happens **before** the derivation (§14.5). Multiplying the degrees
 * and leaving the radian half-angle behind would make the cone's geometry and
 * its freeze test disagree — a freeze outside the drawn cone, and a pillar 2
 * failure rather than a rounding detail.
 */
export function applyWeeklyModifier(
  base: RunConfig,
  entry: WeeklyModifier,
  value: WeeklyModifierValue,
): RunConfig {
  if (value.kind === 'edge-weights') {
    if (entry.constant !== 'SPAWN_EDGE_WEIGHTS') {
      throw new Error(`"${entry.id}" overrides edge weights but names ${entry.constant}`);
    }
    return { ...base, SPAWN_EDGE_WEIGHTS: value.weights };
  }

  switch (entry.constant) {
    case 'SPAWN_INTERVAL_START':
      return { ...base, SPAWN_INTERVAL_START: base.SPAWN_INTERVAL_START * value.multiplier };
    case 'CRAWLER_SPEED_BASE':
      return { ...base, CRAWLER_SPEED_BASE: base.CRAWLER_SPEED_BASE * value.multiplier };
    case 'BURN_DWELL_TIME':
      return { ...base, BURN_DWELL_TIME: base.BURN_DWELL_TIME * value.multiplier };
    case 'POWER_RECHARGE_RATE':
      return { ...base, POWER_RECHARGE_RATE: base.POWER_RECHARGE_RATE * value.multiplier };
    case 'POWER_DRAIN_RATE':
      return { ...base, POWER_DRAIN_RATE: base.POWER_DRAIN_RATE * value.multiplier };
    case 'BEAM_WIDE_ANGLE_DEG':
      return { ...base, ...widenedBeamConfig(base.BEAM_WIDE_ANGLE_DEG * value.multiplier) };
    case 'SPAWN_EDGE_WEIGHTS':
      throw new Error(`"${entry.id}" names SPAWN_EDGE_WEIGHTS but declares a multiplier`);
  }
}

/** Every key whose value differs between two configs. The subject of W2. */
export function changedRunConfigKeys(base: RunConfig, next: RunConfig): readonly string[] {
  return (Object.keys(base) as (keyof RunConfig)[]).filter((key) => base[key] !== next[key]);
}

/**
 * What `src/enemies` and `src/scenes` need in order to start a run: the numbers
 * to play at, the dice to roll, and the week to name on screen.
 */
export interface RunSetup {
  /** §14.8 — null in Free Play, which resolves no entry and shows no week. */
  readonly week: ResolvedWeek | null;
  readonly config: RunConfig;
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
export function weeklyRun(week: ResolvedWeek, base: RunConfig = SHIPPED_RUN_CONFIG): RunSetup {
  return {
    week,
    config: applyWeeklyModifier(base, week.entry, week.value),
    random: seededUnitRandom(weeklySpawnSeed(week.key)),
  };
}

/**
 * The weekly run for an instant. §14.2: call this **once**, at the transition to
 * PLAYING, and hold the result for the whole run.
 */
export function weeklyRunAt(nowMs: number, base: RunConfig = SHIPPED_RUN_CONFIG): RunSetup {
  return weeklyRun(resolveWeekAt(nowMs), base);
}

/**
 * §14.8 — Free Play. Unseeded, unranked, and carrying no modifier: it runs the
 * shipped `src/config` exactly as committed, never reads the clock for a week
 * key, never resolves an entry, and never submits a score.
 */
export function freePlayRun(random: RunRandom = Math.random): RunSetup {
  return { week: null, config: SHIPPED_RUN_CONFIG, random };
}

/** One cell of the table — one entry at one of its values. */
export interface ModifierCell {
  readonly entry: WeeklyModifier;
  readonly value: WeeklyModifierValue;
  /** `clinging-dark x1.30`, for a sweep line and a failure message. */
  readonly label: string;
  readonly config: RunConfig;
}

/**
 * §14.9 — every cell the table can ever produce, in table order: eight entries,
 * fifteen cells.
 *
 * This is the whole point of §14.1 rule 3 declaring finite value sets rather
 * than ranges. Because the set is finite, CI can enumerate *every week the game
 * will ever generate* and check it before any of them happens.
 */
export function weeklyModifierCells(base: RunConfig = SHIPPED_RUN_CONFIG): readonly ModifierCell[] {
  return WEEKLY_MODIFIERS.flatMap((entry) =>
    entry.values.map((value) => ({
      entry,
      value,
      label: `${entry.id} ${value.id}`,
      config: applyWeeklyModifier(base, entry, value),
    })),
  );
}
