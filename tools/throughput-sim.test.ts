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

import { SCORE_PER_BANISH, SHIPPED_RUN_CONFIG, type WeeklyModifier } from '../src/config/index';
import { applyWeeklyModifier, type ModifierCell } from '../src/weekly/index';
import {
  DEFAULT_DT,
  DEFAULT_HORIZON,
  DEFAULT_STEP,
  SKILL_TIERS,
  buildInvocation,
  checkAcceptance,
  checkCell,
  simulate,
  sweepModifiers,
  type SimulationResult,
} from './throughput-sim';

const SHIPPED = {
  dt: DEFAULT_DT,
  horizon: DEFAULT_HORIZON,
  step: DEFAULT_STEP,
  tiers: SKILL_TIERS,
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

describe('throughput simulation — the weekly modifier sweep (design.md §14.9)', () => {
  const swept = sweepModifiers(SHIPPED);

  it('leaves the base run exactly as it was, which is the whole regression', () => {
    // §14.9: the override surface "must not change shipped behaviour at the base
    // config — the existing npm run sim output and CrawlerField.test.ts are the
    // regression". Passing the shipped config explicitly must be the same run as
    // not passing one at all.
    const implicit = simulate(SHIPPED);
    const explicit = simulate({ ...SHIPPED, config: SHIPPED_RUN_CONFIG });

    assert.deepEqual(explicit.landmarks, implicit.landmarks);
    assert.deepEqual(explicit.tiers, implicit.tiers);
    assert.deepEqual(explicit.rows, implicit.rows);
  });

  it('sweeps all fifteen cells of the §14.5 table', () => {
    assert.equal(swept.length, 15);
    assert.deepEqual(swept[0]?.cell.label, 'plain x1.00');
  });

  it('passes every assertion on every cell', () => {
    const failures = swept.flatMap(({ cell, assertions }) =>
      assertions
        .filter((assertion) => !assertion.ok)
        .map((assertion) => `${cell.label}: ${assertion.name} — got ${assertion.actual}`),
    );

    assert.deepEqual(
      failures,
      [],
      'a cell outside its bound is a design question for game-designer — ' +
        'report it on the task rather than adjusting the cell (§14.9)',
    );
  });

  it('runs Group B per cell, and never Group A', () => {
    // Group A reproduces §11.1 at the shipped config and is expected to fail
    // under a modifier by design: restless-hollow x1.10 moves speedCapsAt from
    // 198 s to 153.9 s, which is the modifier working.
    for (const { cell, assertions } of swept) {
      assert.ok(
        assertions.every((assertion) => assertion.group === 'B'),
        `${cell.label} ran a Group A assertion`,
      );
      assert.ok(assertions.some((assertion) => assertion.name.startsWith('B9')));
      assert.ok(assertions.some((assertion) => assertion.name.startsWith('W1')));
      assert.ok(assertions.some((assertion) => assertion.name.startsWith('W2')));
    }

    const plain = swept.find(({ cell }) => cell.entry.id === 'plain');
    assert.ok(plain?.assertions.some((assertion) => assertion.name.startsWith('W3')));
  });

  it('couples backlogTolerance to BEAM_WIDE_ANGLE_DEG, and to nothing else (§14.6)', () => {
    // §11.1 anchors B on 360 / BEAM_WIDE_ANGLE_DEG, so the cone modifier is the
    // one entry whose run lengths may differ from the base through the tier
    // table. x0.85 and x1.15 of B = 3 are the 2.55 and 3.45 §14.6 measures.
    const narrow = swept.find(({ cell }) => cell.label === 'narrow-lantern x0.85');
    const broad = swept.find(({ cell }) => cell.label === 'narrow-lantern x1.15');
    const dwell = swept.find(({ cell }) => cell.label === 'clinging-dark x1.15');

    assert.ok(Math.abs((narrow?.result.options.tiers[0]?.backlogTolerance ?? 0) - 2.55) < 1e-9);
    assert.ok(Math.abs((broad?.result.options.tiers[0]?.backlogTolerance ?? 0) - 3.45) < 1e-9);
    assert.equal(dwell?.result.options.tiers[0]?.backlogTolerance, 3, 'every other cell keeps B');
  });

  it('reproduces the §14.5 per-cell run lengths, all fifteen', () => {
    // The figures `game-designer` published, re-derived here rather than
    // restated: if the override surface or the coupling is wrong, these move.
    const PUBLISHED: Readonly<Record<string, readonly [number, number]>> = {
      'plain x1.00': [79.1, 250.3],
      'restless-hollow x0.90': [79.1, 250.3],
      'restless-hollow x1.10': [79.1, 250.3],
      'clinging-dark x1.15': [68.7, 231.4],
      'clinging-dark x1.30': [59.9, 213.8],
      'thin-wick x0.90': [64.7, 235.6],
      'thin-wick x0.85': [57.9, 227.3],
      'hungry-flame x1.10': [66.0, 237.0],
      'hungry-flame x1.20': [55.7, 224.4],
      'crowded-threshold x0.94': [61.9, 232.7],
      'crowded-threshold x1.06': [95.7, 266.9],
      'narrow-lantern x0.85': [73.8, 245.3],
      'narrow-lantern x1.15': [83.9, 254.9],
      'one-axis long-dark': [79.1, 250.3],
      'one-axis over-the-top': [79.1, 250.3],
    };

    assert.equal(Object.keys(PUBLISHED).length, swept.length, 'fifteen rows for fifteen cells');

    for (const { cell, result } of swept) {
      const expected = PUBLISHED[cell.label];
      assert.ok(expected !== undefined, `${cell.label} is not in the §14.5 table`);

      const firstTimer = result.tiers.find((tier) => tier.tier.key === 'first-timer')?.runLength;
      const practised = result.tiers.find((tier) => tier.tier.key === 'practised')?.runLength;

      assert.ok(
        firstTimer != null && Math.abs(firstTimer - expected[0]) < 0.1,
        `${cell.label} first-timer: §14.5 publishes ${expected[0]} s, the sim says ${String(firstTimer)}`,
      );
      assert.ok(
        practised != null && Math.abs(practised - expected[1]) < 0.1,
        `${cell.label} practised: §14.5 publishes ${expected[1]} s, the sim says ${String(practised)}`,
      );
    }
  });

  it('expects the four model-invisible cells to equal plain exactly (§14.5)', () => {
    // restless-hollow and one-axis change constants the run-length model does
    // not integrate over. QA should expect those four rows to match plain; a row
    // that *differs* is the thing to report.
    const plain = swept.find(({ cell }) => cell.label === 'plain x1.00');
    const invisible = ['restless-hollow x0.90', 'restless-hollow x1.10', 'one-axis long-dark', 'one-axis over-the-top'];

    for (const label of invisible) {
      const cell = swept.find((entry) => entry.cell.label === label);
      assert.deepEqual(cell?.result.tiers, plain?.result.tiers, `${label} should read as plain`);
    }
  });

  it('fails loudly on a bad cell, naming it and the assertion (criterion 24)', () => {
    // §14.6 works this exact example: SPAWN_INTERVAL_START x1.15 is still inside
    // the 45-120 s criterion at 118.9 s and still inside the constant's own §10
    // safe range, and it fails anyway — on B5, an invariant two subsections
    // away. That is why the table needs this sweep rather than a reviewer's
    // judgement, and it is the case criterion 24 asks to be demonstrated.
    const entry: WeeklyModifier = {
      id: 'crowded-threshold',
      constant: 'SPAWN_INTERVAL_START',
      values: [],
    };
    const value = {
      kind: 'multiplier',
      id: 'x1.15',
      headline: 'A quiet threshold.',
      effect: 'They come later at first.',
      multiplier: 1.15,
    } as const;

    const config = applyWeeklyModifier(SHIPPED_RUN_CONFIG, entry, value);
    const bad: ModifierCell = { entry, value, label: 'crowded-threshold x1.15', config };

    const base = simulate({ ...SHIPPED, config: SHIPPED_RUN_CONFIG });
    const result = simulate({ ...SHIPPED, config });
    const failed = checkCell(bad, result, base).filter((assertion) => !assertion.ok);

    assert.ok(
      failed.some((assertion) => assertion.name.startsWith('B5')),
      `the floor binds at ${String(result.landmarks.floorBindsAt)} s and B5 must say so`,
    );
    assert.ok(
      failed.some((assertion) => assertion.name.startsWith('B9')),
      'and 118.9 s is outside the §14.6 band',
    );
    assert.ok(
      checkCell(bad, result, base).some(
        (assertion) => assertion.name.startsWith('W1') && assertion.ok,
      ),
      'W1 passes: 3.68 s is inside SPAWN_INTERVAL_START’s own 2.5–6.0 range, which is the point',
    );
  });
});
