// src/beam owns the player's light: aiming, width control and power drain.
//
// This file is the simulation half of the beam — the §3.1 state machine, the §3.2
// geometry test and the §4 power economy of `docs/design.md`. It deliberately
// imports nothing from Phaser so that the rules can be stepped and asserted on
// without a renderer (see BeamModel.test.ts). Beam.ts is the rendering and input
// half and owns one of these.

import {
  BEAM_FOCUS_ALPHA,
  BEAM_GLOW_ALPHA_FOCUS,
  BEAM_GLOW_ALPHA_WIDE,
  BEAM_GLOW_SCALE_FOCUS,
  BEAM_GLOW_SCALE_WIDE,
  BEAM_REST_ANGLE_RAD,
  BEAM_WIDE_ALPHA,
  LAMP_X,
  LAMP_Y,
  POWER_FOCUS_REARM,
  POWER_MAX,
  POWER_START,
  beamFocusHalfAngleRad,
  beamWideHalfAngleRad,
} from '../config/index';
import { BASE_TUNING, type BeamTuning } from '../config/tuning';
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
 *
 * Every number a §14.5 modifier can move — the cone angle, the ranges, the
 * transition, the two power rates — comes from the run's config (§14.9's
 * override surface) rather than from a module-level import, so a weekly modifier
 * actually reaches the beam. `BASE_TUNING` is Free Play: the shipped values,
 * exactly as committed (§14.8). The constants §14.7 fences off as never-weekly —
 * `POWER_MAX`, `POWER_START`, `POWER_FOCUS_REARM` and the fill alphas — are
 * still imported from `src/config`, because a run may not move them.
 */
export class BeamModel {
  /**
   * The run's numbers. Replaced only by `reset`, which is the transition to
   * PLAYING — §14.2 resolves a week once there and holds it for the whole run,
   * and nothing below this line may read it a second time.
   */
  private config: BeamTuning = BASE_TUNING;

  /**
   * The §3.2 half-angles for `config`, re-derived only when it is replaced.
   *
   * Cached per *run* rather than at module load, which is the point of GAM-44:
   * `BEAM_WIDE_ANGLE_DEG` is a §14.5 entry, so the modifier has to be applied
   * before this derivation. They are cached at all because `containsPoint` reads
   * `halfAngleRad` once per crawler per frame, and `rebuildCone` draws the cone
   * from the same getter — one number, so the lit cone and the drawn cone cannot
   * disagree.
   */
  private wideHalfAngleRadValue = beamWideHalfAngleRad(BASE_TUNING);
  private focusHalfAngleRadValue = beamFocusHalfAngleRad(BASE_TUNING);

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

  /**
   * @param config The numbers this beam plays at. Defaulted to the shipped
   * values so a beam built outside a run — in `create()`, before the first
   * `reset`, or in a test — behaves exactly as it did before OV-2.
   */
  public constructor(config: BeamTuning = BASE_TUNING) {
    this.adoptConfig(config);
  }

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

  /**
   * Half of the current cone angle, radians.
   *
   * The one number both halves of §3.2 are decided by: `Beam.rebuildCone` draws
   * the cone from `-halfAngleRad` to `+halfAngleRad`, and `containsPoint` below
   * freezes inside exactly that. Read it; never re-derive it from a constant.
   */
  public get halfAngleRad(): number {
    return lerp(this.wideHalfAngleRadValue, this.focusHalfAngleRadValue, this.widthValue);
  }

  /** Current reach from the lamp centre, px. */
  public get range(): number {
    return lerp(this.config.BEAM_WIDE_RANGE, this.config.BEAM_FOCUS_RANGE, this.widthValue);
  }

  /** Current fill alpha. Focused is brighter as well as narrower (§3.2). */
  public get alpha(): number {
    return lerp(BEAM_WIDE_ALPHA, BEAM_FOCUS_ALPHA, this.widthValue);
  }

  /**
   * Alpha of the bloom baked at the beam's mouth. Like `alpha`, this is a
   * rendering quantity derived from the width parameter and nothing else, which
   * is why it lives with the other width-driven derivations rather than in the
   * renderer: it moves continuously with the width and can be asserted on
   * without a canvas.
   */
  public get glowAlpha(): number {
    return lerp(BEAM_GLOW_ALPHA_WIDE, BEAM_GLOW_ALPHA_FOCUS, this.widthValue);
  }

  /**
   * Scale of that bloom. Focusing pulls the light into a smaller, brighter
   * source; widening spreads it back out. Purely cosmetic — no part of §3.2's
   * geometry test reads it, so the glow can never disagree with what is lit.
   */
  public get glowScale(): number {
    return lerp(BEAM_GLOW_SCALE_WIDE, BEAM_GLOW_SCALE_FOCUS, this.widthValue);
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
   * @param config The numbers the *next* run is played at (§14.8). Omit it to
   * keep the current ones, which is what `R` from game-over wants: it restarts
   * the mode just played, and the restart path never grows a step.
   */
  public reset(angleRad: number, focusHeldNow: boolean, config?: BeamTuning): void {
    if (config !== undefined) {
      this.adoptConfig(config);
    }

    this.angleRadValue = angleRad;
    this.widthValue = 0;
    this.powerValue = POWER_START;
    this.stateValue = BEAM_STATE.WIDE;
    this.heldFocusIgnored = focusHeldNow;
    this.focusLockedOutValue = false;
  }

  /**
   * Re-arms the §2.2 edge trigger without resetting anything else.
   *
   * `reset` applies that rule on entry to PLAYING. This applies the same rule
   * at the other moment the game starts reading the focus input again: coming
   * off a §2.5 pause, where the click or key that resumed the run is very often
   * a focus binding and must not count as a hold. Power, width and the lockout
   * are left exactly where the pause froze them — a pause gives nothing back.
   */
  public disarmHeldFocus(focusHeldNow: boolean): void {
    this.heldFocusIgnored = focusHeldNow;
  }

  /**
   * Takes a run's numbers and derives the §3.2 half-angles from them, in that
   * order. The only place either half-angle is computed.
   */
  private adoptConfig(config: BeamTuning): void {
    this.config = config;
    this.wideHalfAngleRadValue = beamWideHalfAngleRad(config);
    this.focusHalfAngleRadValue = beamFocusHalfAngleRad(config);
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
      this.powerValue = Math.max(0, this.powerValue - this.config.POWER_DRAIN_RATE * deltaSeconds);
      if (this.powerValue === 0) {
        // §4.2 — zero power ends the ability to burn, never the run. The beam is
        // forced out of NARROWING/FOCUSED into WIDENING whether or not the input
        // is still held.
        this.focusLockedOutValue = true;
        wantsFocus = false;
      }
    } else {
      this.powerValue = Math.min(
        POWER_MAX,
        this.powerValue + this.config.POWER_RECHARGE_RATE * deltaSeconds,
      );
    }

    const widthStep = deltaSeconds / this.config.BEAM_TRANSITION_TIME;
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
