// src/enemies owns the creatures. This file draws whatever CrawlerField is
// holding; it has no rules of its own.
//
// Pillar 2 forbids state the screen never shows, so the two per-crawler states
// that change what the player should do next are both in the colour: a lit
// crawler reads as CRAWLER_FROZEN_COLOR, and burn progress shifts it toward
// CRAWLER_BURN_COLOR in proportion to its dwell (docs/design.md §5.2).
//
// The feel pass (GAM-12) adds a silhouette to each of those, because colour
// alone is the weakest tell on a dark screen and both states are read at a
// glance while the player's eyes are on the beam:
//
//   - a frost ring, present on exactly the frames the crawler is held;
//   - a catch flash, snapping out once on the frame the light reaches it;
//   - a burn arc sweeping a full turn as the dwell accumulates.
//
// None of the three is the only evidence of anything — the body tint still says
// frozen and burning on its own — and none of them reads any state the rules do
// not already expose.
import Phaser from 'phaser';

import {
  BURN_ARC_ALPHA,
  BURN_ARC_RADIUS_SCALE,
  BURN_ARC_START_RAD,
  BURN_ARC_WIDTH,
  CRAWLER_BURN_COLOR,
  CRAWLER_COLOR,
  CRAWLER_DEPTH,
  CRAWLER_FROST_RING_ALPHA,
  CRAWLER_FROST_RING_SCALE,
  CRAWLER_FROST_RING_WIDTH,
  CRAWLER_FROZEN_COLOR,
  CRAWLER_RADIUS,
  FREEZE_FLASH_ALPHA,
  FREEZE_FLASH_SCALE_END,
  FREEZE_FLASH_SCALE_START,
  FREEZE_FLASH_WIDTH,
  FULL_TURN_RAD,
} from '../config/index';
import type { Crawler } from './Crawler';

/** Channel values, split once at module load rather than per crawler per frame. */
const UNLIT = Phaser.Display.Color.IntegerToColor(CRAWLER_COLOR);
const FROZEN = Phaser.Display.Color.IntegerToColor(CRAWLER_FROZEN_COLOR);
const BURNING = Phaser.Display.Color.IntegerToColor(CRAWLER_BURN_COLOR);

function mix(from: Phaser.Display.Color, to: Phaser.Display.Color, t: number): number {
  return Phaser.Display.Color.GetColor(
    Math.round(from.red + (to.red - from.red) * t),
    Math.round(from.green + (to.green - from.green) * t),
    Math.round(from.blue + (to.blue - from.blue) * t),
  );
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * Draws the crawlers into a single Graphics object.
 *
 * One object for the whole field rather than a game object per crawler: the cap
 * is MAX_CRAWLERS, so a clear-and-refill is cheaper than creating and destroying
 * display-list entries as crawlers spawn and are banished. The feel pass adds
 * strokes to that same object for the same reason — at the cap this is still one
 * display-list entry and one batch, which is what docs/concept.md §9's
 * overlapping-alpha risk and criterion 3's frame rate are protected by.
 */
export class CrawlerRenderer {
  private readonly graphics: Phaser.GameObjects.Graphics;

  public constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(CRAWLER_DEPTH);
  }

  public draw(crawlers: readonly Crawler[]): void {
    this.graphics.clear();

    for (const crawler of crawlers) {
      this.drawCatchFlash(crawler);
      this.drawBody(crawler);
      this.drawFrostRing(crawler);
      this.drawBurnArc(crawler);
    }
  }

  /**
   * The moment of the catch: a ring that snaps out from the crawler and fades.
   * Under the body, so it reads as light thrown off rather than as a cage.
   */
  private drawCatchFlash(crawler: Crawler): void {
    const flash = crawler.freezeFlash;
    if (flash <= 0) {
      return;
    }

    // flash falls 1 -> 0, so the ring expands as it fades.
    const spread = 1 - flash;
    this.graphics.lineStyle(
      FREEZE_FLASH_WIDTH,
      CRAWLER_FROZEN_COLOR,
      FREEZE_FLASH_ALPHA * flash,
    );
    this.graphics.strokeCircle(
      crawler.x,
      crawler.y,
      CRAWLER_RADIUS * lerp(FREEZE_FLASH_SCALE_START, FREEZE_FLASH_SCALE_END, spread),
    );
  }

  private drawBody(crawler: Crawler): void {
    const base = crawler.isFrozen ? FROZEN : UNLIT;
    this.graphics.fillStyle(mix(base, BURNING, crawler.burnFraction), 1);
    this.graphics.fillCircle(crawler.x, crawler.y, CRAWLER_RADIUS);
  }

  /**
   * Held, right now. On and off with the freeze itself: §5.2's "resumes the
   * moment the light leaves it" is literal, and so is this.
   */
  private drawFrostRing(crawler: Crawler): void {
    if (!crawler.isFrozen) {
      return;
    }

    this.graphics.lineStyle(
      CRAWLER_FROST_RING_WIDTH,
      CRAWLER_FROZEN_COLOR,
      CRAWLER_FROST_RING_ALPHA,
    );
    this.graphics.strokeCircle(crawler.x, crawler.y, CRAWLER_RADIUS * CRAWLER_FROST_RING_SCALE);
  }

  /**
   * How far through the dwell this crawler is, as an arc from twelve o'clock.
   * §5.2 requires partial dwell to be visible; this is the part a player times a
   * commitment against, and it decays back down exactly as the dwell does.
   */
  private drawBurnArc(crawler: Crawler): void {
    const burn = crawler.burnFraction;
    if (burn <= 0) {
      return;
    }

    this.graphics.lineStyle(BURN_ARC_WIDTH, CRAWLER_BURN_COLOR, BURN_ARC_ALPHA);
    this.graphics.beginPath();
    this.graphics.arc(
      crawler.x,
      crawler.y,
      CRAWLER_RADIUS * BURN_ARC_RADIUS_SCALE,
      BURN_ARC_START_RAD,
      BURN_ARC_START_RAD + burn * FULL_TURN_RAD,
      false,
    );
    this.graphics.strokePath();
  }
}
