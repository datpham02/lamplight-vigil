// src/scenes owns the Phaser scenes and their lifecycle wiring.
import Phaser from 'phaser';

import { Beam, Lamp } from '../beam/index';
import {
  AMBIENT_DEPTH,
  AMBIENT_LIGHT_ALPHA,
  BEAM_COLOR,
  DELTA_CLAMP_MS,
  GAME_OVER_INPUT_LOCKOUT,
  INPUT_FOCUS_KEY,
  INPUT_FOCUS_POINTER,
  INPUT_RESTART_KEY,
  LAMP_X,
  LAMP_Y,
  MS_PER_SECOND,
  POWER_FOCUS_REARM,
  POWER_MAX,
  RENDER_HEIGHT,
  RENDER_WIDTH,
} from '../config/index';
import { CrawlerField, CrawlerRenderer } from '../enemies/index';
import { Hud } from '../hud/index';
import { readBestScore, writeBestScore } from './bestScore';
import { runScore } from './score';
import {
  RUN_STATE,
  VIGIL_EVENTS,
  type PointPayload,
  type PowerPayload,
  type RunState,
  type RunStatePayload,
  type ScorePayload,
} from './events';

/**
 * The single play scene: the lamp in the centre of the dark hollow, the beam it
 * casts, the crawlers walking in from the edges, and the run state machine that
 * binds them (docs/design.md §2).
 *
 * The scene owns the run; it does not draw the readouts. Lamp power, score, best
 * score and the title and game-over overlays are the HUD-and-screens task's, and
 * reach them over the events in events.ts. The lamp, the beam, the crawlers and
 * the ambient floor are drawn here because they are the world, not the readout.
 */
export class VigilScene extends Phaser.Scene {
  public static readonly KEY = 'vigil';

  private lamp!: Lamp;
  private beam!: Beam;
  private crawlerRenderer!: CrawlerRenderer;

  private readonly field = new CrawlerField();

  private focusKey: Phaser.Input.Keyboard.Key | null = null;
  private restartKey: Phaser.Input.Keyboard.Key | null = null;

  // Per-run state. Reset in init() and in startRun(), never in the constructor —
  // Phaser reuses scene instances across restarts (AGENTS.md).
  private runState: RunState = RUN_STATE.TITLE;
  private elapsedSeconds = 0;
  private banished = 0;
  private score = 0;
  private bestScore = 0;

  /** §2.3 — seconds of restart lockout left, and whether a press is waiting. */
  private restartLockoutLeft = 0;
  private restartBuffered = false;

  /**
   * Clock for the lamp's cosmetic pulse. Separate from elapsedSeconds because the
   * pulse should breathe on the title screen, where no run time accumulates, and
   * must stop dead in GAME_OVER, where §2.3 freezes the world.
   */
  private cosmeticMs = 0;

  public constructor() {
    super(VigilScene.KEY);
  }

  // init() and create() are not `override`: Phaser's Scene base class does not
  // declare them. update() is declared on the base class, so it is.

  /** Runs before create() on every start and restart. Reset per-run state here. */
  init(): void {
    this.runState = RUN_STATE.TITLE;
    this.elapsedSeconds = 0;
    this.banished = 0;
    this.score = 0;
    this.cosmeticMs = 0;
    this.restartLockoutLeft = 0;
    this.restartBuffered = false;
    this.field.reset();
    this.bestScore = readBestScore();
  }

  create(): void {
    // The minimum ambient floor from docs/design.md §10.2: a hollow that is
    // literally black hides crawlers the player is entitled to see.
    this.add
      .rectangle(LAMP_X, LAMP_Y, RENDER_WIDTH, RENDER_HEIGHT, BEAM_COLOR, AMBIENT_LIGHT_ALPHA)
      .setDepth(AMBIENT_DEPTH);

    // Placeholder programmer art is generated here, once at boot, not per frame
    // (performance mitigation, docs/concept.md §9).
    this.beam = new Beam(this);
    this.lamp = new Lamp(this);
    this.crawlerRenderer = new CrawlerRenderer(this);

    // The readouts and the two overlays. The HUD subscribes itself to the
    // events below and is not referred to again from here: the scene owns the
    // run, not what the run looks like. It is constructed before the first
    // emitRunState() so the title screen is up on the first rendered frame.
    new Hud(this);

    const keyboard = this.input.keyboard;
    if (keyboard !== null) {
      this.focusKey = keyboard.addKey(INPUT_FOCUS_KEY);
      this.restartKey = keyboard.addKey(INPUT_RESTART_KEY);
      keyboard.on(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, this.onAnyInput, this);
    }
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onAnyInput, this);

    this.emitRunState();
  }

  override update(_time: number, delta: number): void {
    // §2.4 — every delta is clamped before any movement, timer, power or score
    // integration uses it. A backgrounded tab or a GC pause must cost the player
    // a slice of time, not the run.
    const deltaSeconds = Math.min(delta, DELTA_CLAMP_MS) / MS_PER_SECOND;

    switch (this.runState) {
      case RUN_STATE.TITLE:
        this.cosmeticMs += deltaSeconds * MS_PER_SECOND;
        this.beam.updateAim();
        this.lamp.update(this.cosmeticMs);
        break;

      case RUN_STATE.PLAYING:
        this.cosmeticMs += deltaSeconds * MS_PER_SECOND;
        this.stepRun(deltaSeconds);
        this.lamp.update(this.cosmeticMs);
        break;

      case RUN_STATE.GAME_OVER:
        // The world is frozen exactly where it was, down to the lamp's pulse, so
        // the player can see the crawler that killed them (§2.3).
        this.stepGameOver(deltaSeconds);
        break;
    }
  }

  /** Whether either focus binding is down right now (§7). */
  private get focusHeld(): boolean {
    const keyHeld = this.focusKey?.isDown ?? false;
    const pointerHeld = INPUT_FOCUS_POINTER && this.input.activePointer.leftButtonDown();
    return keyHeld || pointerHeld;
  }

  /** One frame of PLAYING. */
  private stepRun(deltaSeconds: number): void {
    this.elapsedSeconds += deltaSeconds;
    this.beam.update(deltaSeconds, this.focusHeld);

    const step = this.field.step(deltaSeconds, this.elapsedSeconds, this.beam.light);

    for (const point of step.banished) {
      this.banished += 1;
      const payload: PointPayload = { x: point.x, y: point.y };
      this.events.emit(VIGIL_EVENTS.CRAWLER_BANISHED, payload);
    }

    this.score = runScore(this.elapsedSeconds, this.banished);

    this.crawlerRenderer.draw(this.field.all);
    this.emitPower();
    this.emitScore();

    if (step.lampHit !== null) {
      this.endRun(step.lampHit);
    }
  }

  /** One frame of GAME_OVER: nothing moves, only the restart lockout runs down. */
  private stepGameOver(deltaSeconds: number): void {
    this.restartLockoutLeft = Math.max(0, this.restartLockoutLeft - deltaSeconds);

    // §2.3 — a press inside the lockout is buffered, not discarded. One buffered
    // press is enough; further presses change nothing.
    if (this.restartKey !== null && Phaser.Input.Keyboard.JustDown(this.restartKey)) {
      this.restartBuffered = true;
    }

    if (this.restartBuffered && this.restartLockoutLeft <= 0) {
      this.startRun();
    }
  }

  /**
   * TITLE only: any key or any click starts the run (§7). In PLAYING and
   * GAME_OVER this does nothing — restart is INPUT_RESTART_KEY and goes through
   * the lockout in stepGameOver.
   */
  private onAnyInput(): void {
    if (this.runState === RUN_STATE.TITLE) {
      this.startRun();
    }
  }

  /** §2.2 — entry to PLAYING, from TITLE and from GAME_OVER alike. */
  private startRun(): void {
    this.runState = RUN_STATE.PLAYING;
    this.elapsedSeconds = 0;
    this.banished = 0;
    this.score = 0;
    this.restartLockoutLeft = 0;
    this.restartBuffered = false;
    this.field.reset();

    // Aim is seeded from the live pointer and a focus binding already held is
    // disarmed, both before the first frame renders.
    this.beam.reset(this.focusHeld);

    this.crawlerRenderer.draw(this.field.all);
    this.emitRunState();
    this.emitPower();
    this.emitScore();
  }

  /** §2.3 — a crawler touched the lamp. That, and only that, ends a run. */
  private endRun(at: { readonly x: number; readonly y: number }): void {
    this.runState = RUN_STATE.GAME_OVER;
    this.restartLockoutLeft = GAME_OVER_INPUT_LOCKOUT;
    this.restartBuffered = false;

    // Only a press made *after* the death counts. Without this, a restart key
    // tapped during the run would still be flagged as newly-down on the first
    // GAME_OVER frame and would skip the score the lockout exists to protect.
    this.restartKey?.reset();

    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      writeBestScore(this.bestScore);
    }

    const hit: PointPayload = { x: at.x, y: at.y };
    this.events.emit(VIGIL_EVENTS.LAMP_HIT, hit);
    this.emitRunState();
  }

  private emitRunState(): void {
    const payload: RunStatePayload = {
      state: this.runState,
      score: this.score,
      banished: this.banished,
      elapsedSeconds: this.elapsedSeconds,
      bestScore: this.bestScore,
    };
    this.events.emit(VIGIL_EVENTS.RUN_STATE_CHANGED, payload);
  }

  private emitPower(): void {
    const payload: PowerPayload = {
      power: this.beam.power,
      max: POWER_MAX,
      rearmAt: POWER_FOCUS_REARM,
      focusLockedOut: this.beam.focusLockedOut,
    };
    this.events.emit(VIGIL_EVENTS.POWER_CHANGED, payload);
  }

  private emitScore(): void {
    const payload: ScorePayload = {
      score: this.score,
      banished: this.banished,
      elapsedSeconds: this.elapsedSeconds,
      bestScore: this.bestScore,
      nextSpawnIn: this.field.secondsToNextSpawn,
    };
    this.events.emit(VIGIL_EVENTS.SCORE_CHANGED, payload);
  }
}
