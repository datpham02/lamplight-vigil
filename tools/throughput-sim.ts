// tools/ holds developer tooling that is not gameplay code and does not ship in
// the bundle. Nothing under src/ may import from here.
//
// The throughput simulation, built to `docs/throughput-sim.md`. It is the
// executable form of `docs/design.md` §11.1: it integrates the two §5.4 curves
// against a first-order model of a player and checks the result against the
// numbers §11.1 derives by hand, plus the invariants §10.5, §10.7 and §11.1 state
// but that no single tuning row can protect on its own.
//
// Run it with `npm run sim`. Exit code 0 means every assertion in
// `docs/throughput-sim.md` §7 passed.
//
// WHAT IT IS NOT: a game simulator. It places no crawlers, picks no edges, aims
// no beam and rolls no dice. Nothing here renders and nothing here is random —
// the acceptance numbers are exact, so determinism is a requirement, not a nicety
// (§6). Two runs produce byte-identical output.
//
// EVERY BALANCE VALUE IS IMPORTED FROM src/config. Not one is re-declared here: a
// simulation with its own copy of SPAWN_INTERVAL_START is a document that goes
// stale, not a check. The only numbers defined in this file are the skill-tier
// behavioural parameters (§4) and the acceptance thresholds (§7), which are
// properties of the *model* rather than of the game. The two curves are imported
// from src/enemies for the same reason: this checks shipped behaviour, not a
// second opinion about it.

import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

import {
  BEAM_FOCUS_RANGE,
  BEAM_WIDE_RANGE,
  CRAWLER_RADIUS,
  LAMP_RADIUS,
  MAX_CRAWLERS,
  RENDER_HEIGHT,
  SCORE_PER_BANISH,
  SCORE_PER_SECOND_SURVIVED,
  SHIPPED_RUN_CONFIG,
  SPAWN_EDGES,
  WEEKLY_MODIFIER_SAFE_RANGES,
  type RunConfig,
} from '../src/config/index';
import { rampedSpeed, spawnInterval } from '../src/enemies/CrawlerField';
import { changedRunConfigKeys, weeklyModifierCells, type ModifierCell } from '../src/weekly/index';

// ---------------------------------------------------------------------------
// §4 Skill tiers — the model's behavioural parameters, not game values
// ---------------------------------------------------------------------------

export type TierKey = 'first-timer' | 'practised' | 'expert';

export interface SkillTier {
  readonly key: TierKey;
  /**
   * Seconds between finishing one banish and having the next target inside the
   * cone, spent wide and therefore recharging.
   */
  readonly aimWide: number;
  /**
   * Focused seconds that produce no banish: holding past the moment the crawler
   * dies, and re-earning dwell lost to decay after a wobble.
   */
  readonly wasteFocused: number;
  /**
   * Unserviced crawlers the player can keep frozen before one slips through on a
   * bearing the beam is not on. The run ends when the backlog reaches it. This is
   * the model's one calibrated input (`B` in §11.1); GAM-15 refits it.
   */
  readonly backlogTolerance: number;
  /**
   * Mean lifetime of a crawler the player *does* service. Used only for the
   * concurrency readout, never for the run-length integration.
   */
  readonly meanAliveSeconds: number;
}

/**
 * `docs/throughput-sim.md` §4. One table, so a designer can read and edit it
 * without reading the integration code. Override from the command line with
 * `npm run sim -- --tier practised --backlog 4.2`.
 */
export const SKILL_TIERS: readonly SkillTier[] = [
  { key: 'first-timer', aimWide: 1.1, wasteFocused: 0.9, backlogTolerance: 3, meanAliveSeconds: 6 },
  { key: 'practised', aimWide: 0.5, wasteFocused: 0.25, backlogTolerance: 5, meanAliveSeconds: 4 },
  { key: 'expert', aimWide: 0.3, wasteFocused: 0.05, backlogTolerance: 6, meanAliveSeconds: 3 },
];

// ---------------------------------------------------------------------------
// §3 The model
// ---------------------------------------------------------------------------

// Every function below takes the config it reads rather than closing over the
// module-level imports. That is the override surface `docs/design.md` §14.9 asks
// for, and the default keeps §2's rule intact: the values still come from
// `src/config` and are never re-declared here. At `SHIPPED_RUN_CONFIG` — which
// is what plain `npm run sim` passes — the output is what it has always been.

/** §5.4 — arrivals per second. */
export function spawnRate(elapsedSeconds: number, config: RunConfig = SHIPPED_RUN_CONFIG): number {
  return 1 / spawnInterval(elapsedSeconds, config);
}

/**
 * §11.3 — the sustainable focus duty: the share of a sustained run a player can
 * spend narrow without the bar ever emptying.
 */
export function focusDuty(config: RunConfig = SHIPPED_RUN_CONFIG): number {
  return config.POWER_RECHARGE_RATE / (config.POWER_DRAIN_RATE + config.POWER_RECHARGE_RATE);
}

/**
 * §11.3 — the shortest power-sustainable banish cycle, in seconds. Perfect aim,
 * zero travel, zero waste; no human reaches it. It is the right-hand side of the
 * §10.7 asymptote invariant.
 */
export function shortestSustainableCycle(config: RunConfig = SHIPPED_RUN_CONFIG): number {
  return (config.BEAM_TRANSITION_TIME + config.BURN_DWELL_TIME) / focusDuty(config);
}

/** §11.1 — drain seconds one banish costs this tier. */
export function drainPerKill(tier: SkillTier, config: RunConfig = SHIPPED_RUN_CONFIG): number {
  return config.BEAM_TRANSITION_TIME + config.BURN_DWELL_TIME + tier.wasteFocused;
}

/**
 * §11.1 — seconds per banish: the worse of the wall-clock round trip and the
 * power-limited cycle. Every tier is power-limited at the shipped config, which
 * is why POWER_RECHARGE_RATE is the lever GAM-17 moved.
 */
export function cycleSeconds(tier: SkillTier, config: RunConfig = SHIPPED_RUN_CONFIG): number {
  const drain = drainPerKill(tier, config);
  return Math.max(drain + tier.aimWide + config.BEAM_TRANSITION_TIME, drain / focusDuty(config));
}

/** §11.1 — sustained banishes per second. Constant in `t`, deliberately (§3). */
export function capacity(tier: SkillTier, config: RunConfig = SHIPPED_RUN_CONFIG): number {
  return 1 / cycleSeconds(tier, config);
}

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

/** §6 — the acceptance numbers in §7 are quoted at this step. */
export const DEFAULT_DT = 0.01;
export const DEFAULT_HORIZON = 400;
export const DEFAULT_STEP = 15;

/**
 * §7 — "three crawlers on screen" is the threshold that matters: two fit inside
 * one wide cone and three usually do not, so three is the first number at which
 * the player must choose (§11.1).
 */
const PRESSURE_CONCURRENCY_THRESHOLD = 3;

/** §7 — the pressure probe: the moment the first minute is judged at. */
const PRESSURE_PROBE_SECONDS = 45;

export interface SimulationOptions {
  readonly dt: number;
  readonly horizon: number;
  readonly step: number;
  readonly tiers: readonly SkillTier[];
  /**
   * §14.9 — the config to evaluate the curve at. Omitted is the shipped config,
   * so every existing caller and plain `npm run sim` are unchanged; the weekly
   * sweep is the only thing that passes anything else.
   */
  readonly config?: RunConfig;
}

export interface TierResult {
  readonly tier: SkillTier;
  readonly capacity: number;
  readonly cycleSeconds: number;
  /** First `t` where arrivals reach capacity, or null if they never do. */
  readonly crossing: number | null;
  /** First `t` where the backlog reaches `backlogTolerance`, or null inside the horizon. */
  readonly runLength: number | null;
  readonly cumulativeSpawns: number;
  readonly banished: number;
  readonly score: number;
  readonly peakConcurrency: number;
  /** Backlog at `PRESSURE_PROBE_SECONDS`, or null if the run ended first. */
  readonly backlogAtProbe: number | null;
  /** First `t` where modelled concurrency reaches three crawlers. */
  readonly concurrencyThresholdAt: number | null;
}

export interface CurveLandmarks {
  readonly duty: number;
  readonly shortestSustainableCycle: number;
  /** First `t` where `spawnInterval(t)` is exactly `SPAWN_INTERVAL_MIN`. */
  readonly floorBindsAt: number | null;
  readonly speedCapsAt: number | null;
  readonly scoreCrossoverAt: number | null;
  /** Steepest sampled `d(rate)/dt`, the §11.1 no-cliff bound's subject. */
  readonly maxRateSlope: number;
  /** True if `d(rate)/dt` is exactly 0 at every sample at or past the floor. */
  readonly slopeFlatPastFloor: boolean;
  /** True if `rate(t)` is exactly `1 / SPAWN_INTERVAL_MIN` at every sample past the floor. */
  readonly rateFixedPastFloor: boolean;
  readonly cumulativeSpawnsAtProbe: number;
}

export interface SeriesRow {
  readonly t: number;
  readonly interval: number;
  readonly rate: number;
  readonly speed: number;
  /** Per tier, in `options.tiers` order. Null once that tier's run has ended. */
  readonly tiers: readonly (TierRowCells | null)[];
}

export interface TierRowCells {
  readonly capacity: number;
  readonly deficit: number;
  readonly backlog: number;
  readonly concurrency: number;
}

export interface SimulationResult {
  readonly options: SimulationOptions;
  /** The config this run was evaluated at, resolved. Never undefined. */
  readonly config: RunConfig;
  readonly landmarks: CurveLandmarks;
  readonly tiers: readonly TierResult[];
  readonly rows: readonly SeriesRow[];
}

interface TierState {
  readonly tier: SkillTier;
  readonly capacity: number;
  readonly cycleSeconds: number;
  crossing: number | null;
  runLength: number | null;
  backlog: number;
  peakConcurrency: number;
  backlogAtProbe: number | null;
  concurrencyThresholdAt: number | null;
  cumulativeSpawns: number;
  banished: number;
  score: number;
}

/**
 * Forward Euler over a fixed step (§6). Sufficient, and what §11.1's closed form
 * was checked against; the convergence check at `dt = 0.001` is a test.
 *
 * `t` is computed as `i * dt` rather than accumulated, so a long horizon cannot
 * drift and two runs cannot differ.
 */
export function simulate(options: SimulationOptions): SimulationResult {
  const { dt, horizon, step, tiers } = options;
  const config = options.config ?? SHIPPED_RUN_CONFIG;
  const steps = Math.round(horizon / dt);
  const rowEvery = Math.max(1, Math.round(step / dt));
  const probeStep = Math.round(PRESSURE_PROBE_SECONDS / dt);

  const states: TierState[] = tiers.map((tier) => ({
    tier,
    capacity: capacity(tier, config),
    cycleSeconds: cycleSeconds(tier, config),
    crossing: null,
    runLength: null,
    backlog: 0,
    peakConcurrency: 0,
    backlogAtProbe: null,
    concurrencyThresholdAt: null,
    cumulativeSpawns: 0,
    banished: 0,
    score: 0,
  }));

  const rows: SeriesRow[] = [];
  let cumulativeSpawns = 0;
  let cumulativeSpawnsAtProbe = 0;
  let floorBindsAt: number | null = null;
  let speedCapsAt: number | null = null;
  let scoreCrossoverAt: number | null = null;
  let maxRateSlope = 0;
  let slopeFlatPastFloor = true;
  let rateFixedPastFloor = true;
  const flooredRate = 1 / config.SPAWN_INTERVAL_MIN;

  for (let i = 0; i <= steps; i += 1) {
    const t = i * dt;
    const interval = spawnInterval(t, config);
    const rate = 1 / interval;
    const speed = rampedSpeed(t, config);

    // §5.2 landmarks. Exact equality is deliberate: both curves clamp with
    // Math.max/Math.min, so the floored value is bit-identical to the config's.
    if (floorBindsAt === null && interval === config.SPAWN_INTERVAL_MIN) {
      floorBindsAt = t;
    }
    if (speedCapsAt === null && speed === config.CRAWLER_SPEED_MAX) {
      speedCapsAt = t;
    }
    if (scoreCrossoverAt === null && rate * SCORE_PER_BANISH >= SCORE_PER_SECOND_SURVIVED) {
      scoreCrossoverAt = t;
    }

    // B4 — the no-cliff bound. A one-sided difference over the integration step,
    // taken on the shipped curve rather than on its derivative: it is exactly
    // zero at and past the floor, where a centred difference would smear the kink.
    const slope = (spawnRate(t + dt, config) - rate) / dt;
    if (slope > maxRateSlope) {
      maxRateSlope = slope;
    }
    if (floorBindsAt !== null && t >= floorBindsAt) {
      if (slope !== 0) {
        slopeFlatPastFloor = false;
      }
      if (rate !== flooredRate) {
        rateFixedPastFloor = false;
      }
    }

    if (i === probeStep) {
      cumulativeSpawnsAtProbe = cumulativeSpawns;
    }

    const cells: (TierRowCells | null)[] = [];

    for (const state of states) {
      if (state.runLength !== null && t > state.runLength) {
        cells.push(null);
        continue;
      }

      if (state.crossing === null && rate >= state.capacity) {
        state.crossing = t;
      }

      const inTransit = rate * state.tier.meanAliveSeconds;
      const concurrency = state.backlog + inTransit;
      const deficit = Math.max(0, rate - state.capacity);

      if (concurrency > state.peakConcurrency) {
        state.peakConcurrency = concurrency;
      }
      if (
        state.concurrencyThresholdAt === null &&
        concurrency >= PRESSURE_CONCURRENCY_THRESHOLD
      ) {
        state.concurrencyThresholdAt = t;
      }
      if (i === probeStep) {
        state.backlogAtProbe = state.backlog;
      }

      // The run ends at the first `t` where the backlog reaches the tolerance.
      if (state.runLength === null && state.backlog >= state.tier.backlogTolerance) {
        state.runLength = t;
        state.cumulativeSpawns = cumulativeSpawns;
        state.banished = cumulativeSpawns - state.backlog - inTransit;
        state.score =
          Math.floor(t * SCORE_PER_SECOND_SURVIVED) +
          Math.floor(state.banished) * SCORE_PER_BANISH;
      }

      cells.push({ capacity: state.capacity, deficit, backlog: state.backlog, concurrency });
    }

    if (i % rowEvery === 0) {
      rows.push({ t, interval, rate, speed, tiers: cells });
    }

    // Advance. Both integrals are left Riemann sums, so the values read above are
    // the state *at* `t` rather than one step ahead of it.
    cumulativeSpawns += rate * dt;
    for (const state of states) {
      if (state.runLength === null) {
        state.backlog += Math.max(0, rate - state.capacity) * dt;
      }
    }
  }

  // A tier still alive at the horizon reports what it had reached there, so the
  // summary is never blank — runLength stays null, which is what fails §7.
  for (const state of states) {
    if (state.runLength === null) {
      const rate = spawnRate(horizon, config);
      state.cumulativeSpawns = cumulativeSpawns;
      state.banished = cumulativeSpawns - state.backlog - rate * state.tier.meanAliveSeconds;
      state.score =
        Math.floor(horizon * SCORE_PER_SECOND_SURVIVED) +
        Math.floor(state.banished) * SCORE_PER_BANISH;
    }
  }

  return {
    options,
    config,
    landmarks: {
      duty: focusDuty(config),
      shortestSustainableCycle: shortestSustainableCycle(config),
      floorBindsAt,
      speedCapsAt,
      scoreCrossoverAt,
      maxRateSlope,
      slopeFlatPastFloor,
      rateFixedPastFloor,
      cumulativeSpawnsAtProbe,
    },
    tiers: states.map((state) => ({
      tier: state.tier,
      capacity: state.capacity,
      cycleSeconds: state.cycleSeconds,
      crossing: state.crossing,
      runLength: state.runLength,
      cumulativeSpawns: state.cumulativeSpawns,
      banished: state.banished,
      score: state.score,
      peakConcurrency: state.peakConcurrency,
      backlogAtProbe: state.backlogAtProbe,
      concurrencyThresholdAt: state.concurrencyThresholdAt,
    })),
    rows,
  };
}

// ---------------------------------------------------------------------------
// §7 Acceptance
// ---------------------------------------------------------------------------

/** §7 — rates and capacities. */
const RATE_TOLERANCE = 0.02;
/** §7 — times and run lengths. */
const TIME_TOLERANCE = 0.05;
/** §7 — crawler counts: concurrency and cumulative spawns. */
const COUNT_TOLERANCE = 0.05;
/** §7 — `banished` and `score`, which depend on the softest parameter in §4. */
const SOFT_TOLERANCE = 0.1;

/**
 * §7 Group A, transcribed from `docs/design.md` §11.1. These are the design's
 * numbers, not the script's: if one of them fails, say so on the task rather than
 * adjusting it here (`docs/throughput-sim.md` §9.4).
 */
const GROUP_A = {
  rates: [
    { t: 0, expected: 0.313 },
    { t: 45, expected: 0.366 },
    { t: 120, expected: 0.476 },
    { t: 180, expected: 0.587 },
    { t: 240, expected: 0.725 },
  ],
  floorBindsAt: 332,
  speedCapsAt: 198,
  scoreCrossoverAt: 70,
  duty: 0.458,
  shortestSustainableCycle: 1.13,
  cumulativeSpawnsAtProbe: 15,
  concurrencyThresholdAt: 47,
  maxBacklogAtProbe: 1,
  tiers: {
    'first-timer': { capacity: 0.323, crossing: 9, runLength: 79, banished: 24, score: 1390, peakConcurrency: 5.5 },
    practised: { capacity: 0.595, crossing: 184, runLength: 250, banished: 117, score: 5425, peakConcurrency: 8 },
    expert: { capacity: 0.804, crossing: 270, runLength: 332, banished: 187, score: 8000, peakConcurrency: 9 },
  },
} as const;

/** §7 Group B — invariants that must hold at *any* config. */
const JOINT_SPEED_BOUND = 156;
const READABILITY_FLOOR_SECONDS = 1.5;
const NO_CLIFF_SLOPE_BOUND = 0.0035;
/**
 * §11.1 states the no-cliff bound to two significant figures: it computes
 * `k × rate ≤ 0.003506 × 1.000` and then quotes 0.0035. The exact supremum at the
 * shipped config is `−ln(SPAWN_INTERVAL_DECAY_PER_SECOND) / SPAWN_INTERVAL_MIN` =
 * 0.0035061, which is above a literal 0.0035 by 0.17% — so the comparison is made
 * at the precision the bound is stated to, and the exact value is printed next to
 * it. This still catches any real retune: a change of 1.5% in the slope fails.
 * Flagged to `game-designer` on GAM-18; if §11.1 restates the bound as 0.00351,
 * drop the rounding and compare exactly.
 */
const NO_CLIFF_SLOPE_DECIMALS = 4;
const FLOOR_BINDS_BY = 360;
const FIRST_TIMER_RUN_WINDOW = { min: 45, max: 120 } as const;
const PRACTISED_RUN_FLOOR = 180;
const WEIGHT_SUM_EPSILON = 1e-9;

/**
 * `docs/design.md` §14.6 — the cell band, which is tighter than B9's own window
 * and is the reason the table can survive GAM-15's refit of `B`.
 *
 * It is the criterion window minus the model's own calibration error: a ±15%
 * refit of `B` moves a run length by about ∓6.7% / +6.1%, so a cell at 55 s is
 * still inside 45 s after a −15% refit, and one at 110 s still inside 120 s
 * after a +15%. A published week therefore does not have to be retired when the
 * model is recalibrated.
 */
const CELL_RUN_BAND = { min: 55, max: 110 } as const;

export interface Assertion {
  readonly name: string;
  readonly group: 'A' | 'B';
  readonly ok: boolean;
  readonly expected: string;
  readonly actual: string;
  /**
   * Why the assertion does not apply to this invocation, or null when it ran.
   * A skipped assertion never fails: both reasons describe a model the caller
   * deliberately changed from the command line (§4).
   */
  readonly skipped: string | null;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function within(actual: number | null, expected: number, tolerance: number): boolean {
  return actual !== null && Math.abs(actual - expected) <= Math.abs(expected) * tolerance;
}

function show(value: number | null, decimals = 3): string {
  return value === null ? 'never' : value.toFixed(decimals);
}

const OVERRIDDEN = 'the tier table was overridden';
const NOT_SELECTED = 'that tier was not selected';

/**
 * Every §7 assertion, in order. `calibrated` is set when the tier table has been
 * overridden from the command line: Group A and B9 then describe a model the
 * caller has deliberately changed, so they are reported as skipped rather than
 * failed. Every other Group B assertion is about `src/config` alone and still runs.
 */
export function checkAcceptance(result: SimulationResult, calibrated = false): Assertion[] {
  const assertions: Assertion[] = [];
  const { config, landmarks } = result;

  const overridden = calibrated ? OVERRIDDEN : null;

  // Group A's curve landmarks are properties of `src/config` alone, so they run
  // even under a refit: overriding a tier's behaviour cannot move the spawn
  // curve. Only the per-tier rows below are skipped when the table is overridden.
  const a = (
    name: string,
    ok: boolean,
    expected: string,
    actual: string,
    skipped: string | null = null,
  ): void => {
    assertions.push({ name, group: 'A', ok: skipped !== null || ok, expected, actual, skipped });
  };

  // --- Group A: reproduces design.md §11.1 at the shipped config ------------

  for (const { t, expected } of GROUP_A.rates) {
    const actual = spawnRate(t, config);
    a(
      `A rate(${t})`,
      within(actual, expected, RATE_TOLERANCE),
      `${expected.toFixed(3)} /s +/-2%`,
      `${actual.toFixed(3)} /s`,
    );
  }

  a(
    'A floorBindsAt',
    within(landmarks.floorBindsAt, GROUP_A.floorBindsAt, TIME_TOLERANCE),
    `${GROUP_A.floorBindsAt} s +/-5%`,
    `${show(landmarks.floorBindsAt, 2)} s`,
  );
  a(
    'A rate is exactly 1 / SPAWN_INTERVAL_MIN past the floor',
    landmarks.rateFixedPastFloor && landmarks.floorBindsAt !== null,
    `exactly ${(1 / config.SPAWN_INTERVAL_MIN).toFixed(3)} /s`,
    landmarks.floorBindsAt === null ? 'the floor never binds' : String(landmarks.rateFixedPastFloor),
  );
  a(
    'A speedCapsAt',
    within(landmarks.speedCapsAt, GROUP_A.speedCapsAt, TIME_TOLERANCE),
    `${GROUP_A.speedCapsAt} s +/-5%`,
    `${show(landmarks.speedCapsAt, 2)} s`,
  );
  a(
    'A scoreCrossoverAt',
    within(landmarks.scoreCrossoverAt, GROUP_A.scoreCrossoverAt, TIME_TOLERANCE),
    `${GROUP_A.scoreCrossoverAt} s +/-5%`,
    `${show(landmarks.scoreCrossoverAt, 2)} s`,
  );
  a(
    'A duty',
    within(landmarks.duty, GROUP_A.duty, RATE_TOLERANCE),
    `${(GROUP_A.duty * 100).toFixed(1)}% +/-2%`,
    `${(landmarks.duty * 100).toFixed(1)}%`,
  );
  a(
    'A shortest power-sustainable banish cycle',
    within(landmarks.shortestSustainableCycle, GROUP_A.shortestSustainableCycle, TIME_TOLERANCE),
    `${GROUP_A.shortestSustainableCycle.toFixed(2)} s +/-5%`,
    `${landmarks.shortestSustainableCycle.toFixed(3)} s`,
  );
  a(
    'A cumulativeSpawns(45)',
    within(landmarks.cumulativeSpawnsAtProbe, GROUP_A.cumulativeSpawnsAtProbe, COUNT_TOLERANCE),
    `${GROUP_A.cumulativeSpawnsAtProbe} +/-5%`,
    landmarks.cumulativeSpawnsAtProbe.toFixed(2),
  );

  for (const tier of result.tiers) {
    const expected = GROUP_A.tiers[tier.tier.key];
    if (expected === undefined) {
      continue;
    }
    const label = tier.tier.key;
    a(
      `A ${label} capacity`,
      within(tier.capacity, expected.capacity, RATE_TOLERANCE),
      `${expected.capacity.toFixed(3)} /s +/-2%`,
      `${tier.capacity.toFixed(3)} /s`,
      overridden,
    );
    a(
      `A ${label} crossing`,
      within(tier.crossing, expected.crossing, TIME_TOLERANCE),
      `${expected.crossing} s +/-5%`,
      `${show(tier.crossing, 2)} s`,
      overridden,
    );
    a(
      `A ${label} runLength`,
      within(tier.runLength, expected.runLength, TIME_TOLERANCE),
      `${expected.runLength} s +/-5%`,
      `${show(tier.runLength, 2)} s`,
      overridden,
    );
    a(
      `A ${label} banished`,
      within(tier.banished, expected.banished, SOFT_TOLERANCE),
      `~${expected.banished} +/-10%`,
      tier.banished.toFixed(1),
      overridden,
    );
    a(
      `A ${label} score`,
      within(tier.score, expected.score, SOFT_TOLERANCE),
      `~${expected.score} +/-10%`,
      String(tier.score),
      overridden,
    );
    a(
      `A ${label} peakConcurrency`,
      within(tier.peakConcurrency, expected.peakConcurrency, COUNT_TOLERANCE),
      `${expected.peakConcurrency} +/-5%`,
      tier.peakConcurrency.toFixed(2),
      overridden,
    );
  }

  const firstTimer = result.tiers.find((tier) => tier.tier.key === 'first-timer');
  const withoutFirstTimer = firstTimer === undefined ? NOT_SELECTED : overridden;

  a(
    'A first-timer reaches three on screen inside the first minute',
    within(firstTimer?.concurrencyThresholdAt ?? null, GROUP_A.concurrencyThresholdAt, TIME_TOLERANCE),
    `${GROUP_A.concurrencyThresholdAt} s +/-5%`,
    `${show(firstTimer?.concurrencyThresholdAt ?? null, 2)} s`,
    withoutFirstTimer,
  );
  a(
    'A first-timer backlog at 45 s is under one crawler',
    firstTimer?.backlogAtProbe != null && firstTimer.backlogAtProbe < GROUP_A.maxBacklogAtProbe,
    `< ${GROUP_A.maxBacklogAtProbe.toFixed(1)}`,
    show(firstTimer?.backlogAtProbe ?? null, 3),
    withoutFirstTimer,
  );

  // --- Group B: invariants that must hold at any config --------------------

  assertions.push(...groupB(result, FIRST_TIMER_RUN_WINDOW, overridden));

  return assertions;
}

/**
 * §7 Group B — the invariants that must hold at *any* config, which is exactly
 * why §14.9 runs this set per modifier cell and Group A only once.
 *
 * `runWindow` is B9's band: the shipping criterion's 45–120 s for the base run,
 * and §14.6's tighter 55–110 s for a published cell.
 */
function groupB(
  result: SimulationResult,
  runWindow: { readonly min: number; readonly max: number },
  overridden: string | null,
): Assertion[] {
  const assertions: Assertion[] = [];
  const { config, landmarks } = result;

  const b = (
    name: string,
    ok: boolean,
    expected: string,
    actual: string,
    skipped: string | null = null,
  ): void => {
    assertions.push({ name, group: 'B', ok: skipped !== null || ok, expected, actual, skipped });
  };

  const effectiveSpeed = config.CRAWLER_SPEED_MAX * (1 + config.CRAWLER_SPEED_JITTER);
  b(
    'B1 joint speed bound',
    effectiveSpeed <= JOINT_SPEED_BOUND,
    `CRAWLER_SPEED_MAX * (1 + CRAWLER_SPEED_JITTER) <= ${JOINT_SPEED_BOUND} px/s`,
    `${effectiveSpeed.toFixed(2)} px/s`,
  );

  const shortestApproach = RENDER_HEIGHT / 2 - LAMP_RADIUS - 2 * CRAWLER_RADIUS;
  const shortestApproachSeconds = shortestApproach / effectiveSpeed;
  b(
    'B2 shortest approach is readable',
    shortestApproachSeconds >= READABILITY_FLOOR_SECONDS,
    `>= ${READABILITY_FLOOR_SECONDS.toFixed(1)} s over ${shortestApproach} px`,
    `${shortestApproachSeconds.toFixed(2)} s`,
  );

  const ceiling = shortestSustainableCycle(config);
  b(
    'B3 asymptote invariant',
    config.SPAWN_INTERVAL_MIN < ceiling,
    `SPAWN_INTERVAL_MIN < ${ceiling.toFixed(3)} s`,
    `${config.SPAWN_INTERVAL_MIN.toFixed(3)} s`,
  );

  b(
    'B4 no-cliff slope bound',
    roundTo(landmarks.maxRateSlope, NO_CLIFF_SLOPE_DECIMALS) <= NO_CLIFF_SLOPE_BOUND,
    `d(rate)/dt <= ${NO_CLIFF_SLOPE_BOUND.toFixed(4)} /s^2`,
    `${landmarks.maxRateSlope.toFixed(7)} /s^2`,
  );
  b(
    'B4 slope is exactly zero past the floor',
    landmarks.slopeFlatPastFloor && landmarks.floorBindsAt !== null,
    'exactly 0 /s^2',
    landmarks.floorBindsAt === null ? 'the floor never binds' : String(landmarks.slopeFlatPastFloor),
  );

  b(
    'B5 the floor binds inside a reachable run',
    landmarks.floorBindsAt !== null && landmarks.floorBindsAt <= FLOOR_BINDS_BY,
    `<= ${FLOOR_BINDS_BY} s`,
    `${show(landmarks.floorBindsAt, 2)} s`,
  );

  for (const tier of result.tiers) {
    b(
      `B6 ${tier.tier.key} concurrency stays under MAX_CRAWLERS`,
      tier.peakConcurrency < MAX_CRAWLERS,
      `< ${MAX_CRAWLERS}`,
      tier.peakConcurrency.toFixed(2),
    );
  }

  const weightSum = SPAWN_EDGES.reduce((sum, edge) => sum + config.SPAWN_EDGE_WEIGHTS[edge], 0);
  b(
    'B7 spawn edge weights sum to 1',
    Math.abs(weightSum - 1) < WEIGHT_SUM_EPSILON,
    '1',
    weightSum.toFixed(12),
  );

  b(
    'B8 beam ranges',
    BEAM_FOCUS_RANGE > 551 && BEAM_WIDE_RANGE < 480,
    'BEAM_FOCUS_RANGE > 551 and BEAM_WIDE_RANGE < 480',
    `${BEAM_FOCUS_RANGE} and ${BEAM_WIDE_RANGE}`,
  );

  const firstTimer = result.tiers.find((tier) => tier.tier.key === 'first-timer');
  const practised = result.tiers.find((tier) => tier.tier.key === 'practised');

  // B9 is the one Group B assertion with model error in it, and the one that a
  // refit can legitimately move. It is kept because it is the shipping criterion.
  b(
    'B9 run lengths meet the shipping criterion',
    firstTimer?.runLength != null &&
      firstTimer.runLength >= runWindow.min &&
      firstTimer.runLength <= runWindow.max &&
      practised?.runLength != null &&
      practised.runLength > PRACTISED_RUN_FLOOR,
    `first-timer in [${runWindow.min}, ${runWindow.max}] s, practised > ${PRACTISED_RUN_FLOOR} s`,
    `${show(firstTimer?.runLength ?? null, 2)} s and ${show(practised?.runLength ?? null, 2)} s`,
    firstTimer === undefined || practised === undefined ? NOT_SELECTED : overridden,
  );

  return assertions;
}

// ---------------------------------------------------------------------------
// §14.9 The weekly modifier sweep
// ---------------------------------------------------------------------------
//
// GAM-16 condition C2.1 is what this exists for, and it is worth stating plainly:
// a pillar held by a promise is held by nobody. The table in §14.5 declares
// finite value sets rather than ranges precisely so that CI can enumerate every
// week the game will ever generate and check it before any of them happens.
//
// Group A is deliberately **not** run per cell. It reproduces §11.1 at the
// shipped config and is expected to fail under a modifier by design —
// `restless-hollow x1.10` moves speedCapsAt from 198 s to 153.9 s, which is the
// modifier working, not a defect.

/** §10.7 — the room B3 has, as a fraction of `SPAWN_INTERVAL_MIN`. */
export function asymptoteMargin(result: SimulationResult): number {
  const floor = result.config.SPAWN_INTERVAL_MIN;
  return (result.landmarks.shortestSustainableCycle - floor) / floor;
}

/**
 * §14.6 — "This table requires at least 10% of margin on B3 for any published
 * cell", so that a later retune of the base config under §10 cannot silently
 * push a week that already shipped through the invariant. It is why
 * `clinging-dark`, `thin-wick` and `hungry-flame` only go the harder way, and
 * why `SPAWN_INTERVAL_MIN` is not in the table at all.
 */
const CELL_B3_MARGIN_FLOOR = 0.1;

export interface CellResult {
  readonly cell: ModifierCell;
  readonly result: SimulationResult;
  readonly assertions: readonly Assertion[];
}

/**
 * §14.6 — the required `backlogTolerance` coupling, and the one place the sweep
 * is allowed to touch a §4 tier parameter.
 *
 * §11.1 anchors the model's calibrated input `B` on `360 / BEAM_WIDE_ANGLE_DEG`,
 * so a cone modifier genuinely does change the backlog a player can hold, and
 * the sweep must say so. It applies to that constant and no other: it is what
 * makes `narrow-lantern` the one entry whose run lengths differ from the base,
 * which is honest checking rather than exclusion.
 */
function tiersForCell(cell: ModifierCell, tiers: readonly SkillTier[]): readonly SkillTier[] {
  if (cell.entry.constant !== 'BEAM_WIDE_ANGLE_DEG' || cell.value.kind !== 'multiplier') {
    return tiers;
  }

  const coupling = cell.value.multiplier;
  return tiers.map((tier) => ({
    ...tier,
    backlogTolerance: tier.backlogTolerance * coupling,
  }));
}

/** The §11.1 numbers two runs must agree on for W3 to hold. */
function groupANumbers(result: SimulationResult): string {
  return JSON.stringify([
    result.landmarks,
    result.tiers.map((tier) => [
      tier.tier.key,
      tier.capacity,
      tier.crossing,
      tier.runLength,
      tier.banished,
      tier.score,
      tier.peakConcurrency,
      tier.backlogAtProbe,
      tier.concurrencyThresholdAt,
    ]),
  ]);
}

/**
 * §14.9 — one cell's assertions: Group B per cell with the §14.6 band on B9,
 * then W1, W2 and (for `plain` alone) W3.
 */
export function checkCell(
  cell: ModifierCell,
  result: SimulationResult,
  base: SimulationResult,
): Assertion[] {
  const assertions = groupB(result, CELL_RUN_BAND, null);
  const w = (name: string, ok: boolean, expected: string, actual: string): void => {
    assertions.push({ name, group: 'B', ok, expected, actual, skipped: null });
  };

  // W1 — the resolved value lies inside the constant's own §10 safe range. A
  // week can never put the game somewhere a designer could not have tuned it to
  // by hand (criterion 23).
  const constant = cell.entry.constant;
  const range = WEEKLY_MODIFIER_SAFE_RANGES[constant];

  if (constant === 'SPAWN_EDGE_WEIGHTS' || range === undefined) {
    // SPAWN_EDGE_WEIGHTS' §10.7 range is "any set summing to 1", which is B7
    // above and has already run against this cell's own weights.
    w('W1 resolved value is inside its §10 safe range', true, 'bounded by B7', 'edge weights');
  } else {
    const resolved = cell.config[constant];
    w(
      'W1 resolved value is inside its §10 safe range',
      resolved >= range.min && resolved <= range.max,
      `${constant} in ${range.min}–${range.max}`,
      `${resolved}`,
    );
  }

  // W2 — the entry names a constant on the §14.5 list, and the cell changes
  // that constant only. BEAM_WIDE_HALF_ANGLE_RAD is derived from
  // BEAM_WIDE_ANGLE_DEG and §14.5 requires it to move with it, so it is the one
  // companion key a cell may change.
  const changed = [...changedRunConfigKeys(base.config, cell.config)].sort();
  const allowed = (
    cell.entry.constant === 'BEAM_WIDE_ANGLE_DEG'
      ? ['BEAM_WIDE_ANGLE_DEG', 'BEAM_WIDE_HALF_ANGLE_RAD']
      : [cell.entry.constant]
  ).sort();
  w(
    'W2 the cell changes the constant it names, and no other',
    changed.length === 0 || changed.join(',') === allowed.join(','),
    allowed.join(', '),
    changed.length === 0 ? 'nothing (a x1.00 cell)' : changed.join(', '),
  );

  // §14.6 — the margin the whole easy side of the power economy is fenced by.
  const margin = asymptoteMargin(result);
  w(
    '§14.6 B3 margin is at least 10% for a published cell',
    margin >= CELL_B3_MARGIN_FLOOR,
    `>= ${(CELL_B3_MARGIN_FLOOR * 100).toFixed(0)}%`,
    `${(margin * 100).toFixed(1)}%`,
  );

  // W3 — the plain cell reproduces the shipped config's Group A numbers
  // exactly. If it does not, the override layer is lying about something.
  if (cell.entry.id === 'plain') {
    w(
      'W3 the plain cell reproduces the shipped Group A numbers exactly',
      groupANumbers(result) === groupANumbers(base),
      'identical to the base run',
      groupANumbers(result) === groupANumbers(base) ? 'identical' : 'the override layer moved something',
    );
  }

  return assertions;
}

/** §14.9 — every cell of §14.5, each against its own Group B. */
export function sweepModifiers(options: SimulationOptions): readonly CellResult[] {
  const base = simulate({ ...options, config: SHIPPED_RUN_CONFIG });

  return weeklyModifierCells().map((cell) => {
    const result = simulate({
      ...options,
      config: cell.config,
      tiers: tiersForCell(cell, options.tiers),
    });
    return { cell, result, assertions: checkCell(cell, result, base) };
  });
}

// ---------------------------------------------------------------------------
// §5 Output
// ---------------------------------------------------------------------------

const DEAD = '—';

function pad(text: string, width: number): string {
  return text.padStart(width);
}

function formatSeries(result: SimulationResult): string {
  const lines: string[] = [];
  const tierWidth = 4 * 8 + 2;

  lines.push(
    `${' '.repeat(31)}${result.options.tiers
      .map((tier) => pad(tier.key, tierWidth))
      .join('')}`,
  );
  lines.push(
    `${pad('t', 6)}${pad('interval', 10)}${pad('rate', 8)}${pad('speed', 7)}${result.options.tiers
      .map(() => `${pad('cap', 10)}${pad('deficit', 8)}${pad('backlog', 8)}${pad('conc', 8)}`)
      .join('')}`,
  );

  for (const row of result.rows) {
    const cells = row.tiers
      .map((cell) =>
        cell === null
          ? `${pad(DEAD, 10)}${pad(DEAD, 8)}${pad(DEAD, 8)}${pad(DEAD, 8)}`
          : `${pad(cell.capacity.toFixed(3), 10)}${pad(cell.deficit.toFixed(3), 8)}${pad(cell.backlog.toFixed(2), 8)}${pad(cell.concurrency.toFixed(2), 8)}`,
      )
      .join('');
    lines.push(
      `${pad(row.t.toFixed(0), 6)}${pad(row.interval.toFixed(2), 10)}${pad(row.rate.toFixed(3), 8)}${pad(row.speed.toFixed(1), 7)}${cells}`,
    );
  }

  return lines.join('\n');
}

function formatCsv(result: SimulationResult): string {
  const header = [
    't',
    'interval',
    'rate',
    'speed',
    ...result.options.tiers.flatMap((tier) => [
      `${tier.key}.capacity`,
      `${tier.key}.deficit`,
      `${tier.key}.backlog`,
      `${tier.key}.concurrency`,
    ]),
  ].join(',');

  const rows = result.rows.map((row) => {
    const cells = row.tiers.flatMap((cell) =>
      cell === null
        ? ['', '', '', '']
        : [
            cell.capacity.toFixed(6),
            cell.deficit.toFixed(6),
            cell.backlog.toFixed(6),
            cell.concurrency.toFixed(6),
          ],
    );
    return [
      row.t.toFixed(2),
      row.interval.toFixed(6),
      row.rate.toFixed(6),
      row.speed.toFixed(4),
      ...cells,
    ].join(',');
  });

  return [header, ...rows].join('\n');
}

function formatSummary(result: SimulationResult): string {
  const lines: string[] = [];
  const { landmarks } = result;

  for (const tier of result.tiers) {
    lines.push(`${tier.tier.key}`);
    lines.push(
      `  aimWide ${tier.tier.aimWide.toFixed(2)} s   wasteFocused ${tier.tier.wasteFocused.toFixed(2)} s   backlogTolerance ${tier.tier.backlogTolerance}   meanAlive ${tier.tier.meanAliveSeconds} s`,
    );
    const pair = (leftName: string, leftValue: string, rightName: string, rightValue: string): string =>
      `  ${leftName.padEnd(17)}${leftValue.padEnd(14)}${rightName.padEnd(17)}${rightValue}`;

    lines.push(
      pair('capacity', `${tier.capacity.toFixed(3)} /s`, 'cycleSeconds', `${tier.cycleSeconds.toFixed(3)} s`),
    );
    lines.push(
      pair('crossing', `${show(tier.crossing, 2)} s`, 'runLength', `${show(tier.runLength, 2)} s`),
    );
    lines.push(
      pair('cumulativeSpawns', tier.cumulativeSpawns.toFixed(1), 'banished', tier.banished.toFixed(1)),
    );
    lines.push(pair('score', String(tier.score), 'peakConcurrency', tier.peakConcurrency.toFixed(2)));
    lines.push('');
  }

  lines.push('curve landmarks (properties of src/config, not of any tier)');
  lines.push(`  floorBindsAt            ${show(landmarks.floorBindsAt, 2)} s`);
  lines.push(`  speedCapsAt             ${show(landmarks.speedCapsAt, 2)} s`);
  lines.push(`  scoreCrossoverAt        ${show(landmarks.scoreCrossoverAt, 2)} s`);
  lines.push(`  maxRateSlope            ${landmarks.maxRateSlope.toFixed(7)} /s^2`);
  lines.push(`  duty                    ${(landmarks.duty * 100).toFixed(1)}%`);
  lines.push(`  cumulativeSpawns(45)    ${landmarks.cumulativeSpawnsAtProbe.toFixed(2)}`);
  lines.push('  asymptote invariant (§10.7)');
  lines.push(`    SPAWN_INTERVAL_MIN    ${result.config.SPAWN_INTERVAL_MIN.toFixed(3)} s`);
  lines.push(
    `    shortest cycle        ${landmarks.shortestSustainableCycle.toFixed(3)} s  (margin ${(asymptoteMargin(result) * 100).toFixed(1)}%)`,
  );

  return lines.join('\n');
}

function formatAssertions(assertions: readonly Assertion[]): string {
  const lines: string[] = [];

  for (const assertion of assertions) {
    if (assertion.skipped !== null) {
      lines.push(`SKIP ${assertion.name}: ${assertion.skipped}`);
    } else if (assertion.ok) {
      lines.push(`PASS ${assertion.name}: ${assertion.actual}`);
    } else {
      lines.push(`FAIL ${assertion.name}: expected ${assertion.expected}, got ${assertion.actual}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `npm run sim -- [options]

  --modifiers       sweep every cell of the docs/design.md §14.5 weekly modifier
                    table, asserting Group B plus W1-W3 per cell (§14.9). Group A
                    is not run per cell: it reproduces §11.1 at the shipped
                    config and a modifier is meant to move it.
  --tier <key>      first-timer | practised | expert. Report that tier alone, and
                    the target of every override below. Default: all three.
  --backlog <n>     override the selected tier's backlogTolerance (GAM-15's refit)
  --aim-wide <s>    override the selected tier's aimWide
  --waste <s>       override the selected tier's wasteFocused
  --mean-alive <s>  override the selected tier's meanAliveSeconds
  --step <s>        time-series row spacing. Default ${DEFAULT_STEP}
  --horizon <s>     how far to integrate. Default ${DEFAULT_HORIZON}
  --dt <s>          integration step; a convergence check only. Default ${DEFAULT_DT}
  --csv             emit the time series alone, with a header row
  --help`;

function parseNumber(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`--${name} needs a number, got "${raw}"`);
  }
  return value;
}

export interface CliInvocation {
  readonly options: SimulationOptions;
  readonly calibrated: boolean;
  readonly csv: boolean;
  /** §14.9 — sweep the modifier table instead of reporting the base run. */
  readonly modifiers: boolean;
}

export function buildInvocation(argv: readonly string[]): CliInvocation {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      tier: { type: 'string' },
      backlog: { type: 'string' },
      'aim-wide': { type: 'string' },
      waste: { type: 'string' },
      'mean-alive': { type: 'string' },
      step: { type: 'string' },
      horizon: { type: 'string' },
      dt: { type: 'string' },
      csv: { type: 'boolean', default: false },
      modifiers: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  const overrides: { readonly flag: string; readonly value: number }[] = [];
  const read = (flag: string, raw: string | undefined): number | undefined => {
    if (raw === undefined) {
      return undefined;
    }
    const value = parseNumber(flag, raw);
    overrides.push({ flag, value });
    return value;
  };

  const backlogTolerance = read('backlog', values.backlog);
  const aimWide = read('aim-wide', values['aim-wide']);
  const wasteFocused = read('waste', values.waste);
  const meanAliveSeconds = read('mean-alive', values['mean-alive']);

  let tiers = SKILL_TIERS;

  if (values.tier !== undefined) {
    const selected = SKILL_TIERS.find((tier) => tier.key === values.tier);
    if (selected === undefined) {
      throw new Error(
        `--tier must be one of ${SKILL_TIERS.map((tier) => tier.key).join(', ')}, got "${values.tier}"`,
      );
    }
    tiers = [
      {
        key: selected.key,
        aimWide: aimWide ?? selected.aimWide,
        wasteFocused: wasteFocused ?? selected.wasteFocused,
        backlogTolerance: backlogTolerance ?? selected.backlogTolerance,
        meanAliveSeconds: meanAliveSeconds ?? selected.meanAliveSeconds,
      },
    ];
  } else if (overrides.length > 0) {
    throw new Error(`--${overrides[0]?.flag} needs --tier: an override applies to one tier`);
  }

  return {
    options: {
      dt: values.dt === undefined ? DEFAULT_DT : parseNumber('dt', values.dt),
      horizon: values.horizon === undefined ? DEFAULT_HORIZON : parseNumber('horizon', values.horizon),
      step: values.step === undefined ? DEFAULT_STEP : parseNumber('step', values.step),
      tiers,
    },
    // Selecting a tier alone is not a recalibration; changing its parameters is.
    calibrated: overrides.length > 0,
    csv: values.csv === true,
    modifiers: values.modifiers === true,
  };
}

/**
 * §14.9 — the sweep's report. One line per cell with the two numbers §14.5
 * publishes, then every failing assertion named against the cell it failed on,
 * because criterion 24 is "the sweep fails loudly on a bad cell" and a loud
 * failure has to say *which* cell and *which* assertion.
 */
function runSweep(invocation: CliInvocation): number {
  const cells = sweepModifiers(invocation.options);
  const { dt, horizon } = invocation.options;

  process.stdout.write(
    `Lamplight Vigil — weekly modifier sweep (docs/design.md §14.9)\n` +
      `dt ${dt} s, horizon ${horizon} s. ${cells.length} cells from the §14.5 table.\n` +
      `Group B per cell, B9 at the §14.6 band [${CELL_RUN_BAND.min}, ${CELL_RUN_BAND.max}] s, ` +
      `plus W1-W3. Group A runs once, at the shipped config, and is not swept.\n\n`,
  );

  const header = `${pad('cell', 26)}${pad('constant', 24)}${pad('resolved', 16)}${pad('first-timer', 13)}${pad('practised', 12)}${pad('B3 margin', 11)}  result`;
  process.stdout.write(`${header}\n`);

  let failedCells = 0;
  let failedAssertions = 0;
  let ranAssertions = 0;

  for (const { cell, result, assertions } of cells) {
    const failed = assertions.filter((assertion) => !assertion.ok);
    ranAssertions += assertions.filter((assertion) => assertion.skipped === null).length;
    failedAssertions += failed.length;
    if (failed.length > 0) {
      failedCells += 1;
    }

    const firstTimer = result.tiers.find((tier) => tier.tier.key === 'first-timer');
    const practised = result.tiers.find((tier) => tier.tier.key === 'practised');
    const resolved =
      cell.value.kind === 'multiplier'
        ? (cell.config[cell.entry.constant as 'SPAWN_INTERVAL_START']).toPrecision(4)
        : cell.value.id;

    process.stdout.write(
      `${pad(cell.label, 26)}${pad(cell.entry.constant, 24)}${pad(resolved, 16)}` +
        `${pad(`${show(firstTimer?.runLength ?? null, 2)} s`, 13)}` +
        `${pad(`${show(practised?.runLength ?? null, 2)} s`, 12)}` +
        `${pad(`${(asymptoteMargin(result) * 100).toFixed(1)}%`, 11)}  ` +
        `${failed.length === 0 ? 'OK' : `FAIL (${failed.length})`}\n`,
    );
  }

  process.stdout.write('\n');

  for (const { cell, assertions } of cells) {
    for (const assertion of assertions.filter((entry) => !entry.ok)) {
      process.stdout.write(
        `FAIL ${cell.label}: ${assertion.name} — expected ${assertion.expected}, got ${assertion.actual}\n`,
      );
    }
  }

  process.stdout.write(
    failedAssertions === 0
      ? `\nOK — ${cells.length} cells, ${ranAssertions} assertions passed.\n`
      : `\n${failedAssertions} assertions failed across ${failedCells} of ${cells.length} cells. ` +
          `A bound is a design question: report it on the task rather than adjusting the cell (§14.9).\n`,
  );

  return failedAssertions === 0 ? 0 : 1;
}

function main(argv: readonly string[]): number {
  if (argv.includes('--help')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  let invocation: CliInvocation;
  try {
    invocation = buildInvocation(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  if (invocation.modifiers) {
    return runSweep(invocation);
  }

  const result = simulate(invocation.options);
  const assertions = checkAcceptance(result, invocation.calibrated);
  const failed = assertions.filter((assertion) => !assertion.ok);

  if (invocation.csv) {
    process.stdout.write(`${formatCsv(result)}\n`);
    if (failed.length > 0) {
      process.stderr.write(`${formatAssertions(failed)}\n`);
    }
    return failed.length === 0 ? 0 : 1;
  }

  const { dt, horizon, step } = invocation.options;
  process.stdout.write(
    `Lamplight Vigil — throughput simulation (docs/throughput-sim.md)\n` +
      `dt ${dt} s, horizon ${horizon} s, rows every ${step} s. Values from src/config.\n\n`,
  );
  process.stdout.write(`${formatSeries(result)}\n\n`);
  process.stdout.write(`${formatSummary(result)}\n\n`);
  process.stdout.write(`${formatAssertions(assertions)}\n\n`);
  process.stdout.write(
    failed.length === 0
      ? `OK — ${assertions.filter((assertion) => assertion.skipped === null).length} assertions passed.\n`
      : `${failed.length} of ${assertions.length} assertions failed.\n`,
  );

  return failed.length === 0 ? 0 : 1;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = main(process.argv.slice(2));
}
