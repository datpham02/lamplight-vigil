// src/scenes owns the Phaser scenes and their lifecycle wiring.
import Phaser from 'phaser';

import { Beam, Lamp } from '../beam/index';

/**
 * The single play scene: the lamp in the centre of the dark hollow, and the
 * wide beam it casts towards the mouse.
 *
 * Skeleton stage — rendering and aim only. Focus, power, crawler spawning,
 * freeze/burn resolution, scoring and the HUD are added by later tasks, which
 * own their own modules and talk to this scene through src/scenes/events.ts.
 */
export class VigilScene extends Phaser.Scene {
  public static readonly KEY = 'vigil';

  private lamp!: Lamp;
  private beam!: Beam;

  /**
   * Milliseconds since this run began, accumulated from delta time.
   * Per-run state, so it is reset in init() rather than the constructor —
   * Phaser reuses scene instances across restarts.
   */
  private elapsedMs = 0;

  public constructor() {
    super(VigilScene.KEY);
  }

  // init() and create() are not `override`: Phaser's Scene base class does not
  // declare them. update() is declared on the base class, so it is.

  /** Runs before create() on every start and restart. Reset per-run state here. */
  init(): void {
    this.elapsedMs = 0;
  }

  create(): void {
    // Placeholder programmer art is generated here, once at boot, not per frame
    // (performance mitigation, docs/concept.md §9).
    this.beam = new Beam(this);
    this.lamp = new Lamp(this);
  }

  override update(_time: number, delta: number): void {
    this.elapsedMs += delta;

    this.beam.update();
    this.lamp.update(this.elapsedMs);
  }
}
