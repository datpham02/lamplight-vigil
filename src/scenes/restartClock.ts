// src/scenes owns the scenes and their wiring. This file is the stopwatch for
// `docs/vision.md` §6 criterion 1 and `docs/design.md` §12 criterion 8: one
// keypress from the game-over screen to the first playable frame, in at most
// RESTART_BUDGET_SECONDS, measured from the moment of death.
//
// The criterion says to measure it, so the game measures it. The alternative —
// asserting the restart is fast because the code looks fast — is exactly the
// kind of claim that turns out to be wrong on someone else's hardware. The clock
// takes timestamps from the scene's own frame clock, so what it reports is what
// the player actually waited, including the lockout and the frames either side
// of it.
//
// No Phaser import, so the arithmetic can be stepped in a test.

import {
  GAME_OVER_INPUT_LOCKOUT,
  MS_PER_SECOND,
  RESTART_BUDGET_FRAMES,
  RESTART_BUDGET_SECONDS,
} from '../config/index';

/** One measured restart. Both numbers are milliseconds. */
export interface RestartMeasurement {
  /**
   * Death to first playable frame. This is the number the criterion is about:
   * §2.3 is explicit that QA measures from the moment of death, so the
   * GAME_OVER_INPUT_LOCKOUT is inside it and not an excuse beside it.
   */
  readonly fromDeathMs: number;
  /**
   * Keypress to first playable frame. Smaller than `fromDeathMs` by however
   * much of the lockout was left when the player pressed. Reported because it is
   * what the player experiences as the cost of the key, and because the gap
   * between the two numbers is the lockout doing its job.
   */
  readonly fromPressMs: number;
}

/**
 * The worst case the restart path can cost, in seconds, at a given frame time.
 *
 * Death and press on the same frame is the worst case: the whole lockout is
 * paid, then RESTART_BUDGET_FRAMES — one to notice the buffered press when the
 * lockout expires, one to present the rebuilt world. Nothing else is on the
 * path. The scene never calls `scene.restart()`, every texture was baked at
 * boot, and `startRun()` allocates nothing but rewinds counters and empties an
 * array, so there is no load and no object construction to budget for.
 *
 * Exported so the test can hold the shipped constants to the shipped budget: if
 * someone raises GAME_OVER_INPUT_LOCKOUT past what criterion 1 allows, that
 * fails a test rather than a playtest.
 */
export function worstCaseRestartSeconds(frameSeconds: number): number {
  return GAME_OVER_INPUT_LOCKOUT + RESTART_BUDGET_FRAMES * frameSeconds;
}

/** Whether a worst case at this frame time fits criterion 1's budget. */
export function fitsRestartBudget(frameSeconds: number): boolean {
  return worstCaseRestartSeconds(frameSeconds) <= RESTART_BUDGET_SECONDS;
}

/**
 * Times death -> first playable frame across a restart.
 *
 * Deliberately inert outside that window: a run started from TITLE has no death
 * to measure from, and nothing here is allowed to affect the restart it is
 * timing. Every method is a field assignment.
 */
export class RestartClock {
  private deathMs: number | null = null;
  private pressMs: number | null = null;
  private awaitingFirstFrame = false;
  private lastValue: RestartMeasurement | null = null;

  /** The most recent completed measurement, or null if none has finished. */
  public get last(): RestartMeasurement | null {
    return this.lastValue;
  }

  /** Entry to GAME_OVER. Starts the clock. */
  public markDeath(nowMs: number): void {
    this.deathMs = nowMs;
    this.pressMs = null;
    this.awaitingFirstFrame = false;
  }

  /**
   * The first accepted restart press, whether or not the lockout has expired —
   * §2.3 buffers a press made inside it, and a buffered press is still the press
   * the player made.
   */
  public markRestartPressed(nowMs: number): void {
    if (this.deathMs !== null && this.pressMs === null) {
      this.pressMs = nowMs;
    }
  }

  /**
   * Entry to PLAYING. Arms the clock for the next frame, which is the first one
   * the player can act on.
   */
  public markRunStarted(): void {
    this.awaitingFirstFrame = this.deathMs !== null;
  }

  /**
   * The first frame of the new run. Returns the measurement, or null if this was
   * not a restart (a run from TITLE) or one has already been taken.
   *
   * Taking the following frame's timestamp rather than this one's overstates the
   * result by up to one frame: the rebuilt world is presented at the end of the
   * tick that called `markRunStarted`. The criterion is a ceiling, so the clock
   * errs upward on purpose — a number that is pessimistic by 16 ms is worth more
   * than one that needs a footnote.
   */
  public markFirstPlayableFrame(nowMs: number): RestartMeasurement | null {
    const death = this.deathMs;
    if (!this.awaitingFirstFrame || death === null) {
      return null;
    }

    const measurement: RestartMeasurement = {
      fromDeathMs: nowMs - death,
      fromPressMs: nowMs - (this.pressMs ?? death),
    };

    this.awaitingFirstFrame = false;
    this.deathMs = null;
    this.pressMs = null;
    this.lastValue = measurement;

    return measurement;
  }

  /** Whether a measurement met criterion 1. */
  public static withinBudget(measurement: RestartMeasurement): boolean {
    return measurement.fromDeathMs <= RESTART_BUDGET_SECONDS * MS_PER_SECOND;
  }
}
