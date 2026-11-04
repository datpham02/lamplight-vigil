// The GAM-17 acceptance numbers, asserted against the shipped `src/config`.
//
// This is the test the rebalance exists for: `docs/design.md` §11.1 derives a
// difficulty curve with no late-game wall in it, and `docs/throughput-sim.md` §7
// states the numbers that prove it. Without this test a later retune could move a
// value inside its own documented safe range and quietly bring the wall back —
// every one of the §7 invariants is a product of values that live in different
// subsections of the §10 tuning table, so no single row can protect one.
//
// It asserts nothing of its own: every expectation comes from the simulation's
// §7 table, and every input from src/config. If one of these fails, the config,
// the design or the script is wrong — fix the disagreement, do not retune the
// expectation (`docs/throughput-sim.md` §1).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SCORE_PER_BANISH } from '../src/config/index';
import { BASE_TUNING, tuningDifferences } from '../src/config/tuning';
import { WEEKLY_MODIFIERS, type WeeklyModifier } from '../src/config/weeklyModifiers';
import {
  DEFAULT_DT,
  DEFAULT_HORIZON,
  DEFAULT_STEP,
  FIRST_TIMER_RUN_WINDOW,
  SKILL_TIERS,
  WEEKLY_CELL_RUN_WINDOW,
  buildInvocation,
  checkAcceptance,
  simulate,
  sweepModifiers,
  tiersForCell,
  type SimulationResult,
  type SweepResult,
} from './throughput-sim';

const SHIPPED = {
  dt: DEFAULT_DT,
  horizon: DEFAULT_HORIZON,
  step: DEFAULT_STEP,
  tiers: SKILL_TIERS,
  config: BASE_TUNING,
};

/** §6 — at `dt = 0.001` no acceptance number may move by more than this. */
const CONVERGENCE_TOLERANCE = 0.005;

/**
 * `score` is `floor(banished) * SCORE_PER_BANISH + floor(t * SCORE_PER_SECOND_SURVIVED)`
 * (§3), so it is a step function of two converged quantities rather than a
 * converged quantity itself: when `banished` lands within a thousandth of a whole
 * crawler — which it does at the shipped config, at 23.00 for a first-timer — a
 * step size that moves it by 0.03% moves the score by one whole banish. That is
 * quantisation, not integration error, so score is allowed exactly one banish of
 * movement on top of the 0.5% band. `banished` itself is held to the 0.5%.
 */
function quantumFor(name: string): number {
  return name.endsWith('.score') ? SCORE_PER_BANISH : 0;
}

const shipped = simulate(SHIPPED);
const assertions = checkAcceptance(shipped);

/**
 * Every number §7 quotes, flattened so the convergence check can walk them.
 * `null` means "never happened", which must stay null at any step size.
 */
function acceptanceNumbers(result: SimulationResult): Map<string, number | null> {
  const numbers = new Map<string, number | null>([
    ['floorBindsAt', result.landmarks.floorBindsAt],
    ['speedCapsAt', result.landmarks.speedCapsAt],
    ['scoreCrossoverAt', result.landmarks.scoreCrossoverAt],
    ['maxRateSlope', result.landmarks.maxRateSlope],
    ['duty', result.landmarks.duty],
    ['shortestSustainableCycle', result.landmarks.shortestSustainableCycle],
    ['cumulativeSpawnsAtProbe', result.landmarks.cumulativeSpawnsAtProbe],
  ]);

  for (const tier of result.tiers) {
    numbers.set(`${tier.tier.key}.capacity`, tier.capacity);
    numbers.set(`${tier.tier.key}.cycleSeconds`, tier.cycleSeconds);
    numbers.set(`${tier.tier.key}.crossing`, tier.crossing);
    numbers.set(`${tier.tier.key}.runLength`, tier.runLength);
    numbers.set(`${tier.tier.key}.cumulativeSpawns`, tier.cumulativeSpawns);
    numbers.set(`${tier.tier.key}.banished`, tier.banished);
    numbers.set(`${tier.tier.key}.score`, tier.score);
    numbers.set(`${tier.tier.key}.peakConcurrency`, tier.peakConcurrency);
    numbers.set(`${tier.tier.key}.backlogAtProbe`, tier.backlogAtProbe);
    numbers.set(`${tier.tier.key}.concurrencyThresholdAt`, tier.concurrencyThresholdAt);
  }

  return numbers;
}

describe('throughput simulation — §7 acceptance at the shipped config', () => {
  it('runs every assertion in §7; none is skipped', () => {
    assert.ok(assertions.length > 0, 'the acceptance table is not empty');
    assert.deepEqual(
      assertions.filter((assertion) => assertion.skipped !== null).map((assertion) => assertion.name),
      [],
      'nothing is skipped when no override is in play',
    );
    assert.ok(
      assertions.some((assertion) => assertion.group === 'A'),
      'Group A reproduces design.md §11.1',
    );
    assert.ok(
      assertions.some((assertion) => assertion.group === 'B'),
      'Group B is the invariant set',
    );
  });

  for (const assertion of assertions) {
    it(assertion.name, () => {
      assert.ok(
        assertion.ok,
        `expected ${assertion.expected}, got ${assertion.actual}. ` +
          'A failure here means src/config, docs/design.md §11.1 or the simulation ' +
          'disagree — fix the disagreement, do not retune the expectation.',
      );
    });
  }
});

describe('throughput simulation — determinism (§6)', () => {
  it('produces identical output from identical inputs', () => {
    assert.deepEqual(simulate(SHIPPED), simulate(SHIPPED));
  });

  it('holds every acceptance number to 0.5% at a ten-times finer step', () => {
    const fine = acceptanceNumbers(simulate({ ...SHIPPED, dt: DEFAULT_DT / 10 }));

    for (const [name, coarse] of acceptanceNumbers(shipped)) {
      const refined = fine.get(name);
      assert.notEqual(refined, undefined, `${name} is present at both step sizes`);

      if (coarse === null || refined === null || refined === undefined) {
        assert.equal(refined ?? null, coarse, `${name} must be null at both step sizes`);
        continue;
      }

      const moved = Math.max(0, Math.abs(refined - coarse) - quantumFor(name));
      const drift = coarse === 0 ? moved : moved / Math.abs(coarse);
      assert.ok(
        drift <= CONVERGENCE_TOLERANCE,
        `${name} moved ${(drift * 100).toFixed(3)}% between dt=${DEFAULT_DT} and dt=${DEFAULT_DT / 10} ` +
          `(${coarse} -> ${refined}); forward Euler must be converged at the quoted step`,
      );
    }
  });

  it('still passes every §7 assertion at the finer step', () => {
    const refined = checkAcceptance(simulate({ ...SHIPPED, dt: DEFAULT_DT / 10 }));
    const failed = refined.filter((assertion) => !assertion.ok);

    assert.deepEqual(
      failed.map((assertion) => `${assertion.name}: ${assertion.actual}`),
      [],
      'the §7 numbers are a property of the config, not of the step size',
    );
  });
});

describe('throughput simulation — the GAM-15 refit path (§4)', () => {
  it('overrides one tier from the command line and marks the run calibrated', () => {
    const invocation = buildInvocation(['--tier', 'practised', '--backlog', '4.2']);
    const [tier] = invocation.options.tiers;

    assert.equal(invocation.options.tiers.length, 1);
    assert.equal(tier?.key, 'practised');
    assert.equal(tier?.backlogTolerance, 4.2);
    assert.equal(tier?.aimWide, 0.5, 'an unspecified parameter keeps its table value');
    assert.equal(invocation.calibrated, true);
  });

  it('skips rather than fails the §11.1 numbers once a tier is overridden', () => {
    const invocation = buildInvocation(['--tier', 'practised', '--backlog', '4.2']);
    const refitted = checkAcceptance(simulate(invocation.options), invocation.calibrated);

    assert.ok(
      refitted.every((assertion) => assertion.ok),
      'a refit must not report a failure against numbers it deliberately changed',
    );
    assert.ok(
      refitted.some((assertion) => assertion.group === 'A' && assertion.skipped !== null),
      'Group A is skipped, not silently passed',
    );
    assert.ok(
      refitted.some(
        (assertion) => assertion.group === 'B' && assertion.name.startsWith('B3') && assertion.skipped === null,
      ),
      'the config-only invariants still run under a refit',
    );
  });

  it('selecting a tier without overriding it still checks §11.1', () => {
    const invocation = buildInvocation(['--tier', 'expert']);

    assert.equal(invocation.calibrated, false);
    assert.ok(
      checkAcceptance(simulate(invocation.options), invocation.calibrated).every(
        (assertion) => assertion.ok,
      ),
    );
  });

  it('refuses an override that names no tier', () => {
    assert.throws(() => buildInvocation(['--backlog', '4.2']), /needs --tier/);
    assert.throws(() => buildInvocation(['--tier', 'novice']), /--tier must be one of/);
    assert.throws(() => buildInvocation(['--dt', 'soon']), /needs a number/);
  });
});

// ---------------------------------------------------------------------------
// The weekly modifier sweep — docs/design.md §14.9, GAM-16 condition C2.1
// ---------------------------------------------------------------------------

const SWEEP = { dt: DEFAULT_DT, horizon: DEFAULT_HORIZON, step: DEFAULT_STEP };

const shippedSweep = sweepModifiers(SWEEP);

function failuresOf(sweep: SweepResult): string[] {
  return [
    ...sweep.cells.flatMap((cell) =>
      cell.assertions.filter((a) => !a.ok).map((a) => `${cell.label} ${a.name}`),
    ),
    ...sweep.tableAssertions.filter((a) => !a.ok).map((a) => `table ${a.name}`),
  ];
}

/**
 * `docs/design.md` §14.5, every cell, both tiers. Fifteen rows for fifteen cells,
 * including the four that are expected to equal `plain` exactly — §14.5 is
 * explicit that a row which *differs* is the thing to report.
 *
 * These are the design's numbers. If one fails, the config, §14.5 or the sweep
 * disagree: say so on the task, do not retune the expectation here
 * (`docs/throughput-sim.md` §9.4, §14.9).
 */
const CELL_TABLE: readonly { cell: string; firstTimer: number; practised: number }[] = [
  { cell: 'plain x1.00', firstTimer: 79.1, practised: 250.3 },
  { cell: 'restless-hollow x0.90', firstTimer: 79.1, practised: 250.3 },
  { cell: 'restless-hollow x1.10', firstTimer: 79.1, practised: 250.3 },
  { cell: 'clinging-dark x1.15', firstTimer: 68.7, practised: 231.4 },
  { cell: 'clinging-dark x1.30', firstTimer: 59.9, practised: 213.8 },
  { cell: 'thin-wick x0.90', firstTimer: 64.7, practised: 235.6 },
  { cell: 'thin-wick x0.85', firstTimer: 57.9, practised: 227.3 },
  { cell: 'hungry-flame x1.10', firstTimer: 66.0, practised: 237.0 },
  { cell: 'hungry-flame x1.20', firstTimer: 55.7, practised: 224.4 },
  { cell: 'crowded-threshold x0.94', firstTimer: 61.9, practised: 232.7 },
  { cell: 'crowded-threshold x1.06', firstTimer: 95.7, practised: 266.9 },
  { cell: 'narrow-lantern x0.85', firstTimer: 73.8, practised: 245.3 },
  { cell: 'narrow-lantern x1.15', firstTimer: 83.9, practised: 254.9 },
  { cell: 'one-axis long-dark', firstTimer: 79.1, practised: 250.3 },
  { cell: 'one-axis over-the-top', firstTimer: 79.1, practised: 250.3 },
];

/** §14.5 quotes run lengths to 0.1 s, so half of that is the whole budget. */
const QUOTED_PRECISION = 0.051;

describe('weekly modifier sweep — the shipped table (§14.5)', () => {
  it('iterates the whole declared table: eight entries, fifteen cells', () => {
    assert.equal(WEEKLY_MODIFIERS.length, 8);
    assert.equal(shippedSweep.cells.length, 15);
    assert.deepEqual(
      shippedSweep.cells.map((cell) => cell.label),
      CELL_TABLE.map((row) => row.cell),
    );
  });

  it('passes every §14.9 assertion at every cell', () => {
    assert.deepEqual(failuresOf(shippedSweep), []);
  });

  it('checks Group B and W1-W4 per cell, and never Group A', () => {
    for (const cell of shippedSweep.cells) {
      assert.ok(
        cell.assertions.some((a) => a.group === 'B' && a.name.startsWith('B9')),
        `${cell.label} is held to a run-length band`,
      );
      assert.ok(
        cell.assertions.some((a) => a.group === 'W' && a.name.startsWith('W1')),
        `${cell.label} has its resolved value checked against §10`,
      );
      assert.deepEqual(
        cell.assertions.filter((a) => a.group === 'A'),
        [],
        'Group A reproduces §11.1 at the shipped config and is expected to move under a modifier',
      );
      assert.deepEqual(
        cell.assertions.filter((a) => a.skipped !== null),
        [],
        'a cell is never a calibration, so nothing may be skipped',
      );
    }
  });

  for (const row of CELL_TABLE) {
    it(`${row.cell} lands where §14.5 says it does`, () => {
      const cell = shippedSweep.cells.find((candidate) => candidate.label === row.cell);
      const runLength = (key: string): number => {
        const tier = cell?.result.tiers.find((candidate) => candidate.tier.key === key);
        assert.ok(tier?.runLength != null, `${row.cell} ends inside the horizon for ${key}`);
        return tier.runLength;
      };

      for (const [key, expected] of [
        ['first-timer', row.firstTimer],
        ['practised', row.practised],
      ] as const) {
        const actual = runLength(key);
        assert.ok(
          Math.abs(actual - expected) <= QUOTED_PRECISION,
          `${row.cell} ${key}: §14.5 says ${expected} s, the sweep says ${actual.toFixed(2)} s. ` +
            'That disagreement is a design question — report it, do not retune this table.',
        );
      }
    });
  }

  it('applies the §14.6 backlogTolerance coupling to BEAM_WIDE_ANGLE_DEG alone', () => {
    const coupled = tiersForCell(
      { id: 'narrow-lantern', kind: 'multiplier', constant: 'BEAM_WIDE_ANGLE_DEG', values: [0.85] },
      0,
    );
    const uncoupled = tiersForCell(
      { id: 'clinging-dark', kind: 'multiplier', constant: 'BURN_DWELL_TIME', values: [1.3] },
      0,
    );

    assert.equal(coupled[0]?.backlogTolerance, 3 * 0.85);
    assert.equal(uncoupled[0]?.backlogTolerance, SKILL_TIERS[0]?.backlogTolerance);
  });

  it('leaves the base config untouched: a cell is the shipped config plus one constant', () => {
    assert.deepEqual(BASE_TUNING, { ...BASE_TUNING }, 'BASE_TUNING is not mutated by a sweep');
    for (const cell of shippedSweep.cells) {
      const changed = tuningDifferences(BASE_TUNING, cell.result.options.config);
      assert.ok(
        changed.length <= 1 && changed.every((key) => key === cell.constant),
        `${cell.label} changed ${changed.join(', ') || 'nothing'}`,
      );
    }
  });
});

// A green run against a table that cannot fail is not acceptance (GAM-39). Each
// fixture below is a cell a reviewer might wave through, and each one names the
// assertion that catches it. If one of these ever passes, the sweep has stopped
// being a gate and is only a report.
describe('weekly modifier sweep — the failure path (criterion 24)', () => {
  const PLAIN: WeeklyModifier = {
    id: 'plain',
    kind: 'multiplier',
    constant: 'SPAWN_INTERVAL_START',
    values: [1.0],
  };
  /** One known-good cell beside the bad one, so a failure is not the whole table. */
  const sweepOf = (entry: WeeklyModifier): SweepResult => sweepModifiers(SWEEP, [PLAIN, entry]);

  it('catches SPAWN_INTERVAL_START x1.15: inside its own safe range, past B5 (§14.6)', () => {
    const sweep = sweepOf({
      id: 'bad-quiet-opening',
      kind: 'multiplier',
      constant: 'SPAWN_INTERVAL_START',
      values: [1.15],
    });

    assert.deepEqual(
      failuresOf(sweep).filter((name) => name.startsWith('plain')),
      [],
      'the good cell in the same table still passes',
    );
    assert.ok(
      failuresOf(sweep).includes('bad-quiet-opening x1.15 B5 the floor binds inside a reachable run'),
      'the floor binds at 371.6 s, past the 360 s bound, while x1.15 is inside SPAWN_INTERVAL_START\'s own §10 range',
    );
  });

  it('catches a cell outside the §14.6 run-length band', () => {
    const sweep = sweepOf({
      id: 'bad-long-burn',
      kind: 'multiplier',
      constant: 'BURN_DWELL_TIME',
      values: [1.6],
    });

    assert.ok(
      failuresOf(sweep).includes('bad-long-burn x1.60 B9 run lengths meet the shipping criterion'),
      'x1.60 resolves to 0.64 s, inside BURN_DWELL_TIME\'s §10 range, and collapses the run',
    );
  });

  it('catches a resolved value outside its §10 safe range (W1)', () => {
    const sweep = sweepOf({
      id: 'bad-fast-crawl',
      kind: 'multiplier',
      constant: 'CRAWLER_SPEED_BASE',
      values: [1.5],
    });

    assert.ok(
      failuresOf(sweep).includes('bad-fast-crawl x1.50 W1 CRAWLER_SPEED_BASE is inside its §10 safe range'),
      '78 px/s is outside the 35-75 band a designer may retune inside by hand',
    );
  });

  it('catches an entry naming a constant that is not on the §14.5 list (W2, C1.1)', () => {
    // The union type is the first fence; this proves the second one. A table
    // hand-edited past the type — or widened by a later task — still fails.
    const offTable = {
      id: 'bad-crawler-cap',
      kind: 'multiplier',
      constant: 'MAX_CRAWLERS',
      values: [1.5],
    } as unknown as WeeklyModifier;

    assert.ok(
      failuresOf(sweepOf(offTable)).includes(
        'bad-crawler-cap x1.50 W2 the cell changes its named constant only',
      ),
      'MAX_CRAWLERS is a performance rail, deliberately not in the table (§14.7)',
    );
  });

  it('catches edge weights that do not sum to 1 (B7)', () => {
    const sweep = sweepOf({
      id: 'bad-axis',
      kind: 'override',
      constant: 'SPAWN_EDGE_WEIGHTS',
      values: [{ id: 'leaky', weights: { top: 0.05, bottom: 0.05, left: 0.45, right: 0.4 } }],
    });

    assert.ok(
      failuresOf(sweep).includes('bad-axis leaky B7 spawn edge weights sum to 1'),
      'a weight set that does not sum to 1 silently lowers the spawn rate',
    );
  });

  it('catches a `plain` cell that is not the shipped config (W3)', () => {
    const sweep = sweepModifiers(SWEEP, [
      { id: 'plain', kind: 'multiplier', constant: 'SPAWN_INTERVAL_START', values: [1.02] },
    ]);

    assert.ok(
      failuresOf(sweep).includes('plain x1.02 W3 plain reproduces the shipped Group A numbers'),
      'if the plain week is not the shipped game, the override layer is lying about something',
    );
  });

  it('catches a table with no `plain` cell at all', () => {
    const sweep = sweepModifiers(SWEEP, [
      { id: 'clinging-dark', kind: 'multiplier', constant: 'BURN_DWELL_TIME', values: [1.15] },
    ]);

    assert.ok(
      failuresOf(sweep).includes('table W3 the table declares a `plain` cell'),
      'W3 must not pass by having nothing to check itself on',
    );
  });

  it('catches an easier power economy before a player would notice it (§14.6)', () => {
    // Every "kinder" direction spends the B3 margin. This one keeps B3 itself
    // true — 1.00 < 1.03 s — and still fails, which is the point of W4.
    const sweep = sweepOf({
      id: 'bad-generous-lamp',
      kind: 'multiplier',
      constant: 'POWER_RECHARGE_RATE',
      values: [1.2],
    });
    const failures = failuresOf(sweep);

    assert.ok(
      failures.includes('bad-generous-lamp x1.20 W4 B3 keeps the §14.6 margin'),
      'a weekly modifier must not quietly buy a good player an unbounded run',
    );
    assert.ok(
      !failures.includes('bad-generous-lamp x1.20 B3 asymptote invariant'),
      'B3 itself still holds here, which is why §14.6 states a margin rather than a sign',
    );
  });
});

describe('weekly modifier sweep — invocation (§14.9)', () => {
  it('is off unless --modifiers is passed, and sweeps the whole tier table', () => {
    assert.equal(buildInvocation([]).modifiers, false);
    assert.equal(buildInvocation(['--modifiers']).modifiers, true);
    assert.equal(buildInvocation(['--modifiers']).calibrated, false);
    assert.throws(() => buildInvocation(['--modifiers', '--tier', 'expert']), /takes no --tier/);
    assert.throws(
      () => buildInvocation(['--modifiers', '--tier', 'expert', '--backlog', '4.2']),
      /takes no --tier/,
    );
  });

  it('leaves plain `npm run sim` at the shipped config and the criterion-2 window', () => {
    const invocation = buildInvocation([]);

    assert.deepEqual(invocation.options.config, BASE_TUNING);
    assert.equal(FIRST_TIMER_RUN_WINDOW.min, 45);
    assert.equal(FIRST_TIMER_RUN_WINDOW.max, 120);
    assert.equal(WEEKLY_CELL_RUN_WINDOW.min, 55);
    assert.equal(WEEKLY_CELL_RUN_WINDOW.max, 110);
  });

  it('is deterministic (§6)', () => {
    assert.deepEqual(sweepModifiers(SWEEP), sweepModifiers(SWEEP));
  });
});
