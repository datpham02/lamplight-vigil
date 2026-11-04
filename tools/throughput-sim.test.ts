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
import {
  DEFAULT_DT,
  DEFAULT_HORIZON,
  DEFAULT_STEP,
  SKILL_TIERS,
  buildInvocation,
  checkAcceptance,
  simulate,
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
