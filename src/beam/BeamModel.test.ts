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
  beamFocusHalfAngleRad,
  beamWideHalfAngleRad,
} from '../config/index';
import { BASE_TUNING } from '../config/tuning';
import {
  WEEKLY_MODIFIERS,
  applyWeeklyModifier,
  weeklyCellLabel,
  weeklyCells,
  type WeeklyConstant,
  type WeeklyModifier,
} from '../config/weeklyModifiers';
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

describe('the same edge trigger, on resuming from a pause (design.md §2.5)', () => {
  it('ignores the click that resumed the run until it is released', () => {
    const beam = freshBeam();
    // Half a second of real burning, so there is state a reset would wipe.
    step(beam, 0.5, true);
    const powerAtPause = beam.power;

    // The player let go, the window blurred, and they came back by clicking —
    // which is also a focus binding (§7).
    beam.disarmHeldFocus(true);
    step(beam, 0.5, true);

    assert.equal(beam.state, BEAM_STATE.WIDE, 'the resume click is not a hold');
    assert.ok(beam.power > powerAtPause, 'so the beam recharges instead of draining');
  });

  it('gives nothing back: power and the lockout survive the pause', () => {
    const beam = freshBeam();
    drainToZero(beam);

    assert.equal(beam.power, 0);
    assert.equal(beam.focusLockedOut, true);

    beam.disarmHeldFocus(true);

    assert.equal(beam.power, 0, 'a pause is not a refill');
    assert.equal(beam.focusLockedOut, true, 'and not a way out of the §4.2 blackout');
  });

  it('arms again on the next real press', () => {
    const beam = freshBeam();

    beam.disarmHeldFocus(true);
    beam.update(FRAME, true);
    beam.update(FRAME, false);
    beam.update(FRAME, true);

    assert.equal(beam.state, BEAM_STATE.NARROWING);
  });

  it('a resume by keyboard, with no binding held, arms immediately', () => {
    const beam = freshBeam();

    beam.disarmHeldFocus(false);
    beam.update(FRAME, true);

    assert.equal(beam.state, BEAM_STATE.NARROWING);
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

// ---------------------------------------------------------------------------
// Game feel — GAM-12
// ---------------------------------------------------------------------------

describe('the beam glow (GAM-12)', () => {
  it('is a smaller, brighter source when focused', () => {
    const wide = freshBeam();
    const focused = freshBeam();
    step(focused, BEAM_TRANSITION_TIME, true);

    assert.ok(focused.glowAlpha > wide.glowAlpha, 'focusing concentrates the light');
    assert.ok(focused.glowScale < wide.glowScale, 'into a tighter source');
  });

  it('moves continuously with the width, like every other derived quantity', () => {
    const beam = freshBeam();
    const wideAlpha = beam.glowAlpha;

    step(beam, BEAM_TRANSITION_TIME / 2, true);
    const midAlpha = beam.glowAlpha;
    assert.ok(beam.width > 0 && beam.width < 1, 'mid-narrow');
    assert.ok(midAlpha > wideAlpha, 'the glow is already brightening');

    step(beam, BEAM_TRANSITION_TIME, true);
    assert.ok(beam.glowAlpha > midAlpha, 'and keeps brightening to fully focused');
  });

  it('reads nothing the geometry test reads, so it cannot disagree with it', () => {
    // The whole point: a glow is allowed to spill past the cone, and the cone
    // edge is where freezing starts and stops (§3.2). Changing the glow must not
    // move a single lit point.
    const beam = freshBeam();
    step(beam, BEAM_TRANSITION_TIME, true);

    const onAxis = beam.containsPoint(LAMP_X + beam.range / 2, LAMP_Y);
    const pastReach = beam.containsPoint(LAMP_X + beam.range + 1, LAMP_Y);

    assert.equal(onAxis, true);
    assert.equal(pastReach, false, 'reach is the range, not the glow');
  });
});

// ---------------------------------------------------------------------------
// A weekly modifier reaches the beam — GAM-44, design.md §14.5
// ---------------------------------------------------------------------------
//
// The bug these exist against: `BEAM_WIDE_HALF_ANGLE_RAD` was derived from
// `BEAM_WIDE_ANGLE_DEG` once at module load, so a `narrow-lantern` week drew its
// cone at the weekly angle and froze at the shipped one — light that holds
// nothing, which §14.5 calls a pillar 2 failure.

/** What a §14.5 constant does to the beam, if anything. */
type BeamEffect = 'cone' | 'power' | 'none';

/**
 * Every constant the table may touch, and what the beam reads it for.
 *
 * A `Record` over the whole `WeeklyConstant` union on purpose: widening the
 * table (§14.5 is closed, but it is edited at a block boundary) stops compiling
 * here until someone states whether the beam reads the new constant. That review
 * is exactly what the half-angle bug slipped past.
 *
 * `BURN_DWELL_TIME` is `'none'` because the *beam* does not read it — it decides
 * nothing about the cone or the power economy. `src/enemies` owns the dwell.
 */
const BEAM_EFFECT: Readonly<Record<WeeklyConstant, BeamEffect>> = {
  BEAM_WIDE_ANGLE_DEG: 'cone',
  POWER_DRAIN_RATE: 'power',
  POWER_RECHARGE_RATE: 'power',
  BURN_DWELL_TIME: 'none',
  CRAWLER_SPEED_BASE: 'none',
  SPAWN_INTERVAL_START: 'none',
  SPAWN_EDGE_WEIGHTS: 'none',
};

/** The §14.5 entry with this `id`, or a failed assertion naming it. */
function entryById(id: string): WeeklyModifier {
  const entry = WEEKLY_MODIFIERS.find((candidate) => candidate.id === id);
  assert.ok(entry !== undefined, `§14.5 has no entry ${id}`);
  return entry;
}

/** A beam reset into one cell of the table, exactly as `startRun` resets it. */
function cellBeam(entry: WeeklyModifier, valueIndex: number): BeamModel {
  const beam = new BeamModel();
  beam.reset(0, false, applyWeeklyModifier(BASE_TUNING, entry, valueIndex));
  return beam;
}

/** Is a point at this bearing from the lamp, at mid-reach, lit right now? */
function litAt(beam: BeamModel, angleRad: number): boolean {
  const radius = beam.range / 2;
  return beam.containsPoint(
    LAMP_X + radius * Math.cos(angleRad),
    LAMP_Y + radius * Math.sin(angleRad),
  );
}

/**
 * Power left after a second of held focus and half a second of recovery — one
 * probe that moves under a drain modifier and under a recharge one alike.
 */
function powerAfterFocusCycle(beam: BeamModel): number {
  step(beam, 1, true);
  step(beam, 0.5, false);
  return beam.power;
}

describe('a weekly modifier reaches the beam (§14.5)', () => {
  it('Free Play is the shipped beam (§14.8)', () => {
    const beam = freshBeam();

    assert.equal(beam.halfAngleRad, beamWideHalfAngleRad(BASE_TUNING));
    assert.equal(beam.range, BEAM_WIDE_RANGE);
  });

  it('the plain cell reproduces it exactly (W3)', () => {
    const plain = cellBeam(entryById('plain'), 0);
    const shipped = freshBeam();

    assert.equal(plain.halfAngleRad, shipped.halfAngleRad);
    assert.equal(plain.range, shipped.range);
    assert.equal(powerAfterFocusCycle(plain), powerAfterFocusCycle(shipped));
  });

  for (const { entry, valueIndex } of weeklyCells()) {
    const label = weeklyCellLabel(entry, valueIndex);
    const effect = BEAM_EFFECT[entry.constant];

    it(`draws and freezes one cone under ${label}`, () => {
      const config = applyWeeklyModifier(BASE_TUNING, entry, valueIndex);
      const beam = cellBeam(entry, valueIndex);

      // The angle `Beam.rebuildCone` draws the cone at — it slices from
      // -halfAngleRad to +halfAngleRad — derived from *this cell's* config.
      assert.equal(beam.halfAngleRad, beamWideHalfAngleRad(config), 'the drawn wide cone');

      // And the angle §3.2's freeze test uses, probed either side of the drawn
      // edge. Identical by construction now, and that is the point: with the
      // half-angle derived at module load these disagreed under narrow-lantern.
      assert.equal(litAt(beam, beam.halfAngleRad * 0.999), true, 'inside the drawn cone: lit');
      assert.equal(litAt(beam, beam.halfAngleRad * 1.001), false, 'outside it: not lit');

      // The same, at the other end of the §3.1 interpolation. The half-angle is
      // compared to within a float's width rather than bit-exactly: at `w = 1`
      // the lerp is `wide + (focus - wide)`, which is the focused angle to 1 ULP
      // and not required to be the same double. What *is* exact — and what
      // pillar 2 rests on — is that one number is both drawn and frozen with,
      // which is what the two probes either side of it assert.
      step(beam, BEAM_TRANSITION_TIME, true);
      assert.ok(
        Math.abs(beam.halfAngleRad - beamFocusHalfAngleRad(config)) < 1e-12,
        'and the focused cone',
      );
      assert.equal(litAt(beam, beam.halfAngleRad * 0.999), true, 'inside the focused cone: lit');
      assert.equal(litAt(beam, beam.halfAngleRad * 1.001), false, 'outside it: not lit');
    });

    it(`moves what §14.5 says it moves, and nothing else: ${label}`, () => {
      const beam = cellBeam(entry, valueIndex);
      const shipped = freshBeam();

      if (effect === 'cone') {
        assert.notEqual(beam.halfAngleRad, shipped.halfAngleRad, 'the cone moved');

        // Which way, and whether the freeze moved with it: a point just inside
        // the shipped wide cone is lit under a broader lantern and dark under a
        // narrower one.
        const justInsideShipped = shipped.halfAngleRad * 0.999;
        const broader = beam.halfAngleRad > shipped.halfAngleRad;

        assert.equal(litAt(shipped, justInsideShipped), true, 'lit at the shipped angle');
        assert.equal(litAt(beam, justInsideShipped), broader, 'and only still lit if broader');
        assert.equal(
          broader,
          entry.kind === 'multiplier' && (entry.values[valueIndex] ?? 1) > 1,
          'in the direction the cell states',
        );
      } else {
        assert.equal(beam.halfAngleRad, shipped.halfAngleRad, 'the cone is the shipped cone');
      }

      const cellPower = powerAfterFocusCycle(beam);
      const shippedPower = powerAfterFocusCycle(shipped);

      if (effect === 'power') {
        assert.notEqual(cellPower, shippedPower, 'the power economy moved');
      } else {
        assert.equal(cellPower, shippedPower, 'the power economy is the shipped one');
      }
    });
  }

  it('a restart keeps the run it was already playing (§14.8)', () => {
    const beam = cellBeam(entryById('narrow-lantern'), 0);
    const cone = beam.halfAngleRad;

    // `R` from game-over: no mode prompt, and no second resolution of the week.
    beam.reset(0, false);

    assert.equal(beam.halfAngleRad, cone);
  });

  it('resolving a cell does not retune the shipped config', () => {
    const before = { ...BASE_TUNING };
    cellBeam(entryById('narrow-lantern'), 1);

    assert.deepEqual({ ...BASE_TUNING }, before);
    assert.equal(freshBeam().halfAngleRad, beamWideHalfAngleRad(BASE_TUNING));
  });
});
