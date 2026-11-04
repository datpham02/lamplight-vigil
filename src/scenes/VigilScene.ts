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
import { readHostContext, type HostContext } from '../host/hostContext';
import { Hud } from '../hud/index';
import { readBestScore, writeBestScore } from './bestScore';
import { RestartClock } from './restartClock';
import { runScore } from './score';
import { VigilFeedback } from './VigilFeedback';
import {
  RUN_STATE,
  VIGIL_EVENTS,
  type PausePayload,
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
  private feedback!: VigilFeedback;

  private readonly field = new CrawlerField();

  /**
   * `docs/vision.md` §6 criterion 1 wants the restart measured, so the game
   * measures it. Lives across restarts by design — it has to span the one it is
   * timing — and is inert for a run started from TITLE.
   */
  private readonly restartClock = new RestartClock();

  private focusKey: Phaser.Input.Keyboard.Key | null = null;
  private restartKey: Phaser.Input.Keyboard.Key | null = null;

  /**
   * The page this game is mounted on, or null when there is none — a scene
   * built outside `mount()` is still a working scene, it simply never pauses
   * and never makes a sound.
   *
   * Read once in create() rather than per frame: it belongs to the game, not to
   * the run, so it must not be cleared in init().
   */
  private host: HostContext | null = null;

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
   * §2.5 — whether the run is suspended because nobody is looking at it.
   *
   * This is not a fourth run state: the run is still PLAYING, it has simply
   * stopped advancing. It is held here rather than read from the host every
   * time it is needed so that there is exactly one frame boundary at which a
   * pause begins or ends, and so the HUD is told on that frame and no other.
   */
  private paused = false;

  /**
   * §2.6 — whether the press currently holding a pointer button landed on the
   * game rather than somewhere else on the host page.
   *
   * Phaser's window-level `mousedown` listener (which exists so a release off
   * the canvas is still seen) reports every press on the page, and a press on
   * the host's own form field must not focus the beam. There is no matching
   * flag for the release: the button going up anywhere clears
   * `leftButtonDown()` on its own, so a stale `true` here cannot outlive the
   * press it belongs to.
   */
  private pointerPressOnGame = false;

  /**
   * Clock for the lamp's cosmetic pulse. Separate from elapsedSeconds because the
   * pulse should breathe on the title screen, where no run time accumulates, and
   * must stop dead in GAME_OVER, where §2.3 freezes the world.
   */
  private cosmeticMs = 0;

  /**
   * This frame's timestamp from Phaser's clock. Held so endRun() and startRun(),
   * which are reached from inside update(), can stamp the restart clock with the
   * same frame time the loop is on rather than taking a second reading.
   */
  private frameTimeMs = 0;

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
    this.paused = false;
    this.pointerPressOnGame = false;
    this.field.reset();
    this.bestScore = readBestScore();
  }

  create(): void {
    this.host = readHostContext(this);

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

    // Subscribes to the events emitted below; the scene never calls into it to
    // make something happen. It is handed the host because its sound cannot be
    // built here: §2.6 forbids an audio device before the player's first
    // gesture, and the host is what knows when that happens.
    this.feedback = new VigilFeedback(this, this.host);

    // The readouts and the three overlays. The HUD subscribes itself to the
    // events below and is not referred to again from here: the scene owns the
    // run, not what the run looks like. It is constructed before the first
    // emitRunState() so the title screen is up on the first rendered frame,
    // and after the feedback layer so it sits above it when depths tie.
    new Hud(this);

    const keyboard = this.input.keyboard;
    if (keyboard !== null) {
      this.focusKey = keyboard.addKey(INPUT_FOCUS_KEY);
      this.restartKey = keyboard.addKey(INPUT_RESTART_KEY);
      keyboard.on(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, this.onAnyInput, this);
    }
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);

    this.emitRunState();
  }

  override update(time: number, delta: number): void {
    // §2.4 — every delta is clamped before any movement, timer, power or score
    // integration uses it. A backgrounded tab or a GC pause must cost the player
    // a slice of time, not the run.
    const deltaSeconds = Math.min(delta, DELTA_CLAMP_MS) / MS_PER_SECOND;

    this.frameTimeMs = time;

    // The first frame after a restart is the one the player can act on, so it is
    // where the measurement stops. Before the state machine runs, so a death on
    // this very frame cannot be mistaken for the end of the previous restart.
    this.reportRestartIfMeasured(time);

    // §2.5 — a suspended run advances nothing at all: not the clock, not the
    // crawlers, not the power, not the lamp's pulse, not even a fading burst.
    // The frame on screen is the frame the player walked away from, and a
    // pause therefore cannot earn a point or cost one.
    if (this.syncPause()) {
      return;
    }

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

    // Feedback runs in every state, on its own clock. It moves nothing in the
    // world and advances no rule — see VigilFeedback.update on why that is still
    // inside §2.3's freeze.
    this.feedback.update(deltaSeconds);
  }

  /**
   * §2.5 — reconciles the run with the host's pause signal, once per frame.
   *
   * Only PLAYING can be suspended. TITLE and GAME_OVER already advance no
   * clock and earn no score, and a title screen that demanded a click before it
   * would breathe again would be a worse first impression than the one it
   * fixes.
   *
   * @returns whether the run is suspended on this frame.
   */
  private syncPause(): boolean {
    const wanted =
      this.runState === RUN_STATE.PLAYING && (this.host?.pause.pauseRequested ?? false);

    if (wanted !== this.paused) {
      this.paused = wanted;
      this.emitPause();
    }

    return this.paused;
  }

  /**
   * §2.5 — the player came back and gave the game an input.
   *
   * Resuming is deliberately an action rather than a window event: see
   * `src/host/pauseSignal.ts` on why returning focus must not be enough. The
   * input that resumes runs through the §2.2 edge trigger for the same reason
   * the click that starts a run does — it is very often the left mouse button,
   * which is also a focus binding.
   */
  private resumeFromPause(): void {
    this.host?.pause.clear();
    this.paused = false;
    this.beam.disarmFocus(this.focusHeld);
    this.emitPause();
  }

  /** Whether either focus binding is down right now (§7). */
  private get focusHeld(): boolean {
    const keyHeld = this.focusKey?.isDown ?? false;
    const pointerHeld =
      INPUT_FOCUS_POINTER && this.pointerPressOnGame && this.input.activePointer.leftButtonDown();
    return keyHeld || pointerHeld;
  }

  /**
   * §2.6 — a pointer press. Discarded unless it landed on the game.
   *
   * The flag is set either way, including to false, because it is what decides
   * whether the button now being held counts as the §7 focus binding. A press
   * on the page beside the game must not narrow the beam.
   */
  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    // Not mounted, so there is no "outside" to be on the wrong side of.
    this.pointerPressOnGame = this.host?.ownsEventTarget(pointer.event.target) ?? true;

    if (this.pointerPressOnGame) {
      this.onAnyInput();
    }
  }

  /** One frame of PLAYING. */
  private stepRun(deltaSeconds: number): void {
    this.elapsedSeconds += deltaSeconds;
    this.beam.update(deltaSeconds, this.focusHeld);

    const step = this.field.step(deltaSeconds, this.elapsedSeconds, this.beam.light);

    for (const point of step.froze) {
      const caught: PointPayload = { x: point.x, y: point.y };
      this.events.emit(VIGIL_EVENTS.CRAWLER_FROZEN, caught);
    }

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
      this.restartClock.markRestartPressed(this.frameTimeMs);
    }

    if (this.restartBuffered && this.restartLockoutLeft <= 0) {
      this.startRun();
    }
  }

  /**
   * Any key or any click: starts the run from TITLE, and lifts a §2.5 pause.
   * Otherwise it does nothing — restart is INPUT_RESTART_KEY and goes through
   * the lockout in stepGameOver.
   *
   * The pause case comes first because a suspended run is still PLAYING, and
   * the one thing the player can do to it is carry on.
   */
  private onAnyInput(): void {
    if (this.paused) {
      this.resumeFromPause();
      return;
    }

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

    // §2.5 — a run never opens suspended. The key or click that got here is
    // itself the player being present, so a blur that happened while the
    // game-over screen was up has already been answered.
    this.host?.pause.clear();
    this.paused = false;

    // Bursts are killed and any running camera shake is cancelled, so the first
    // frame of the new run is not still shaking from the last one's death. No
    // asset is loaded and no scene is restarted here — that is what keeps this
    // path inside criterion 1's budget.
    this.feedback.reset();

    // Aim is seeded from the live pointer and a focus binding already held is
    // disarmed, both before the first frame renders.
    this.beam.reset(this.focusHeld);

    this.crawlerRenderer.draw(this.field.all);
    this.emitRunState();
    this.emitPause();
    this.emitPower();
    this.emitScore();

    this.restartClock.markRunStarted();
  }

  /**
   * `docs/vision.md` §6 criterion 1. Prints the measured restart once per
   * restart, in dev only: the number belongs to QA and to this task's evidence,
   * not to the player, and pillar 2 would not thank us for a readout on screen
   * that says nothing about the threat picture.
   */
  private reportRestartIfMeasured(nowMs: number): void {
    const measured = this.restartClock.markFirstPlayableFrame(nowMs);
    if (measured === null || !import.meta.env.DEV) {
      return;
    }

    const verdict = RestartClock.withinBudget(measured) ? 'within' : 'OVER';
    console.info(
      `[vigil] restart ${verdict} budget: ${measured.fromDeathMs.toFixed(1)} ms from death, ` +
        `${measured.fromPressMs.toFixed(1)} ms from keypress`,
    );
  }

  /** §2.3 — a crawler touched the lamp. That, and only that, ends a run. */
  private endRun(at: { readonly x: number; readonly y: number }): void {
    this.runState = RUN_STATE.GAME_OVER;
    this.restartLockoutLeft = GAME_OVER_INPUT_LOCKOUT;
    this.restartBuffered = false;
    this.restartClock.markDeath(this.frameTimeMs);

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

  private emitPause(): void {
    const payload: PausePayload = { paused: this.paused };
    this.events.emit(VIGIL_EVENTS.PAUSE_CHANGED, payload);
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
