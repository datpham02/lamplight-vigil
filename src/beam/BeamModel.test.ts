// The §3 and §4 rules of docs/design.md, asserted without a renderer.
//
// Run with `npm test`. BeamModel imports no Phaser, which is why these can be
// stepped at a fixed delta instead of being played by hand.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BEAM_FOCUS_RANGE,
  BEAM_TRANSITION_TIME,
  BEAM_WIDE_RANGE,
  LAMP_X,
  LAMP_Y,
  POWER_DRAIN_RATE,
  POWER_FOCUS_REARM,
  POWER_MAX,
  POWER_START,
  RENDER_HEIGHT,
  RENDER_WIDTH,
} from '../config/index';
import { BEAM_STATE } from '../scenes/events';
import { BeamModel } from './BeamModel';

/** A 60 fps frame, the rate the game is tuned for. */
const FRAME = 1 / 60;

function step(beam: BeamModel, seconds: number, focusHeld: boolean): void {
  // Ceil, so `step(beam, BEAM_TRANSITION_TIME, true)` really does complete the
  // transition rather than stopping a fraction of a frame short of it.
  const frames = Math.ceil(seconds / FRAME);
  for (let i = 0; i < frames; i += 1) {
    beam.update(FRAME, focusHeld);
  }
}

/** Holds focus until the bar bottoms out. */
function drainToZero(beam: BeamModel): void {
  while (beam.power > 0) {
    beam.update(FRAME, true);
  }
}

/** A fresh beam aimed along +x (at the right edge), focus not held on entry. */
function freshBeam(): BeamModel {
  const beam = new BeamModel();
  beam.reset(0, false);
  return beam;
}

describe('beam state machine (design.md §3.1)', () => {
  it('starts wide and stays wide while focus is not held', () => {
    const beam = freshBeam();
    step(beam, 1, false);

    assert.equal(beam.state, BEAM_STATE.WIDE);
    assert.equal(beam.width, 0);
    assert.equal(beam.isBurning, false);
  });

  it('narrows to FOCUSED after BEAM_TRANSITION_TIME and widens back', () => {
    const beam = freshBeam();

    beam.update(FRAME, true);
    assert.equal(beam.state, BEAM_STATE.NARROWING, 'one frame in, still narrowing');
    assert.equal(beam.isBurning, false, 'narrowing light freezes but never burns');

    step(beam, BEAM_TRANSITION_TIME, true);
    assert.equal(beam.state, BEAM_STATE.FOCUSED);
    assert.equal(beam.width, 1);
    assert.equal(beam.isBurning, true);

    beam.update(FRAME, false);
    assert.equal(beam.state, BEAM_STATE.WIDENING);
    assert.equal(beam.isBurning, false, 'widening light freezes but never burns');

    step(beam, BEAM_TRANSITION_TIME, false);
    assert.equal(beam.state, BEAM_STATE.WIDE);
    assert.equal(beam.width, 0);
  });

  it('reverses from wherever it is instead of snapping', () => {
    const beam = freshBeam();
    step(beam, BEAM_TRANSITION_TIME / 2, true);

    const midWidth = beam.width;
    assert.ok(midWidth > 0 && midWidth < 1, 'mid-narrow');

    beam.update(FRAME, false);
    assert.ok(beam.width < midWidth, 'widens from the width it had reached');
    assert.ok(beam.width > 0, 'does not snap to wide');
  });
});

describe('power economy (design.md §4)', () => {
  it('does not fall from freezing alone — 30 s of wide beam (vision.md §3)', () => {
    const beam = freshBeam();
    step(beam, 30, false);

    assert.equal(beam.power, POWER_START);
    assert.equal(beam.state, BEAM_STATE.WIDE);
  });

  it('drains from the instant the key goes down, not when narrowing finishes', () => {
    const beam = freshBeam();
    beam.update(FRAME, true);

    assert.ok(beam.power < POWER_START, 'draining while still NARROWING');
    assert.ok(Math.abs(POWER_START - beam.power - POWER_DRAIN_RATE * FRAME) < 1e-9);
  });

  it('recharges on release and clamps at POWER_MAX', () => {
    const beam = freshBeam();
    step(beam, 1, true);
    const spent = beam.power;
    assert.ok(spent < POWER_START);

    step(beam, 1, false);
    assert.ok(beam.power > spent, 'recovers on release');

    step(beam, 60, false);
    assert.equal(beam.power, POWER_MAX, 'clamped at the maximum');
  });

  it('a tap pays for the round trip and banks no burn time', () => {
    const beam = freshBeam();

    beam.update(FRAME, true);
    beam.update(FRAME, false);

    assert.notEqual(beam.state, BEAM_STATE.FOCUSED, 'never reached FOCUSED');
    assert.ok(beam.power < POWER_START, 'still paid power for the trip');
  });
});

describe('zero power and the rearm threshold (design.md §4.2)', () => {
  it('ends the ability to burn, not the run, and forces the beam open', () => {
    const beam = freshBeam();
    drainToZero(beam);

    assert.equal(beam.power, 0);
    assert.equal(beam.focusLockedOut, true);
    assert.equal(beam.isBurning, false, 'cannot burn at zero power');

    // Still held: the beam must widen anyway rather than flicker at the floor.
    step(beam, BEAM_TRANSITION_TIME, true);
    assert.equal(beam.state, BEAM_STATE.WIDE);
    assert.equal(beam.width, 0);
  });

  it('recharges to POWER_FOCUS_REARM while the key is still held', () => {
    const beam = freshBeam();
    drainToZero(beam);
    assert.equal(beam.power, 0);

    // Never released. §4.2 step 3: focus arms again at the threshold with no
    // re-press, and §2.2's edge trigger must not leak into this.
    while (beam.power < POWER_FOCUS_REARM) {
      beam.update(FRAME, true);
    }
    beam.update(FRAME, true);

    assert.equal(beam.focusLockedOut, false, 'armed again at the threshold');
    assert.equal(beam.state, BEAM_STATE.NARROWING, 'resumes under the held key');
  });
});

describe('focus is edge-triggered on entry to PLAYING (design.md §2.2)', () => {
  it('ignores a focus input already held at the moment of entry', () => {
    const beam = new BeamModel();
    beam.reset(0, true);

    step(beam, 1, true);

    assert.equal(beam.state, BEAM_STATE.WIDE, 'the run never opens narrowing');
    assert.equal(beam.power, POWER_START, 'and never opens draining');
  });

  it('arms once the input is released and pressed again', () => {
    const beam = new BeamModel();
    beam.reset(0, true);

    step(beam, 1, true);
    beam.update(FRAME, false);
    beam.update(FRAME, true);

    assert.equal(beam.state, BEAM_STATE.NARROWING);
    assert.ok(beam.power < POWER_START);
  });
});

describe('beam geometry (design.md §3.2)', () => {
  const halfDiagonal = Math.hypot(RENDER_WIDTH / 2, RENDER_HEIGHT / 2);

  it('focused reaches the corners; wide does not reach the side edges', () => {
    assert.ok(BEAM_FOCUS_RANGE > halfDiagonal, 'focused clears the half-diagonal');
    assert.ok(BEAM_WIDE_RANGE < RENDER_WIDTH / 2, 'wide falls short of the side edges');
  });

  it('a crawler on the side edge cannot be frozen, only burned', () => {
    const beam = freshBeam();
    const onRightEdge = RENDER_WIDTH;

    assert.equal(beam.containsPoint(onRightEdge, LAMP_Y), false, 'out of wide reach');

    step(beam, BEAM_TRANSITION_TIME, true);
    assert.equal(beam.containsPoint(onRightEdge, LAMP_Y), true, 'inside focused reach');
  });

  it('covers the wide cone and nothing outside it', () => {
    const beam = freshBeam();
    const radius = BEAM_WIDE_RANGE / 2;
    const halfAngle = beam.halfAngleRad;

    const inside = halfAngle * 0.9;
    const outside = halfAngle * 1.1;

    assert.equal(
      beam.containsPoint(LAMP_X + radius * Math.cos(inside), LAMP_Y + radius * Math.sin(inside)),
      true,
    );
    assert.equal(
      beam.containsPoint(LAMP_X + radius * Math.cos(outside), LAMP_Y + radius * Math.sin(outside)),
      false,
    );
    assert.equal(beam.containsPoint(LAMP_X - radius, LAMP_Y), false, 'behind the lamp');
  });

  it('focused is narrower, longer and brighter than wide', () => {
    const wide = freshBeam();
    const focused = freshBeam();
    step(focused, BEAM_TRANSITION_TIME, true);

    assert.ok(focused.halfAngleRad < wide.halfAngleRad);
    assert.ok(focused.range > wide.range);
    assert.ok(focused.alpha > wide.alpha, 'it reads as concentration, not weakness');
  });
});
