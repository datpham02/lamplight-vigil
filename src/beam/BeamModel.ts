// src/beam owns the player's light: aiming, width control and power drain.
//
// This file is the simulation half of the beam — the §3.1 state machine, the §3.2
// geometry test and the §4 power economy of `docs/design.md`. It deliberately
// imports nothing from Phaser so that the rules can be stepped and asserted on
// without a renderer (see BeamModel.test.ts). Beam.ts is the rendering and input
// half and owns one of these.

import {
  BEAM_FOCUS_ALPHA,
  BEAM_FOCUS_HALF_ANGLE_RAD,
  BEAM_FOCUS_RANGE,
  BEAM_REST_ANGLE_RAD,
  BEAM_TRANSITION_TIME,
  BEAM_WIDE_ALPHA,
  BEAM_WIDE_HALF_ANGLE_RAD,
  BEAM_WIDE_RANGE,
  LAMP_X,
  LAMP_Y,
  POWER_DRAIN_RATE,
  POWER_FOCUS_REARM,
  POWER_MAX,
  POWER_RECHARGE_RATE,
  POWER_START,
} from '../config/index';
import { BEAM_STATE, type BeamState } from '../scenes/events';

/** Linear interpolation between the wide and focused values of a quantity. */
function lerp(wide: number, focused: number, width: number): number {
  return wide + (focused - wide) * width;
}

/**
 * Smallest absolute angle between two bearings, in radians, wrapping correctly
 * across +/-pi. `atan2(sin d, cos d)` is the wrap; `abs` makes it a distance.
 */
function angularDistance(a: number, b: number): number {
  const d = a - b;
  return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
}

/**
 * The beam as rules rather than pixels.
 *
 * Width is a continuous parameter `w` in [0, 1]: 0 is fully wide, 1 is fully
 * focused. Cone half-angle, reach and alpha all interpolate linearly on it, so
 * releasing focus mid-narrow reverses from wherever the beam is instead of
 * snapping (§3.1).
 */
export class BeamModel {
  private angleRadValue = BEAM_REST_ANGLE_RAD;
  private widthValue = 0;
  private powerValue = POWER_START;
  private stateValue: BeamState = BEAM_STATE.WIDE;

  /**
   * §2.2 — a focus input already held at the moment PLAYING is entered does not
   * count as a hold. The click that starts a run is itself a focus binding, so
   * without this the run opens with the beam narrowing and power draining before
   * the player has seen the arena. Cleared the first frame the input is not held.
   */
  private heldFocusIgnored = false;

  /**
   * §4.2 — set when power bottoms out, cleared at POWER_FOCUS_REARM. While set,
   * the focus input is ignored; when it clears, a player still holding the key
   * resumes narrowing with no re-press. That is deliberate and is not the same
   * rule as `heldFocusIgnored` above: there the player never pressed at all.
   */
  private focusLockedOutValue = false;

  /** Current aim, radians, in render space. */
  public get angleRad(): number {
    return this.angleRadValue;
  }

  /** Width parameter: 0 fully wide, 1 fully focused. */
  public get width(): number {
    return this.widthValue;
  }

  public get power(): number {
    return this.powerValue;
  }

  public get state(): BeamState {
    return this.stateValue;
  }

  /** True while §4.2's blackout is suppressing the focus input. */
  public get focusLockedOut(): boolean {
    return this.focusLockedOutValue;
  }

  /** Half of the current cone angle, radians. */
  public get halfAngleRad(): number {
    return lerp(BEAM_WIDE_HALF_ANGLE_RAD, BEAM_FOCUS_HALF_ANGLE_RAD, this.widthValue);
  }

  /** Current reach from the lamp centre, px. */
  public get range(): number {
    return lerp(BEAM_WIDE_RANGE, BEAM_FOCUS_RANGE, this.widthValue);
  }

  /** Current fill alpha. Focused is brighter as well as narrower (§3.2). */
  public get alpha(): number {
    return lerp(BEAM_WIDE_ALPHA, BEAM_FOCUS_ALPHA, this.widthValue);
  }

  /**
   * §3.1 — burn dwell accrues only in FOCUSED. Narrowing and widening light
   * freezes a crawler like any other light, but banishes nothing.
   */
  public get isBurning(): boolean {
    return this.stateValue === BEAM_STATE.FOCUSED;
  }

  /** Points the beam along a bearing from the lamp. */
  public aimAt(angleRad: number): void {
    this.angleRadValue = angleRad;
  }

  /**
   * §2.2 — per-run reset. Called on every entry to PLAYING, from TITLE and from
   * GAME_OVER alike.
   *
   * @param angleRad Where the pointer is right now, so the first frame of a
   * restart is never a beam pointing somewhere the player is not looking.
   * @param focusHeldNow Whether a focus binding is down at this instant. If it
   * is, it is disarmed until released.
   */
  public reset(angleRad: number, focusHeldNow: boolean): void {
    this.angleRadValue = angleRad;
    this.widthValue = 0;
    this.powerValue = POWER_START;
    this.stateValue = BEAM_STATE.WIDE;
    this.heldFocusIgnored = focusHeldNow;
    this.focusLockedOutValue = false;
  }

  /**
   * Advances the width parameter, the power economy and the state machine by one
   * frame of PLAYING.
   *
   * @param deltaSeconds Already clamped to DELTA_CLAMP_MS by the scene (§2.4).
   * @param focusHeld Whether either focus binding is down this frame.
   */
  public update(deltaSeconds: number, focusHeld: boolean): void {
    // Arming, before anything reads the input.
    if (this.heldFocusIgnored && !focusHeld) {
      this.heldFocusIgnored = false;
    }
    if (this.focusLockedOutValue && this.powerValue >= POWER_FOCUS_REARM) {
      this.focusLockedOutValue = false;
    }

    let wantsFocus = focusHeld && !this.heldFocusIgnored && !this.focusLockedOutValue;

    // §3.1 — power drains in NARROWING and FOCUSED, recharges in WIDENING and
    // WIDE. Both boundaries are the focus intent, not the width, so the drain
    // starts the instant the key goes down and a tap pays for its round trip.
    if (wantsFocus) {
      this.powerValue = Math.max(0, this.powerValue - POWER_DRAIN_RATE * deltaSeconds);
      if (this.powerValue === 0) {
        // §4.2 — zero power ends the ability to burn, never the run. The beam is
        // forced out of NARROWING/FOCUSED into WIDENING whether or not the input
        // is still held.
        this.focusLockedOutValue = true;
        wantsFocus = false;
      }
    } else {
      this.powerValue = Math.min(POWER_MAX, this.powerValue + POWER_RECHARGE_RATE * deltaSeconds);
    }

    const widthStep = deltaSeconds / BEAM_TRANSITION_TIME;
    this.widthValue = wantsFocus
      ? Math.min(1, this.widthValue + widthStep)
      : Math.max(0, this.widthValue - widthStep);

    if (wantsFocus) {
      this.stateValue = this.widthValue >= 1 ? BEAM_STATE.FOCUSED : BEAM_STATE.NARROWING;
    } else {
      this.stateValue = this.widthValue <= 0 ? BEAM_STATE.WIDE : BEAM_STATE.WIDENING;
    }
  }

  /**
   * §3.2 — is a point lit by the beam right now?
   *
   * The test is on the point itself, not on a crawler's radius, so the edge of
   * the cone reads exactly where it is drawn and the test is two comparisons.
   */
  public containsPoint(x: number, y: number): boolean {
    const dx = x - LAMP_X;
    const dy = y - LAMP_Y;
    const range = this.range;

    if (dx * dx + dy * dy > range * range) {
      return false;
    }

    return angularDistance(Math.atan2(dy, dx), this.angleRadValue) <= this.halfAngleRad;
  }
}
