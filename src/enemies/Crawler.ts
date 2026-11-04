// src/enemies owns the creatures: spawning from the edges, movement, freeze and
// burn states.
//
// One crawler, as rules rather than pixels. No Phaser import, so the freeze and
// burn resolution in docs/design.md §5.2 can be stepped and asserted on without a
// renderer. CrawlerRenderer.ts draws whatever the field is holding.

import {
  BURN_DECAY_MULTIPLIER,
  CRAWLER_RADIUS,
  FREEZE_FLASH_TIME,
  LAMP_RADIUS,
  LAMP_X,
  LAMP_Y,
} from '../config/index';
import { BASE_TUNING, type CrawlerTuning } from '../config/tuning';

/**
 * Distance at which a crawler's centre counts as touching the lamp (§5.1).
 *
 * Still derived at module load, and allowed to be: §14.7 keeps both radii out of
 * the §14.5 table deliberately, so no modifier can ever move this. The one number
 * this file reads that a week *can* move is `BURN_DWELL_TIME`, and that one comes
 * from the run's config rather than from the imports above.
 */
const CONTACT_DISTANCE = LAMP_RADIUS + CRAWLER_RADIUS;

/**
 * A single crawler: a circle that walks a straight line at the lamp, stops dead
 * while any light touches it, and burns away under a focused beam.
 *
 * The §5.2 dwell comes from the run's tuning (GAM-46). Read at module load it
 * made `clinging-dark` a label on a screen: `npm run sim` modelled the week at
 * ×1.15 or ×1.30 and the game played every week at the shipped 0.40 s, so the
 * sweep certified a week the game does not play.
 */
export class Crawler {
  public x: number;
  public y: number;

  /**
   * §5.1 — the heading is taken once at spawn and fixed for the crawler's
   * lifetime. The lamp does not move, so a straight line is also the correct
   * line, and a constant heading is a promise that where a crawler is going is
   * readable from where it has been.
   */
  private readonly headingX: number;
  private readonly headingY: number;

  /** §6.3 — per-crawler speed multiplier, drawn at spawn and fixed. */
  private readonly speedFactor: number;

  /**
   * The run's numbers, taken at spawn and fixed for this crawler's lifetime.
   *
   * §14.2 resolves a week once, at the transition to PLAYING, and `CrawlerField`
   * holds that record for the whole run — so every crawler it spawns is handed
   * the same one, and a crawler's dwell cannot drift from the week it spawned in.
   */
  private readonly config: CrawlerTuning;

  private dwell = 0;
  private litValue = false;

  /**
   * Feedback state (GAM-12). Neither of these changes a rule: a crawler freezes,
   * burns and dies exactly when §5.2 says it does whether or not anything is
   * drawn from them. They exist so the catch has a moment and a sound, instead
   * of only a colour that was already there.
   */
  private wasLit = false;
  private frozeThisFrame = false;
  private freezeFlashLeft = 0;

  /**
   * @param config The numbers this crawler plays at (§14.9's override surface).
   * Defaulted to the shipped values so a crawler built outside a run — in a test,
   * or by a caller that predates OV-2 — behaves exactly as it did before. Every
   * crawler the game makes is spawned by `CrawlerField`, which always passes the
   * run's own record.
   */
  public constructor(
    x: number,
    y: number,
    speedFactor: number,
    config: CrawlerTuning = BASE_TUNING,
  ) {
    this.x = x;
    this.y = y;
    this.speedFactor = speedFactor;
    this.config = config;

    const dx = LAMP_X - x;
    const dy = LAMP_Y - y;
    const distance = Math.hypot(dx, dy);
    this.headingX = dx / distance;
    this.headingY = dy / distance;
  }

  /** True while the beam is on it. Frozen and lit are the same thing (§5.2). */
  public get isFrozen(): boolean {
    return this.litValue;
  }

  /**
   * True only on the frame the light first reached this crawler. The hook the
   * freeze confirmation hangs off: it fires on the transition, not on the state,
   * so holding a beam on a crawler for ten seconds is one catch, not ten.
   */
  public get justFroze(): boolean {
    return this.frozeThisFrame;
  }

  /**
   * The catch flash, 1 on the frame of the catch and falling to 0 over
   * FREEZE_FLASH_TIME. Cosmetic: it outlives nothing and gates nothing, and a
   * crawler released before it expires keeps playing it out as it walks.
   */
  public get freezeFlash(): number {
    return this.freezeFlashLeft / FREEZE_FLASH_TIME;
  }

  /**
   * Burn progress in [0, 1]. Pillar 2 requires this to be visible (§5.2).
   *
   * Against the run's dwell, which is the same number `advance` banishes on: the
   * arc `CrawlerRenderer` sweeps from this is a promise about when the crawler
   * dies, and under `clinging-dark` a full arc that banished nothing — or a
   * banish at three-quarters of one — would be exactly the pillar 2 failure
   * §14.5 names for the beam's cone.
   */
  public get burnFraction(): number {
    return Math.min(1, this.dwell / this.config.BURN_DWELL_TIME);
  }

  /** Bearing from the lamp. Used by the anti-clustering check in §6.3. */
  public get bearingRad(): number {
    return Math.atan2(this.y - LAMP_Y, this.x - LAMP_X);
  }

  /** §5.1 — the run ends when this is true. */
  public get hasReachedLamp(): boolean {
    const dx = this.x - LAMP_X;
    const dy = this.y - LAMP_Y;
    return dx * dx + dy * dy <= CONTACT_DISTANCE * CONTACT_DISTANCE;
  }

  /**
   * One frame of PLAYING, applying §5.2's three rules in order.
   *
   * @param deltaSeconds Already clamped to DELTA_CLAMP_MS by the scene (§2.4).
   * @param rampedSpeed The run's current speed from §5.4, already capped at
   * CRAWLER_SPEED_MAX. This crawler's jitter is applied on top, which is the
   * order §11.2's readability bound is derived in.
   * @param lit Whether the beam cone covers this crawler's centre.
   * @param beamIsBurning Whether the beam is in FOCUSED, the only state that
   * accrues dwell (§3.1).
   * @returns true if the crawler was banished this frame.
   */
  public advance(
    deltaSeconds: number,
    rampedSpeed: number,
    lit: boolean,
    beamIsBurning: boolean,
  ): boolean {
    // 1. Frozen while lit, at any width. No grace period, no easing, no residual
    //    slow: it resumes the frame the light leaves it.
    this.litValue = lit;

    // Feedback only, and strictly derived from rule 1. The flash is aged before
    // the catch is tested so that re-entering the light restarts it cleanly.
    this.freezeFlashLeft = Math.max(0, this.freezeFlashLeft - deltaSeconds);
    this.frozeThisFrame = lit && !this.wasLit;
    if (this.frozeThisFrame) {
      this.freezeFlashLeft = FREEZE_FLASH_TIME;
    }
    this.wasLit = lit;

    // 2. Burn dwell accrues only inside a FOCUSED cone, and decays otherwise.
    //    Decay rather than instant reset: a wobble costs more than it gained,
    //    but one jittery frame does not erase correct play.
    if (lit && beamIsBurning) {
      this.dwell += deltaSeconds;
    } else {
      this.dwell = Math.max(0, this.dwell - deltaSeconds * BURN_DECAY_MULTIPLIER);
    }

    if (!lit) {
      const speed = rampedSpeed * this.speedFactor;
      this.x += this.headingX * speed * deltaSeconds;
      this.y += this.headingY * speed * deltaSeconds;
    }

    // 3. Banish, at the run's dwell — never at the shipped one.
    return this.dwell >= this.config.BURN_DWELL_TIME;
  }
}
