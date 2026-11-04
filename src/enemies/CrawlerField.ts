// src/enemies owns the creatures: spawning from the edges, movement, freeze and
// burn states.
//
// The field is every living crawler plus the spawner that feeds it — the §5.4
// difficulty ramp, the §6 spawn rules and the per-frame resolution of §5.2, in
// docs/design.md. No Phaser import: the scene drives it and CrawlerRenderer.ts
// draws it, so the rules can be stepped and asserted on without a renderer.

import {
  CRAWLER_RADIUS,
  CRAWLER_SPEED_BASE,
  CRAWLER_SPEED_JITTER,
  CRAWLER_SPEED_MAX,
  CRAWLER_SPEED_RAMP_PER_SECOND,
  LAMP_X,
  LAMP_Y,
  MAX_CRAWLERS,
  RENDER_HEIGHT,
  RENDER_WIDTH,
  SPAWN_CORNER_INSET,
  SPAWN_EDGES,
  SPAWN_EDGE_WEIGHTS,
  SPAWN_FIRST_DELAY,
  SPAWN_INTERVAL_DECAY_PER_SECOND,
  SPAWN_INTERVAL_MIN,
  SPAWN_INTERVAL_START,
  SPAWN_MIN_SEPARATION_RAD,
  SPAWN_PLACEMENT_ATTEMPTS,
  type SpawnEdge,
} from '../config/index';
import { Crawler } from './Crawler';

/**
 * What the field needs to know about the beam, and nothing more. `src/beam`'s
 * BeamModel satisfies this structurally, so the scene can hand one straight in
 * without either module importing the other.
 */
export interface BeamLight {
  containsPoint(x: number, y: number): boolean;
  readonly isBurning: boolean;
}

/** A position in render space. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** What happened to the field in one frame. */
export interface CrawlerFieldStep {
  /**
   * Where crawlers were banished this frame, for scoring and for the game-feel
   * hooks in a later task. The array is reused between steps; read it before the
   * next call rather than holding on to it.
   */
  readonly banished: readonly Point[];
  /** Where a crawler touched the lamp, or null. A run ends on this and only this. */
  readonly lampHit: Point | null;
}

/** §5.4 — linear speed ramp, capped. Jitter is applied per crawler afterwards. */
export function rampedSpeed(elapsedSeconds: number): number {
  return Math.min(
    CRAWLER_SPEED_MAX,
    CRAWLER_SPEED_BASE * (1 + CRAWLER_SPEED_RAMP_PER_SECOND * elapsedSeconds),
  );
}

/** §5.4 — geometric decay of the spawn interval, floored. */
export function spawnInterval(elapsedSeconds: number): number {
  return Math.max(
    SPAWN_INTERVAL_MIN,
    SPAWN_INTERVAL_START * SPAWN_INTERVAL_DECAY_PER_SECOND ** elapsedSeconds,
  );
}

/**
 * Smallest absolute angle between two bearings, radians, wrapping across +/-pi.
 */
function angularDistance(a: number, b: number): number {
  const d = a - b;
  return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
}

/**
 * Every living crawler, and the spawner that feeds them in.
 *
 * The random source is injectable so a test can drive placement deterministically;
 * the game uses Math.random.
 */
export class CrawlerField {
  private readonly crawlers: Crawler[] = [];
  private readonly random: () => number;
  private readonly banishedThisStep: Point[] = [];

  /** Seconds until the next spawn. Reset to SPAWN_FIRST_DELAY on every run. */
  private nextSpawnIn = SPAWN_FIRST_DELAY;

  public constructor(random: () => number = Math.random) {
    this.random = random;
  }

  /** Every crawler currently in play, for the renderer. */
  public get all(): readonly Crawler[] {
    return this.crawlers;
  }

  /**
   * Seconds until the next crawler arrives — the countdown this field actually
   * holds, not the §5.4 interval it was last reset to.
   *
   * Read-only, and read by the scene alone so the HUD can print it: pillar 2 in
   * `docs/vision.md` forbids the game holding a timer the screen never shows.
   * Nothing here may be assigned from outside; the spawner owns its own clock.
   *
   * Floored at zero because `step` is what drives the countdown back above it,
   * so a reader between frames must never be handed a negative time.
   */
  public get secondsToNextSpawn(): number {
    return Math.max(0, this.nextSpawnIn);
  }

  /** §2.2 — per-run reset: every crawler destroyed, the spawn timer rewound. */
  public reset(): void {
    this.crawlers.length = 0;
    this.banishedThisStep.length = 0;
    this.nextSpawnIn = SPAWN_FIRST_DELAY;
  }

  /**
   * One frame of PLAYING.
   *
   * @param deltaSeconds Already clamped to DELTA_CLAMP_MS by the scene (§2.4).
   * @param elapsedSeconds Run time so far, which drives both ramps in §5.4.
   * @param beam The light, for the freeze and burn tests.
   */
  public step(deltaSeconds: number, elapsedSeconds: number, beam: BeamLight): CrawlerFieldStep {
    this.banishedThisStep.length = 0;

    // §6.1 — each spawn schedules the next one at interval(t) from itself. The
    // remainder carries so the spawner does not drift against the frame rate.
    this.nextSpawnIn -= deltaSeconds;
    while (this.nextSpawnIn <= 0) {
      this.nextSpawnIn += spawnInterval(elapsedSeconds);
      this.spawn();
    }

    const speed = rampedSpeed(elapsedSeconds);
    let lampHit: Point | null = null;

    // Backwards, so banishing a crawler does not skip the next one.
    for (let i = this.crawlers.length - 1; i >= 0; i -= 1) {
      const crawler = this.crawlers[i];
      if (crawler === undefined) {
        continue;
      }

      const lit = beam.containsPoint(crawler.x, crawler.y);
      if (crawler.advance(deltaSeconds, speed, lit, beam.isBurning)) {
        this.banishedThisStep.push({ x: crawler.x, y: crawler.y });
        this.crawlers.splice(i, 1);
        continue;
      }

      if (crawler.hasReachedLamp) {
        lampHit = { x: crawler.x, y: crawler.y };
      }
    }

    return { banished: this.banishedThisStep, lampHit };
  }

  /**
   * §5.3 — a spawn at the cap is dropped, not queued. Queuing would convert a
   * performance rail into a delayed difficulty spike arriving after the pressure
   * has passed.
   */
  private spawn(): void {
    if (this.crawlers.length >= MAX_CRAWLERS) {
      return;
    }

    const edge = this.pickEdge();
    let candidate = this.placeOn(edge);

    // §6.3 — anti-clustering. Re-roll a candidate whose bearing from the lamp
    // crowds a living crawler's, then accept the last one anyway rather than
    // skipping the spawn, which would quietly lower the spawn rate.
    for (let attempt = 1; attempt < SPAWN_PLACEMENT_ATTEMPTS && this.isCrowded(candidate); attempt += 1) {
      candidate = this.placeOn(edge);
    }

    const factor = 1 + (this.random() * 2 - 1) * CRAWLER_SPEED_JITTER;
    this.crawlers.push(new Crawler(candidate.x, candidate.y, factor));
  }

  /** §6.2 — weighted draw. The weights are not uniform by perimeter. */
  private pickEdge(): SpawnEdge {
    const roll = this.random();
    let cumulative = 0;

    for (const edge of SPAWN_EDGES) {
      cumulative += SPAWN_EDGE_WEIGHTS[edge];
      if (roll < cumulative) {
        return edge;
      }
    }

    // Only reachable if the weights do not quite sum to 1 in floating point.
    return SPAWN_EDGES[SPAWN_EDGES.length - 1] ?? 'top';
  }

  /**
   * §6.3 — uniform along the edge, excluding SPAWN_CORNER_INSET at each end, and
   * inset from the edge by CRAWLER_RADIUS so the crawler is fully on screen on
   * its first frame. It must never be partly off-screen and never appear inside
   * the field: both are pillar 2 failures.
   */
  private placeOn(edge: SpawnEdge): Point {
    const alongWidth = this.uniform(SPAWN_CORNER_INSET, RENDER_WIDTH - SPAWN_CORNER_INSET);
    const alongHeight = this.uniform(SPAWN_CORNER_INSET, RENDER_HEIGHT - SPAWN_CORNER_INSET);

    switch (edge) {
      case 'top':
        return { x: alongWidth, y: CRAWLER_RADIUS };
      case 'bottom':
        return { x: alongWidth, y: RENDER_HEIGHT - CRAWLER_RADIUS };
      case 'left':
        return { x: CRAWLER_RADIUS, y: alongHeight };
      case 'right':
        return { x: RENDER_WIDTH - CRAWLER_RADIUS, y: alongHeight };
    }
  }

  private isCrowded(candidate: Point): boolean {
    const bearing = Math.atan2(candidate.y - LAMP_Y, candidate.x - LAMP_X);

    return this.crawlers.some(
      (crawler) => angularDistance(bearing, crawler.bearingRad) < SPAWN_MIN_SEPARATION_RAD,
    );
  }

  private uniform(min: number, max: number): number {
    return min + this.random() * (max - min);
  }
}
