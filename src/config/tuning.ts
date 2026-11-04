// The config-override surface — `docs/design.md` §14.9, item 1.
//
// The two difficulty curves in `src/enemies/CrawlerField.ts` and the throughput
// model in `tools/throughput-sim.ts` read `src/config` through module-level
// imports, so there is no way to evaluate either at anything but the shipped
// values. A weekly modifier (§14.5) is exactly a request to do that: "what does
// this curve look like at BURN_DWELL_TIME x1.30?". This module is the one answer
// to it.
//
// `BASE_TUNING` is a *view* of `./index`, not a second copy of it. Every field is
// the imported constant under its own name, so there is no number in this file to
// go stale — which is the rule `docs/throughput-sim.md` §2 states and §10 of that
// document explicitly keeps in force for the sweep.
//
// Why the keys are the constants' own SCREAMING_SNAKE names: a modifier names a
// constant (§14.5), and sweep assertion W2 has to prove a cell changed *that
// constant only*. Naming the fields after the constants makes both a type-level
// fact and a one-line key diff instead of a mapping table someone has to maintain.
//
// This is not a place to add a tunable. Every value here is already a row of §10
// and still lives in `./index`; this record only collects the ones the curves, the
// beam and the model read. GAM-44 added `BEAM_FOCUS_ANGLE_DEG` under that rule —
// `src/beam` now derives both §3.2 half-angles from a run's config, so the source
// value for each has to be in the record the run carries.

import {
  BEAM_FOCUS_ANGLE_DEG,
  BEAM_FOCUS_RANGE,
  BEAM_TRANSITION_TIME,
  BEAM_WIDE_ANGLE_DEG,
  BEAM_WIDE_RANGE,
  BURN_DWELL_TIME,
  CRAWLER_RADIUS,
  CRAWLER_SPEED_BASE,
  CRAWLER_SPEED_JITTER,
  CRAWLER_SPEED_MAX,
  CRAWLER_SPEED_RAMP_PER_SECOND,
  LAMP_RADIUS,
  MAX_CRAWLERS,
  POWER_DRAIN_RATE,
  POWER_RECHARGE_RATE,
  RENDER_HEIGHT,
  SCORE_PER_BANISH,
  SCORE_PER_SECOND_SURVIVED,
  SPAWN_EDGES,
  SPAWN_EDGE_WEIGHTS,
  SPAWN_INTERVAL_DECAY_PER_SECOND,
  SPAWN_INTERVAL_MIN,
  SPAWN_INTERVAL_START,
  type SpawnEdge,
} from './index';

/**
 * Every §10 value the §5.4 curves, the §3 beam and the `docs/throughput-sim.md`
 * §3 model read, under the constants' own names.
 *
 * Derived constants are deliberately absent, and that is the whole of §14.5's
 * derived-constant rule: a modifier must be applied *before* a derivation that
 * reads it, never after. So `src/config` derives the §3.2 half-angles **from a
 * record of this shape** (`beamWideHalfAngleRad`, `beamFocusHalfAngleRad` in
 * `./index`) rather than from the shipped constants at module load. Keeping only
 * source values here means a derivation can never disagree with the value it was
 * derived from: there is one of each in this record, and the half-angle is a
 * function of it.
 */
export interface TuningConfig {
  readonly BEAM_FOCUS_ANGLE_DEG: number;
  readonly BEAM_FOCUS_RANGE: number;
  readonly BEAM_TRANSITION_TIME: number;
  readonly BEAM_WIDE_ANGLE_DEG: number;
  readonly BEAM_WIDE_RANGE: number;
  readonly BURN_DWELL_TIME: number;
  readonly CRAWLER_RADIUS: number;
  readonly CRAWLER_SPEED_BASE: number;
  readonly CRAWLER_SPEED_JITTER: number;
  readonly CRAWLER_SPEED_MAX: number;
  readonly CRAWLER_SPEED_RAMP_PER_SECOND: number;
  readonly LAMP_RADIUS: number;
  readonly MAX_CRAWLERS: number;
  readonly POWER_DRAIN_RATE: number;
  readonly POWER_RECHARGE_RATE: number;
  readonly RENDER_HEIGHT: number;
  readonly SCORE_PER_BANISH: number;
  readonly SCORE_PER_SECOND_SURVIVED: number;
  readonly SPAWN_EDGE_WEIGHTS: Readonly<Record<SpawnEdge, number>>;
  readonly SPAWN_INTERVAL_DECAY_PER_SECOND: number;
  readonly SPAWN_INTERVAL_MIN: number;
  readonly SPAWN_INTERVAL_START: number;
}

/** Every key of `TuningConfig`, in a fixed order, for diffing two configs. */
export const TUNING_KEYS: readonly (keyof TuningConfig)[] = [
  'BEAM_FOCUS_ANGLE_DEG',
  'BEAM_FOCUS_RANGE',
  'BEAM_TRANSITION_TIME',
  'BEAM_WIDE_ANGLE_DEG',
  'BEAM_WIDE_RANGE',
  'BURN_DWELL_TIME',
  'CRAWLER_RADIUS',
  'CRAWLER_SPEED_BASE',
  'CRAWLER_SPEED_JITTER',
  'CRAWLER_SPEED_MAX',
  'CRAWLER_SPEED_RAMP_PER_SECOND',
  'LAMP_RADIUS',
  'MAX_CRAWLERS',
  'POWER_DRAIN_RATE',
  'POWER_RECHARGE_RATE',
  'RENDER_HEIGHT',
  'SCORE_PER_BANISH',
  'SCORE_PER_SECOND_SURVIVED',
  'SPAWN_EDGE_WEIGHTS',
  'SPAWN_INTERVAL_DECAY_PER_SECOND',
  'SPAWN_INTERVAL_MIN',
  'SPAWN_INTERVAL_START',
];

/** The shipped config, exactly as `./index` exports it. */
export const BASE_TUNING: TuningConfig = {
  BEAM_FOCUS_ANGLE_DEG,
  BEAM_FOCUS_RANGE,
  BEAM_TRANSITION_TIME,
  BEAM_WIDE_ANGLE_DEG,
  BEAM_WIDE_RANGE,
  BURN_DWELL_TIME,
  CRAWLER_RADIUS,
  CRAWLER_SPEED_BASE,
  CRAWLER_SPEED_JITTER,
  CRAWLER_SPEED_MAX,
  CRAWLER_SPEED_RAMP_PER_SECOND,
  LAMP_RADIUS,
  MAX_CRAWLERS,
  POWER_DRAIN_RATE,
  POWER_RECHARGE_RATE,
  RENDER_HEIGHT,
  SCORE_PER_BANISH,
  SCORE_PER_SECOND_SURVIVED,
  SPAWN_EDGE_WEIGHTS,
  SPAWN_INTERVAL_DECAY_PER_SECOND,
  SPAWN_INTERVAL_MIN,
  SPAWN_INTERVAL_START,
};

/** What `spawnInterval()` reads. §5.4. */
export type SpawnCurveTuning = Pick<
  TuningConfig,
  'SPAWN_INTERVAL_DECAY_PER_SECOND' | 'SPAWN_INTERVAL_MIN' | 'SPAWN_INTERVAL_START'
>;

/** What `rampedSpeed()` reads. §5.4. */
export type SpeedCurveTuning = Pick<
  TuningConfig,
  'CRAWLER_SPEED_BASE' | 'CRAWLER_SPEED_MAX' | 'CRAWLER_SPEED_RAMP_PER_SECOND'
>;

/**
 * What one `src/enemies/Crawler.ts` reads: the §5.2 burn dwell, and nothing else.
 *
 * `BURN_DWELL_TIME` is the `clinging-dark` entry of §14.5, which is why a crawler
 * is handed a run's config rather than importing the constant (GAM-46). The rest
 * of what a crawler reads — `BURN_DECAY_MULTIPLIER`, `FREEZE_FLASH_TIME`, the two
 * radii and the lamp's position — is absent because none of it is in the table:
 * the decay is a multiple of the dwell rather than a duration of its own, the
 * flash is cosmetic, and §14.7 fences the geometry off as never-weekly.
 *
 * A `Pick` rather than the whole record, for the same reason {@link BeamTuning}
 * is one: a crawler reads one number, and the parameter says so.
 */
export type CrawlerTuning = Pick<TuningConfig, 'BURN_DWELL_TIME'>;

/**
 * What `src/beam`'s `BeamModel` reads: the §3.1 transition, the §3.2 cone and the
 * §4.1 power rates. Three of them — `BEAM_WIDE_ANGLE_DEG`, `POWER_DRAIN_RATE` and
 * `POWER_RECHARGE_RATE` — are §14.5 entries, which is why the beam is handed a run's
 * config rather than importing the constants.
 *
 * The rest of §4 is absent because §14.7 puts it there: `POWER_MAX`, `POWER_START`
 * and `POWER_FOCUS_REARM` are what the power meter is drawn against and may never
 * be weekly, so the beam reads those from `./index` directly, as does `src/hud`.
 */
export type BeamTuning = Pick<
  TuningConfig,
  | 'BEAM_FOCUS_ANGLE_DEG'
  | 'BEAM_FOCUS_RANGE'
  | 'BEAM_TRANSITION_TIME'
  | 'BEAM_WIDE_ANGLE_DEG'
  | 'BEAM_WIDE_RANGE'
  | 'POWER_DRAIN_RATE'
  | 'POWER_RECHARGE_RATE'
>;

/**
 * The keys at which two configs differ. `SPAWN_EDGE_WEIGHTS` is compared edge by
 * edge, in the `SPAWN_EDGES` order, so a re-ordered record is not a difference.
 *
 * Exact equality throughout: §14.5 makes a cell a single IEEE-754 multiply of a
 * literal by a literal, so "unchanged" means bit-identical, not close.
 */
export function tuningDifferences(a: TuningConfig, b: TuningConfig): (keyof TuningConfig)[] {
  return TUNING_KEYS.filter((key) => {
    if (key === 'SPAWN_EDGE_WEIGHTS') {
      return SPAWN_EDGES.some((edge) => a.SPAWN_EDGE_WEIGHTS[edge] !== b.SPAWN_EDGE_WEIGHTS[edge]);
    }
    return a[key] !== b[key];
  });
}
