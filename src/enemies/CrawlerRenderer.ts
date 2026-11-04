// src/enemies owns the creatures. This file draws whatever CrawlerField is
// holding; it has no rules of its own.
//
// Pillar 2 forbids state the screen never shows, so the two per-crawler states
// that change what the player should do next are both in the colour: a lit
// crawler reads as CRAWLER_FROZEN_COLOR, and burn progress shifts it toward
// CRAWLER_BURN_COLOR in proportion to its dwell (docs/design.md §5.2). The exact
// treatment is `ui-designer`'s to finalise; showing the state at all is not
// optional.
import Phaser from 'phaser';

import {
  CRAWLER_BURN_COLOR,
  CRAWLER_COLOR,
  CRAWLER_DEPTH,
  CRAWLER_FROZEN_COLOR,
  CRAWLER_RADIUS,
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

/**
 * Draws the crawlers into a single Graphics object.
 *
 * One object for the whole field rather than a game object per crawler: the cap
 * is MAX_CRAWLERS, so a clear-and-refill is cheaper than creating and destroying
 * display-list entries as crawlers spawn and are banished.
 */
export class CrawlerRenderer {
  private readonly graphics: Phaser.GameObjects.Graphics;

  public constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(CRAWLER_DEPTH);
  }

  public draw(crawlers: readonly Crawler[]): void {
    this.graphics.clear();

    for (const crawler of crawlers) {
      const base = crawler.isFrozen ? FROZEN : UNLIT;
      this.graphics.fillStyle(mix(base, BURNING, crawler.burnFraction), 1);
      this.graphics.fillCircle(crawler.x, crawler.y, CRAWLER_RADIUS);
    }
  }
}
