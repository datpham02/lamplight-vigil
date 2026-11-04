// docs/vision.md §6 criterion 1 and docs/design.md §12 criterion 8: one keypress
// from the game-over screen to the first playable frame, in at most
// RESTART_BUDGET_SECONDS, measured from the moment of death.
//
// The first suite is the one that matters for the criterion: it holds the
// shipped constants to the shipped budget, so raising GAME_OVER_INPUT_LOCKOUT
// past what pillar 3 allows fails here instead of failing a playtest. The second
// is the stopwatch the running game reports its real number with.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GAME_OVER_INPUT_LOCKOUT,
  MS_PER_SECOND,
  RESTART_BUDGET_FRAMES,
  RESTART_BUDGET_SECONDS,
} from '../config/index';
import { fitsRestartBudget, RestartClock, worstCaseRestartSeconds } from './restartClock';

/** The frame time criterion 3 holds the game to. */
const FRAME_60 = 1 / 60;

/** The floor criterion 3 allows — "no frame under 30 fps". */
const FRAME_30 = 1 / 30;

describe('the restart budget (vision.md §6 criterion 1)', () => {
  it('fits at 60 fps, with room to spare', () => {
    const worst = worstCaseRestartSeconds(FRAME_60);

    assert.ok(
      worst <= RESTART_BUDGET_SECONDS,
      `worst case ${worst}s exceeds the ${RESTART_BUDGET_SECONDS}s budget`,
    );
    assert.equal(fitsRestartBudget(FRAME_60), true);
  });

  it('still fits at the 30 fps floor criterion 3 allows', () => {
    assert.equal(
      fitsRestartBudget(FRAME_30),
      true,
      'a restart on the worst frame the game may ship is still inside the budget',
    );
  });

  it('is almost entirely the lockout, which is the comfort value §2.3 allows', () => {
    const worst = worstCaseRestartSeconds(FRAME_60);

    assert.ok(
      GAME_OVER_INPUT_LOCKOUT / worst > 0.8,
      'if this stops being true the restart path itself has grown something',
    );
  });

  it('is what it says: the lockout plus RESTART_BUDGET_FRAMES frames', () => {
    assert.equal(
      worstCaseRestartSeconds(FRAME_60),
      GAME_OVER_INPUT_LOCKOUT + RESTART_BUDGET_FRAMES * FRAME_60,
    );
  });
});

describe('the restart stopwatch (GAM-12)', () => {
  it('measures death to first playable frame, lockout included', () => {
    const clock = new RestartClock();

    clock.markDeath(1000);
    clock.markRestartPressed(1100);
    clock.markRunStarted();
    const measured = clock.markFirstPlayableFrame(1283);

    assert.ok(measured, 'a restart was measured');
    assert.equal(measured.fromDeathMs, 283);
    assert.equal(measured.fromPressMs, 183, 'and separately, what the key cost');
    assert.equal(RestartClock.withinBudget(measured), true);
  });

  it('charges the whole gap to the press when the player never pressed', () => {
    // Not reachable in play — a restart needs a press — but the fallback must
    // not report a nonsense number if the two ever come apart.
    const clock = new RestartClock();

    clock.markDeath(500);
    clock.markRunStarted();
    const measured = clock.markFirstPlayableFrame(700);

    assert.equal(measured?.fromDeathMs, 200);
    assert.equal(measured?.fromPressMs, 200);
  });

  it('keeps the first press of a burst, not the last', () => {
    const clock = new RestartClock();

    clock.markDeath(0);
    clock.markRestartPressed(50);
    clock.markRestartPressed(90);
    clock.markRunStarted();

    assert.equal(clock.markFirstPlayableFrame(260)?.fromPressMs, 210, 'the press that counted');
  });

  it('measures nothing for a run started from TITLE', () => {
    const clock = new RestartClock();

    clock.markRunStarted();

    assert.equal(clock.markFirstPlayableFrame(16), null, 'there was no death to measure from');
    assert.equal(clock.last, null);
  });

  it('measures each restart once, and remembers the last', () => {
    const clock = new RestartClock();

    clock.markDeath(0);
    clock.markRunStarted();
    assert.notEqual(clock.markFirstPlayableFrame(300), null);
    assert.equal(clock.markFirstPlayableFrame(316), null, 'frame two is not another restart');

    assert.equal(clock.last?.fromDeathMs, 300);
  });

  it('calls a restart over budget when it is over budget', () => {
    // The stopwatch must be able to fail. A measurement that can only ever pass
    // is not a measurement.
    const overBudget = RESTART_BUDGET_SECONDS * MS_PER_SECOND + 1;
    const clock = new RestartClock();

    clock.markDeath(0);
    clock.markRunStarted();
    const measured = clock.markFirstPlayableFrame(overBudget);

    assert.ok(measured);
    assert.equal(RestartClock.withinBudget(measured), false);
  });
});
