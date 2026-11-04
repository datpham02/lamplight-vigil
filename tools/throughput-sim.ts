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
//
// THE WEEKLY SWEEP (`npm run sim -- --modifiers`) is `docs/design.md` §14.9 and
// GAM-16 condition C2.1: it evaluates every cell of the closed modifier table in
// §14.5 and exits non-zero if any one of them breaks a Group B invariant, leaves
// its constant's §10 safe range, or moves the modelled first-time run outside the
// §14.6 band. Plain `npm run sim` is unchanged, and every balance value in a cell
// still comes from src/config: a cell is the shipped config with one named
// constant resolved through `applyWeeklyModifier`, nothing more.

import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

import { SPAWN_EDGES } from '../src/config/index';
import { BASE_TUNING, tuningDifferences, type TuningConfig } from '../src/config/tuning';
import {
  WEEKLY_MODIFIERS,
  WEEKLY_SAFE_RANGES,
  applyWeeklyModifier,
  weeklyCellLabel,
  weeklyCells,
  weeklyResolvedLabel,
  weeklySafeRange,
  type WeeklyModifier,
} from '../src/config/weeklyModifiers';
import { rampedSpeed, spawnInterval } from '../src/enemies/CrawlerField';

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

// Every function below takes the config it reads, defaulted to the shipped values
// (§14.9 item 1). At `BASE_TUNING` each one is arithmetically what it was.

/** §5.4 — arrivals per second. */
export function spawnRate(elapsedSeconds: number, config: TuningConfig = BASE_TUNING): number {
  return 1 / spawnInterval(elapsedSeconds, config);
}

/**
 * §11.3 — the sustainable focus duty: the share of a sustained run a player can
 * spend narrow without the bar ever emptying.
 */
export function focusDuty(config: TuningConfig = BASE_TUNING): number {
  return config.POWER_RECHARGE_RATE / (config.POWER_DRAIN_RATE + config.POWER_RECHARGE_RATE);
}

/**
 * §11.3 — the shortest power-sustainable banish cycle, in seconds. Perfect aim,
 * zero travel, zero waste; no human reaches it. It is the right-hand side of the
 * §10.7 asymptote invariant.
 */
export function shortestSustainableCycle(config: TuningConfig = BASE_TUNING): number {
  return (config.BEAM_TRANSITION_TIME + config.BURN_DWELL_TIME) / focusDuty(config);
}

/** §11.1 — drain seconds one banish costs this tier. */
export function drainPerKill(tier: SkillTier, config: TuningConfig = BASE_TUNING): number {
  return config.BEAM_TRANSITION_TIME + config.BURN_DWELL_TIME + tier.wasteFocused;
}

/**
 * §11.1 — seconds per banish: the worse of the wall-clock round trip and the
 * power-limited cycle. Every tier is power-limited at the shipped config, which
 * is why POWER_RECHARGE_RATE is the lever GAM-17 moved.
 */
export function cycleSeconds(tier: SkillTier, config: TuningConfig = BASE_TUNING): number {
  const drain = drainPerKill(tier, config);
  return Math.max(drain + tier.aimWide + config.BEAM_TRANSITION_TIME, drain / focusDuty(config));
}

/** §11.1 — sustained banishes per second. Constant in `t`, deliberately (§3). */
export function capacity(tier: SkillTier, config: TuningConfig = BASE_TUNING): number {
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
   * The values every curve and every invariant below is evaluated at. `npm run
   * sim` passes the shipped config; the §14.9 sweep passes one weekly cell.
   */
  readonly config: TuningConfig;
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
  const { dt, horizon, step, tiers, config } = options;
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
    if (
      scoreCrossoverAt === null &&
      rate * config.SCORE_PER_BANISH >= config.SCORE_PER_SECOND_SURVIVED
    ) {
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
          Math.floor(t * config.SCORE_PER_SECOND_SURVIVED) +
          Math.floor(state.banished) * config.SCORE_PER_BANISH;
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
        Math.floor(horizon * config.SCORE_PER_SECOND_SURVIVED) +
        Math.floor(state.banished) * config.SCORE_PER_BANISH;
    }
  }

  return {
    options,
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
/** §7 B9 — `docs/vision.md` §6 criterion 2, at the shipped config. */
export const FIRST_TIMER_RUN_WINDOW = { min: 45, max: 120 } as const;
/**
 * `docs/design.md` §14.6 — the band every *published weekly cell* is held to,
 * tighter than the criterion window by the model's own calibration error in `B`.
 * A cell at 55 s survives GAM-15's −15% refit at 51.3 s, still inside 45 s; a cell
 * at 110 s survives a +15% refit at 116.7 s, still inside 120 s. §14.9 makes it
 * B9's window for the sweep, and it is a design bound: a cell outside it goes back
 * to `game-director` as a bound question, never nudged in place.
 */
export const WEEKLY_CELL_RUN_WINDOW = { min: 55, max: 110 } as const;
const PRACTISED_RUN_FLOOR = 180;
const WEIGHT_SUM_EPSILON = 1e-9;

export interface Assertion {
  readonly name: string;
  /** A — §11.1 at the shipped config. B — §7 invariants. W — §14.9's three. */
  readonly group: 'A' | 'B' | 'W';
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
 * Every §7 assertion, in order: Group A then Group B, at the criterion-2 run
 * window. This is what `npm run sim` checks, and its behaviour is unchanged.
 *
 * `calibrated` is set when the tier table has been overridden from the command
 * line: Group A and B9 then describe a model the caller has deliberately changed,
 * so they are reported as skipped rather than failed. Every other Group B
 * assertion is about `src/config` alone and still runs.
 */
export function checkAcceptance(result: SimulationResult, calibrated = false): Assertion[] {
  return [
    ...checkGroupA(result, calibrated),
    ...checkGroupB(result, calibrated, FIRST_TIMER_RUN_WINDOW),
  ];
}

/**
 * §7 Group A — reproduces §11.1 **at the shipped config**.
 *
 * The §14.9 sweep does not run this per cell: a modifier is expected to move these
 * numbers, and `restless-hollow ×1.10` moving `speedCapsAt` from 198 s to 153.9 s
 * is the modifier working, not a defect. It is run once, for the base config, and
 * once more for the `plain` cell, which assertion W3 requires to reproduce it.
 */
export function checkGroupA(result: SimulationResult, calibrated = false): Assertion[] {
  const assertions: Assertion[] = [];
  const { landmarks } = result;
  const config = result.options.config;
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

  return assertions;
}

/**
 * §7 Group B — the invariants that must hold at *any* config, which is why the
 * §14.9 sweep runs all nine against every cell of the modifier table.
 *
 * `runWindow` is B9's first-timer band: the `docs/vision.md` §6 criterion 2 window
 * for the shipped config, the tighter §14.6 band for a published weekly cell.
 */
export function checkGroupB(
  result: SimulationResult,
  calibrated = false,
  runWindow: { readonly min: number; readonly max: number } = FIRST_TIMER_RUN_WINDOW,
): Assertion[] {
  const assertions: Assertion[] = [];
  const { landmarks } = result;
  const config = result.options.config;
  const overridden = calibrated ? OVERRIDDEN : null;

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

  const shortestApproach = config.RENDER_HEIGHT / 2 - config.LAMP_RADIUS - 2 * config.CRAWLER_RADIUS;
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
      tier.peakConcurrency < config.MAX_CRAWLERS,
      `< ${config.MAX_CRAWLERS}`,
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
    config.BEAM_FOCUS_RANGE > 551 && config.BEAM_WIDE_RANGE < 480,
    'BEAM_FOCUS_RANGE > 551 and BEAM_WIDE_RANGE < 480',
    `${config.BEAM_FOCUS_RANGE} and ${config.BEAM_WIDE_RANGE}`,
  );

  // B9 is the one Group B assertion with model error in it, and the one that a
  // refit can legitimately move. It is kept because it is the shipping criterion.
  const firstTimer = result.tiers.find((tier) => tier.tier.key === 'first-timer');
  const practised = result.tiers.find((tier) => tier.tier.key === 'practised');
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
// The weekly modifier sweep — `docs/design.md` §14.9, GAM-16 condition C2.1
// ---------------------------------------------------------------------------
//
// One cell is one week the game can ever produce. The table is closed and finite
// (§14.1 rule 3) precisely so that this loop can enumerate every one of them.

/**
 * §14.6 — a published cell must keep 10% of margin on B3, enough that a later
 * retune of the base config under §10 cannot silently push a week that already
 * shipped through the asymptote invariant. Every way of making the power economy
 * kinder spends this margin, which is why entries 3, 4 and 5 only go the harder
 * way. Stated in §14.6 rather than in §14.9's table of assertions; it is checked
 * here because it is the bound that keeps the easy side of the table closed.
 */
const WEEKLY_B3_MARGIN_FLOOR = 0.1;

/** The §14.5 list of seven: the only constants a modifier may name (W2). */
const WEEKLY_NAMED_CONSTANTS: ReadonlySet<string> = new Set([
  ...Object.keys(WEEKLY_SAFE_RANGES),
  'SPAWN_EDGE_WEIGHTS',
]);

export interface CellResult {
  readonly entryId: string;
  /** `clinging-dark x1.30`, `one-axis long-dark`. */
  readonly label: string;
  readonly constant: string;
  readonly resolved: string;
  readonly result: SimulationResult;
  readonly assertions: readonly Assertion[];
}

export interface SweepResult {
  readonly cells: readonly CellResult[];
  /** Assertions about the table as a whole rather than about one cell. */
  readonly tableAssertions: readonly Assertion[];
}

/**
 * §14.6 — the one place the sweep is allowed to touch a §4 tier parameter.
 *
 * §11.1 anchors the backlog tolerance `B` on `360 / BEAM_WIDE_ANGLE_DEG`: how many
 * unserviced crawlers a player can hold depends on how much of the field one wide
 * cone covers. So a cone modifier genuinely does move `B`, by the same multiplier,
 * and the sweep must say so — it is why `narrow-lantern`'s run lengths differ from
 * the base at all. It applies to `BEAM_WIDE_ANGLE_DEG` and to no other constant.
 */
export function tiersForCell(entry: WeeklyModifier, valueIndex: number): readonly SkillTier[] {
  if (entry.kind !== 'multiplier' || entry.constant !== 'BEAM_WIDE_ANGLE_DEG') {
    return SKILL_TIERS;
  }

  const multiplier = entry.values[valueIndex];
  if (multiplier === undefined) {
    throw new Error(`${entry.id} has no value at index ${valueIndex}`);
  }

  return SKILL_TIERS.map((tier) => ({
    ...tier,
    backlogTolerance: tier.backlogTolerance * multiplier,
  }));
}

/**
 * A read by name that survives a table edited past the `WeeklyConstant` union:
 * an entry naming something that is not a config constant at all must fail W1 and
 * W2 with a message, not throw a TypeError at the reviewer.
 */
function readConstant(config: TuningConfig, constant: string): unknown {
  return new Map<string, unknown>(Object.entries(config)).get(constant);
}

/** The §14.9 assertions for one cell: Group B at the §14.6 band, then W1–W4. */
function checkCell(entry: WeeklyModifier, result: SimulationResult): Assertion[] {
  const config = result.options.config;
  const assertions: Assertion[] = checkGroupB(result, false, WEEKLY_CELL_RUN_WINDOW);

  const w = (name: string, ok: boolean, expected: string, actual: string): void => {
    assertions.push({ name, group: 'W', ok, expected, actual, skipped: null });
  };

  // W1 — the resolved value is inside the constant's own §10 safe range. A week
  // can never put the game somewhere a designer could not have tuned it by hand.
  if (entry.kind === 'multiplier') {
    const range = weeklySafeRange(entry.constant);
    const resolved = readConstant(config, entry.constant);
    w(
      `W1 ${entry.constant} is inside its §10 safe range`,
      range !== undefined &&
        typeof resolved === 'number' &&
        resolved >= range.min &&
        resolved <= range.max,
      range === undefined
        ? 'a constant with a §10 safe range, from the §14.5 list'
        : `${range.min} to ${range.max}`,
      typeof resolved === 'number'
        ? String(resolved)
        : `${entry.constant} is not a numeric constant of the config`,
    );
  } else {
    // §10.7 gives SPAWN_EDGE_WEIGHTS "any set summing to 1". The sum is B7; what
    // is left for W1 is that every weight is a share of it.
    const weights = SPAWN_EDGES.map((edge) => config.SPAWN_EDGE_WEIGHTS[edge]);
    w(
      'W1 SPAWN_EDGE_WEIGHTS is a set of shares',
      weights.every((weight) => weight >= 0 && weight <= 1),
      'every weight in [0, 1], summing to 1 (B7)',
      weights.map((weight) => weight.toFixed(2)).join(' '),
    );
  }

  // W2 — the entry names a constant on the §14.5 list, and the cell changes that
  // constant only. `plain` is x1.00, so it changes nothing, which is still only
  // the constant it names.
  const changed = tuningDifferences(BASE_TUNING, config);
  w(
    'W2 the cell changes its named constant only',
    WEEKLY_NAMED_CONSTANTS.has(entry.constant) &&
      changed.every((key) => key === entry.constant),
    `nothing outside ${entry.constant}, which is on the §14.5 list`,
    changed.length === 0 ? 'nothing (x1.00)' : changed.join(', '),
  );

  // W3 — the `plain` cell reproduces the shipped config's Group A numbers
  // exactly. If it does not, the override layer is lying about something.
  if (entry.id === 'plain') {
    const groupA = checkGroupA(result);
    const failed = groupA.filter((assertion) => !assertion.ok);
    w(
      'W3 plain reproduces the shipped Group A numbers',
      changed.length === 0 && failed.length === 0,
      'a config identical to src/config, and every §11.1 number',
      changed.length > 0
        ? `the config differs at ${changed.join(', ')}`
        : failed.length > 0
          ? `${failed.length} Group A assertions fail, first ${failed[0]?.name}`
          : `identical config, ${groupA.length} Group A assertions pass`,
    );
  }

  // W4 — §14.6's 10% margin on B3. B3 itself only requires the margin to be
  // positive; a published week has to leave room for a later §10 retune.
  const margin = asymptoteMargin(result);
  w(
    'W4 B3 keeps the §14.6 margin',
    margin >= WEEKLY_B3_MARGIN_FLOOR,
    `>= ${(WEEKLY_B3_MARGIN_FLOOR * 100).toFixed(0)}%`,
    `${(margin * 100).toFixed(1)}%`,
  );

  return assertions;
}

/**
 * Every cell of the table, each simulated at its own config and checked against
 * §14.9. Deterministic and order-stable, like everything else here (§6).
 */
export function sweepModifiers(
  options: Omit<SimulationOptions, 'tiers' | 'config'>,
  table: readonly WeeklyModifier[] = WEEKLY_MODIFIERS,
): SweepResult {
  const cells = weeklyCells(table).map(({ entry, valueIndex }) => {
    const config = applyWeeklyModifier(BASE_TUNING, entry, valueIndex);
    const result = simulate({ ...options, config, tiers: tiersForCell(entry, valueIndex) });

    return {
      entryId: entry.id,
      label: weeklyCellLabel(entry, valueIndex),
      constant: entry.constant,
      resolved: weeklyResolvedLabel(BASE_TUNING, entry, valueIndex),
      result,
      assertions: checkCell(entry, result),
    };
  });

  // W3 is an assertion about a cell that must exist. A table with no `plain`
  // entry would otherwise pass the sweep by having nothing to check it on.
  const hasPlain = table.some((entry) => entry.id === 'plain');
  const tableAssertions: Assertion[] = [
    {
      name: 'W3 the table declares a `plain` cell',
      group: 'W',
      ok: hasPlain,
      expected: 'an entry with id `plain` (§14.5)',
      actual: hasPlain ? 'present' : 'absent',
      skipped: null,
    },
  ];

  return { cells, tableAssertions };
}

/** Every assertion a sweep produced, cells first, in order. */
export function sweepAssertions(sweep: SweepResult): Assertion[] {
  return [...sweep.cells.flatMap((cell) => cell.assertions), ...sweep.tableAssertions];
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

/**
 * §10.7 — how much room the floor interval has under the shortest
 * power-sustainable banish cycle, as a fraction of the floor. B3 requires it to be
 * positive; `docs/design.md` §14.6 requires 10% of it for any published weekly
 * cell, because every way of making the power economy kinder spends this margin.
 */
export function asymptoteMargin(result: SimulationResult): number {
  const floor = result.options.config.SPAWN_INTERVAL_MIN;
  return (result.landmarks.shortestSustainableCycle - floor) / floor;
}

function formatSummary(result: SimulationResult): string {
  const lines: string[] = [];
  const { landmarks } = result;
  const floor = result.options.config.SPAWN_INTERVAL_MIN;

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
  lines.push(`    SPAWN_INTERVAL_MIN    ${floor.toFixed(3)} s`);
  lines.push(
    `    shortest cycle        ${landmarks.shortestSustainableCycle.toFixed(3)} s  (margin ${(asymptoteMargin(result) * 100).toFixed(1)}%)`,
  );

  return lines.join('\n');
}

function runLengthOf(cell: CellResult, key: TierKey): string {
  return show(cell.result.tiers.find((tier) => tier.tier.key === key)?.runLength ?? null, 2);
}

/**
 * §14.9 — the sweep's own report. One row per cell, which is one row per week the
 * game can ever produce, then every failure in full.
 */
function formatSweep(sweep: SweepResult): string {
  const lines: string[] = [];

  lines.push(
    `${'cell'.padEnd(26)}${'constant'.padEnd(23)}${pad('resolved', 18)}${pad('first-timer', 13)}${pad('practised', 12)}${pad('expert', 11)}${pad('B3 margin', 11)}  verdict`,
  );

  for (const cell of sweep.cells) {
    const failed = cell.assertions.filter((assertion) => !assertion.ok);
    lines.push(
      `${cell.label.padEnd(26)}${cell.constant.padEnd(23)}${pad(cell.resolved, 18)}` +
        `${pad(`${runLengthOf(cell, 'first-timer')} s`, 13)}${pad(`${runLengthOf(cell, 'practised')} s`, 12)}` +
        `${pad(`${runLengthOf(cell, 'expert')} s`, 11)}${pad(`${(asymptoteMargin(cell.result) * 100).toFixed(1)}%`, 11)}` +
        `  ${failed.length === 0 ? 'PASS' : `FAIL (${failed.length})`}`,
    );
  }

  const failures = [
    ...sweep.cells.flatMap((cell) =>
      cell.assertions
        .filter((assertion) => !assertion.ok)
        .map(
          (assertion) =>
            `FAIL [${cell.label}] ${assertion.name}: expected ${assertion.expected}, got ${assertion.actual}`,
        ),
    ),
    ...sweep.tableAssertions
      .filter((assertion) => !assertion.ok)
      .map(
        (assertion) =>
          `FAIL [table] ${assertion.name}: expected ${assertion.expected}, got ${assertion.actual}`,
      ),
  ];

  if (failures.length > 0) {
    lines.push('');
    lines.push(...failures);
  }

  return lines.join('\n');
}

function formatSweepCsv(sweep: SweepResult): string {
  const header = [
    'cell',
    'constant',
    'resolved',
    'first-timer.runLength',
    'practised.runLength',
    'expert.runLength',
    'b3margin',
    'failed',
  ].join(',');

  const rows = sweep.cells.map((cell) =>
    [
      cell.label,
      cell.constant,
      cell.resolved,
      runLengthOf(cell, 'first-timer'),
      runLengthOf(cell, 'practised'),
      runLengthOf(cell, 'expert'),
      asymptoteMargin(cell.result).toFixed(6),
      cell.assertions.filter((assertion) => !assertion.ok).length,
    ].join(','),
  );

  return [header, ...rows].join('\n');
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

  --modifiers       sweep every cell of the weekly modifier table (docs/design.md
                    §14.5) and exit non-zero if any one of them breaks a Group B
                    invariant, leaves its constant's §10 safe range, or moves the
                    modelled first-time run outside the §14.6 band. Group A is run
                    once, for the base config. Takes no tier override.
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
  /** `--modifiers`: run the §14.9 sweep after the base config's §7 assertions. */
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

  // The sweep reports all three tiers and owns the one tier parameter §14.6 lets
  // it move (`backlogTolerance`, under a cone modifier). A command-line override
  // on top of that would make a cell's run length neither §14.5's nor the refit's.
  if (values.modifiers === true && (values.tier !== undefined || overrides.length > 0)) {
    throw new Error('--modifiers sweeps the whole tier table; it takes no --tier or tier override');
  }

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
      config: BASE_TUNING,
    },
    // Selecting a tier alone is not a recalibration; changing its parameters is.
    calibrated: overrides.length > 0,
    csv: values.csv === true,
    modifiers: values.modifiers === true,
  };
}

/**
 * `--modifiers` — §14.9. Group A runs once, here, at the base config; Group B and
 * W1–W4 run per cell. The exit code covers both: a base config that has drifted
 * out of §11.1 fails the sweep too, because every cell is derived from it.
 */
function runSweep(invocation: CliInvocation, baseAssertions: readonly Assertion[]): number {
  const { dt, horizon, step } = invocation.options;
  const sweep = sweepModifiers({ dt, horizon, step });
  const cells = sweep.cells.length;
  const failedBase = baseAssertions.filter((assertion) => !assertion.ok);
  const failedCells = sweep.cells.filter((cell) =>
    cell.assertions.some((assertion) => !assertion.ok),
  );
  const failedTable = sweep.tableAssertions.filter((assertion) => !assertion.ok);
  const assertionCount = sweepAssertions(sweep).length + baseAssertions.length;
  const ok = failedBase.length === 0 && failedCells.length === 0 && failedTable.length === 0;

  if (invocation.csv) {
    process.stdout.write(`${formatSweepCsv(sweep)}\n`);
    if (!ok) {
      process.stderr.write(`${formatSweep(sweep)}\n`);
    }
    return ok ? 0 : 1;
  }

  process.stdout.write(
    `Lamplight Vigil — weekly modifier sweep (docs/design.md §14.9)\n` +
      `${WEEKLY_MODIFIERS.length} entries, ${cells} cells. dt ${dt} s, horizon ${horizon} s.\n` +
      `Group B per cell at the §14.6 band [${WEEKLY_CELL_RUN_WINDOW.min}, ${WEEKLY_CELL_RUN_WINDOW.max}] s, ` +
      `plus W1-W4. Group A runs once, below, at the base config.\n` +
      `Edge weights are listed top/bottom/left/right.\n\n`,
  );
  process.stdout.write(`${formatSweep(sweep)}\n\n`);
  process.stdout.write(`base config (docs/throughput-sim.md §7)\n`);
  process.stdout.write(
    failedBase.length === 0
      ? `  OK — ${baseAssertions.filter((assertion) => assertion.skipped === null).length} assertions passed.\n\n`
      : `${formatAssertions(failedBase)}\n\n`,
  );
  process.stdout.write(
    ok
      ? `OK — ${cells} of ${cells} cells passed, ${assertionCount} assertions.\n`
      : `${failedCells.length} of ${cells} cells failed` +
          `${failedBase.length > 0 ? `, and the base config failed ${failedBase.length} assertions` : ''}` +
          `${failedTable.length > 0 ? `, and the table failed ${failedTable.length}` : ''}.\n`,
  );

  return ok ? 0 : 1;
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

  const result = simulate(invocation.options);
  const assertions = checkAcceptance(result, invocation.calibrated);
  const failed = assertions.filter((assertion) => !assertion.ok);

  if (invocation.modifiers) {
    return runSweep(invocation, assertions);
  }

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
