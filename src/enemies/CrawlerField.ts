// src/enemies owns the creatures: spawning from the edges, movement, freeze and
// burn states.
//
// The field is every living crawler plus the spawner that feeds it — the §5.4
// difficulty ramp, the §6 spawn rules and the per-frame resolution of §5.2, in
// docs/design.md. No Phaser import: the scene drives it and CrawlerRenderer.ts
// draws it, so the rules can be stepped and asserted on without a renderer.

import {
  CRAWLER_RADIUS,
  LAMP_X,
  LAMP_Y,
  MAX_CRAWLERS,
  RENDER_HEIGHT,
  RENDER_WIDTH,
  SPAWN_CORNER_INSET,
  SPAWN_EDGES,
  SPAWN_FIRST_DELAY,
  SPAWN_MIN_SEPARATION_RAD,
  SPAWN_PLACEMENT_ATTEMPTS,
  type SpawnEdge,
} from '../config/index';
import {
  BASE_TUNING,
  type SpawnCurveTuning,
  type SpeedCurveTuning,
  type TuningConfig,
} from '../config/tuning';
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

/**
 * The dice the field rolls, and nothing more.
 *
 * `Math.random` satisfies this with no `rewind`, which is the Free Play path in
 * `docs/design.md` §14.8: unseeded, so a restart is a different hollow. The
 * seeded source `src/weekly` builds for a weekly run carries `rewind`, so a
 * restart replays the week's sequence instead of continuing its stream.
 *
 * Declared here rather than imported for the same reason {@link BeamLight} is:
 * `src/weekly` satisfies it structurally, so neither module has to import the
 * other.
 */
export interface RunRandom {
  (): number;
  /** Rewind to the first draw. Absent on an unseeded source. */
  readonly rewind?: () => void;
}

/**
 * The two things a run is played with. `src/weekly`'s `RunSetup` satisfies it
 * structurally for both modes, and carries the resolved week the HUD names.
 */
export interface FieldRun {
  readonly random: RunRandom;
  readonly config: TuningConfig;
}

/**
 * What happened to the field in one frame.
 *
 * All three are reported rather than just the two that score, because they are
 * the three moments `docs/design.md` §13 names as worth confirming: the freeze,
 * the burn and the lamp hit. Both arrays are reused between steps; read them
 * before the next call rather than holding on to them.
 */
export interface CrawlerFieldStep {
  /**
   * Where crawlers first entered the light this frame. Transitions only — a
   * crawler held in the beam is reported once, on the frame it was caught.
   */
  readonly froze: readonly Point[];
  /** Where crawlers were banished this frame, for scoring and for the burn cue. */
  readonly banished: readonly Point[];
  /** Where a crawler touched the lamp, or null. A run ends on this and only this. */
  readonly lampHit: Point | null;
}

// Both curves take the config they read as an optional second argument, defaulted
// to the shipped values (`docs/design.md` §14.9, item 1). The game never passes
// one, so its behaviour is exactly what it was; `tools/throughput-sim.ts` passes a
// weekly cell's config so that the sweep checks the *shipped* curve at a modified
// constant rather than a second opinion about it (`docs/throughput-sim.md` §2).
// The shape of neither formula changes — §9.3 of that document forbids it, and
// OV-2 retunes nothing: a weekly run reaches these through the same argument.

/** §5.4 — linear speed ramp, capped. Jitter is applied per crawler afterwards. */
export function rampedSpeed(
  elapsedSeconds: number,
  config: SpeedCurveTuning = BASE_TUNING,
): number {
  return Math.min(
    config.CRAWLER_SPEED_MAX,
    config.CRAWLER_SPEED_BASE * (1 + config.CRAWLER_SPEED_RAMP_PER_SECOND * elapsedSeconds),
  );
}

/** §5.4 — geometric decay of the spawn interval, floored. */
export function spawnInterval(
  elapsedSeconds: number,
  config: SpawnCurveTuning = BASE_TUNING,
): number {
  return Math.max(
    config.SPAWN_INTERVAL_MIN,
    config.SPAWN_INTERVAL_START * config.SPAWN_INTERVAL_DECAY_PER_SECOND ** elapsedSeconds,
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
 * Both of its inputs are injected, and the defaults are Free Play:
 *
 * - **the dice.** `Math.random` is the unseeded path §14.8 keeps for Free Play;
 *   a test, or a weekly run, hands in a seeded {@link RunRandom} instead. Given
 *   the same seed and the same `step` calls, the spawn sequence is identical —
 *   same edges, same positions, same jitter — which is what `docs/vision.md`
 *   §5b.3 B5 means by two clients seeing the same week.
 * - **the numbers.** `config` is the §14.9 override surface, the same
 *   {@link TuningConfig} the sweep evaluates a cell at. At `BASE_TUNING` the
 *   field behaves exactly as it did before OV-2.
 */
export class CrawlerField {
  private readonly crawlers: Crawler[] = [];
  private random: RunRandom;
  private config: TuningConfig;
  private readonly banishedThisStep: Point[] = [];
  private readonly frozeThisStep: Point[] = [];

  /** Seconds until the next spawn. Reset to SPAWN_FIRST_DELAY on every run. */
  private nextSpawnIn = SPAWN_FIRST_DELAY;

  public constructor(random: RunRandom = Math.random, config: TuningConfig = BASE_TUNING) {
    this.random = random;
    this.config = config;
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

  /**
   * §2.2 — per-run reset: every crawler destroyed, the spawn timer rewound.
   *
   * `run` is the mode and week the *next* run is played under. §14.2 resolves
   * the week once, at the transition to PLAYING, and holds it for the whole
   * run; a Phaser scene reuses its instance across restarts, so this — not the
   * constructor — is where a run's numbers and dice arrive. Omit it to keep the
   * current ones, which is what every unseeded caller wants.
   *
   * A seeded source is rewound here, so `R` from game-over replays the week
   * rather than continuing its stream. An unseeded one has nothing to rewind,
   * and Free Play's next hollow is a different one.
   */
  public reset(run?: FieldRun): void {
    if (run !== undefined) {
      this.random = run.random;
      this.config = run.config;
    }

    this.random.rewind?.();
    this.crawlers.length = 0;
    this.banishedThisStep.length = 0;
    this.frozeThisStep.length = 0;
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
    this.frozeThisStep.length = 0;

    // §6.1 — each spawn schedules the next one at interval(t) from itself. The
    // remainder carries so the spawner does not drift against the frame rate.
    this.nextSpawnIn -= deltaSeconds;
    while (this.nextSpawnIn <= 0) {
      this.nextSpawnIn += spawnInterval(elapsedSeconds, this.config);
      this.spawn();
    }

    const speed = rampedSpeed(elapsedSeconds, this.config);
    let lampHit: Point | null = null;

    // Backwards, so banishing a crawler does not skip the next one.
    for (let i = this.crawlers.length - 1; i >= 0; i -= 1) {
      const crawler = this.crawlers[i];
      if (crawler === undefined) {
        continue;
      }

      const lit = beam.containsPoint(crawler.x, crawler.y);
      const banished = crawler.advance(deltaSeconds, speed, lit, beam.isBurning);

      // Reported before the banish check: a crawler caught and burned away in
      // the same frame is impossible at any sane BURN_DWELL_TIME, but the order
      // means the catch is never silently swallowed if one ever is.
      if (crawler.justFroze) {
        this.frozeThisStep.push({ x: crawler.x, y: crawler.y });
      }

      if (banished) {
        this.banishedThisStep.push({ x: crawler.x, y: crawler.y });
        this.crawlers.splice(i, 1);
        continue;
      }

      if (crawler.hasReachedLamp) {
        lampHit = { x: crawler.x, y: crawler.y };
      }
    }

    return { froze: this.frozeThisStep, banished: this.banishedThisStep, lampHit };
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

    const factor = 1 + (this.random() * 2 - 1) * this.config.CRAWLER_SPEED_JITTER;

    // The run's config goes in with the position and the jitter: §5.2's dwell is
    // the `clinging-dark` entry of §14.5, and a crawler that read it from
    // `src/config` would burn at the shipped 0.40 s in a week the sim certified
    // at 0.46 or 0.52 (GAM-46). This is the only place a crawler is made.
    this.crawlers.push(new Crawler(candidate.x, candidate.y, factor, this.config));
  }

  /** §6.2 — weighted draw. The weights are not uniform by perimeter. */
  private pickEdge(): SpawnEdge {
    const roll = this.random();
    let cumulative = 0;

    for (const edge of SPAWN_EDGES) {
      cumulative += this.config.SPAWN_EDGE_WEIGHTS[edge];
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
