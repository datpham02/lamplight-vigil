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
  WEEK_COUNTDOWN_TICK_MS,
} from '../config/index';
import { CrawlerField, CrawlerRenderer } from '../enemies/index';
import { readHostContext, type HostContext } from '../host/hostContext';
import { Hud } from '../hud/index';
import { msRemainingInWeek, weeklyRunAt } from '../weekly/index';
import { readBestScore, writeBestScore } from './bestScore';
import {
  canRename,
  commitDisplayName,
  ensureDisplayName,
  renameLockDays,
  type DisplayNameRecord,
} from './displayName';
import {
  KEY_ACTION,
  backspaceName,
  commitName,
  keyAction,
  openNameEdit,
  typeIntoName,
  type NameEditState,
} from './nameEdit';
import { RestartClock } from './restartClock';
import { runScore } from './score';
import { VigilFeedback } from './VigilFeedback';
import {
  RUN_MODE,
  RUN_STATE,
  VIGIL_EVENTS,
  type DisplayNamePayload,
  type PausePayload,
  type PointPayload,
  type PowerPayload,
  type RunMode,
  type RunState,
  type RunStatePayload,
  type ScorePayload,
  type WeekPayload,
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
   * §15 — the name this device plays under, read once from storage, and the
   * editing session on it when one is open.
   *
   * Both live on the scene because the scene owns the keyboard. The session is
   * null in every state but TITLE and is cleared on the way into a run, which
   * is the whole of condition C3.2 in `docs/vision.md` §3: there is no name
   * step between the lose state and the next playable frame because there is
   * no code path that can open one there.
   */
  private displayName: DisplayNameRecord = { name: '', renamedAt: null };
  private nameEdit: NameEditState | null = null;

  /**
   * The rename cooldown the title row is currently stating, in days.
   *
   * Held so that the row can be kept true while the title screen sits open:
   * the cooldown runs on the wall clock, and a screen that says "1 DAY" after
   * the day has passed — beside a key that now works — is the pillar 2 failure
   * this whole row exists to avoid. Checked on title frames only; -1 is "the
   * screen has not been told anything yet".
   */
  private renameLockShown = -1;

  /**
   * The page this game is mounted on, or null when there is none — a scene
   * built outside `mount()` is still a working scene, it simply never pauses
   * and never makes a sound.
   *
   * Read once in create() rather than per frame: it belongs to the game, not to
   * the run, so it must not be cleared in init().
   */
  private host: HostContext | null = null;

  /**
   * §14.8 — which mode the current run is being played in.
   *
   * Chosen on the title screen and nowhere else (C3.2), and deliberately *not*
   * reset by `startRun`: `R` from game-over restarts the mode just played, so
   * the mode has to outlive the run it belonged to. The only things that set it
   * are the two title-screen paths — `INPUT_FREE_PLAY_KEY`, and every other key
   * or a click — which is pillar 3 holding: the restart path never grows a step
   * because there is no mode question on it to answer.
   */
  private mode: RunMode = RUN_MODE.WEEKLY;

  /**
   * §14.2 — the week this run is being played under, resolved once at the
   * transition to PLAYING and held for the whole run, or null in Free Play.
   *
   * Held without its countdown: `weekEndsAtMs` carries that, so a game-over
   * screen shown twenty minutes into a run states what is left of the week
   * *now* rather than what was left when the run began.
   */
  private runWeek: Omit<WeekPayload, 'msRemaining'> | null = null;

  /**
   * The instant the run's week ends, as a real clock reading.
   *
   * Taken once beside the week itself, so the countdown on the game-over screen
   * belongs to the week the run was *played* under even if the week rolled over
   * mid-run. Deriving it again from the clock at the end of the run would hand
   * the player the new week's remainder under the old week's name.
   */
  private weekEndsAtMs = 0;

  /**
   * Which minute of the countdown the title screen is currently showing, so the
   * row is refreshed on the frame the figure changes and on no other. -1 is
   * "the screen has not been told anything yet", as `renameLockShown` is.
   */
  private weekTickShown = -1;

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

    // §14.8 — a scene that has just booted is on the title screen, which offers
    // both modes and has no run behind it to have been played in either.
    this.mode = RUN_MODE.WEEKLY;
    this.runWeek = null;
    this.weekEndsAtMs = 0;
    this.weekTickShown = -1;

    // §15 — read here, with the best score, and never again: both are storage
    // reads, and the restart path is not allowed either of them.
    this.nameEdit = null;
    this.renameLockShown = -1;
    this.displayName = ensureDisplayName({});
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
      keyboard.on(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, this.onKeyDown, this);
    }
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);

    this.emitDisplayName();
    this.emitWeek();
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
        this.syncRenameLock();
        this.syncWeek();
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

  /**
   * Every key the game hears, before anything decides what it means.
   *
   * There are exactly two branches above "any key starts the run", and both are
   * TITLE-only: a key typed into an open name editor belongs to the field, and
   * `INPUT_RENAME_KEY` opens that editor while a rename is available. Neither
   * exists in PLAYING or in GAME_OVER, so the restart path is the one it was
   * before §15 (`docs/vision.md` §3, condition C3.2).
   */
  private onKeyDown(event: KeyboardEvent): void {
    const action = keyAction(
      {
        onTitle: this.runState === RUN_STATE.TITLE,
        editing: this.nameEdit !== null,
        renameAvailable: this.renameOffered,
      },
      event.key,
    );

    switch (action) {
      case KEY_ACTION.EDIT_NAME:
        if (this.nameEdit !== null) {
          this.editName(this.nameEdit, event);
        }
        break;

      case KEY_ACTION.OPEN_NAME_EDITOR:
        // The game is taking this key, so the page does not also act on it.
        event.preventDefault();
        this.nameEdit = openNameEdit(this.displayName.name);
        this.emitDisplayName();
        break;

      case KEY_ACTION.START_FREE_PLAY:
        // §14.8 — the mode choice, in one key press. It is a run-starting key
        // like any other, so it goes through the same path a click does and
        // nothing is confirmed, armed or asked.
        this.onAnyInput(RUN_MODE.FREE_PLAY);
        break;

      case KEY_ACTION.RUN_INPUT:
        this.onAnyInput();
        break;
    }
  }

  /** §15.3 — whether the title screen is offering the rename key right now. */
  private get renameOffered(): boolean {
    return canRename(this.displayName, Date.now());
  }

  /**
   * §15.2 — keeps the cooldown on the title row true as it runs down.
   *
   * One clock reading and one comparison per title frame, and an event only on
   * the frame the figure actually changes — which is once a day at most, and
   * once a week in practice. PLAYING never reaches this.
   */
  private syncRenameLock(): void {
    if (renameLockDays(this.displayName, Date.now()) !== this.renameLockShown) {
      this.emitDisplayName();
    }
  }

  /**
   * §14.2 — keeps the week row on the title screen true while it sits open.
   *
   * One clock reading and one comparison per title frame, and an event only on
   * the frame the countdown's minute actually changes. When that minute is the
   * last one of the week the next tick resolves a different week, so a title
   * screen left open across a Monday 00:00 UTC+7 names the week that has begun
   * rather than the one that ended under it. PLAYING never reaches this (C2.2).
   */
  private syncWeek(): void {
    const nowMs = Date.now();

    if (Math.floor(msRemainingInWeek(nowMs) / WEEK_COUNTDOWN_TICK_MS) !== this.weekTickShown) {
      this.emitWeek(nowMs);
    }
  }

  /**
   * §14.2 and §14.8 — the week the title screen names: the one a run begun
   * from this screen would be played under.
   *
   * Resolved through `weeklyRunAt()`, the same entry point `resolveRunWeek()`
   * uses, so the week on the title screen and the week the run is configured
   * from cannot be resolved two different ways. No network and nothing awaited:
   * §14.2 is local arithmetic on the clock, which is what criterion 20 is about.
   */
  private emitWeek(nowMs = Date.now()): void {
    const msRemaining = msRemainingInWeek(nowMs);
    const week = weeklyRunAt(nowMs).week;

    this.weekTickShown = Math.floor(msRemaining / WEEK_COUNTDOWN_TICK_MS);

    if (week === null) {
      return;
    }

    const payload: WeekPayload = {
      key: week.key,
      entryId: week.entry.id,
      valueIndex: week.valueIndex,
      msRemaining,
    };
    this.events.emit(VIGIL_EVENTS.WEEK_CHANGED, payload);
  }

  /**
   * §14.2 — the week this run is played under, resolved **once**, here, at the
   * transition to PLAYING, and held for the whole run.
   *
   * A clock change, a rollover or a laptop waking from sleep mid-run retunes
   * nothing and renames nothing: the next run picks up the new week (criterion
   * 26). Free Play resolves no week at all — §14.8 does not let it read the
   * clock for one — so the row it would fill stays empty on both screens.
   *
   * `weeklyRunAt()` also returns the week's `config` and its seeded `random`,
   * which this task deliberately does not thread into `src/enemies`: the
   * screens are this task's and the beam and the spawner are a separate one's.
   * `CrawlerField.reset(run)` is the seam they arrive through when it lands,
   * and until then both modes play the shipped config.
   */
  private resolveRunWeek(): void {
    if (this.mode === RUN_MODE.FREE_PLAY) {
      this.runWeek = null;
      this.weekEndsAtMs = 0;
      return;
    }

    const nowMs = Date.now();
    const week = weeklyRunAt(nowMs).week;

    this.runWeek =
      week === null ? null : { key: week.key, entryId: week.entry.id, valueIndex: week.valueIndex };
    this.weekEndsAtMs = nowMs + msRemainingInWeek(nowMs);
  }

  /** The run's week as the screens state it, with the countdown read now. */
  private weekSnapshot(): WeekPayload | null {
    const week = this.runWeek;

    return week === null
      ? null
      : { ...week, msRemaining: Math.max(0, this.weekEndsAtMs - Date.now()) };
  }

  /**
   * One keystroke into the open name editor (§15.3).
   *
   * Every key the editor acts on has its default prevented, because the game
   * has consumed it: a space must not scroll the host page and a `/` must not
   * open the browser's quick-find. Keys the editor does *not* act on — TAB
   * above all — are left alone, so the player can always get focus back out of
   * the game. An editor you cannot tab out of is a keyboard trap, and leaving
   * it open while focus is elsewhere costs nothing: the draft is still there
   * when they come back.
   */
  private editName(session: NameEditState, event: KeyboardEvent): void {
    const key = event.key;

    if (key === 'Escape') {
      event.preventDefault();
      this.nameEdit = null;
    } else if (key === 'Enter') {
      event.preventDefault();
      const result = commitName(session);

      if (result.name === null) {
        this.nameEdit = result.state;
      } else {
        this.displayName = commitDisplayName(this.displayName, result.name, Date.now());
        this.nameEdit = null;
      }
    } else if (key === 'Backspace') {
      event.preventDefault();
      this.nameEdit = backspaceName(session);
    } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.nameEdit = typeIntoName(session, key);
    } else {
      // A modifier, a function key, TAB, a paste shortcut: not this field's.
      return;
    }

    this.emitDisplayName();
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
      // §14.8 — `R` restarts the mode just played. No prompt, no choice, and
      // nothing between this frame and the next playable one.
      this.startRun(this.mode);
    }
  }

  /**
   * Any key or any click: starts the run from TITLE, and lifts a §2.5 pause.
   * Otherwise it does nothing — restart is INPUT_RESTART_KEY and goes through
   * the lockout in stepGameOver.
   *
   * The pause case comes first because a suspended run is still PLAYING, and
   * the one thing the player can do to it is carry on.
   *
   * @param mode Which mode a run started from here is played in (§14.8). Every
   *   key but `INPUT_FREE_PLAY_KEY`, and every click, begins the weekly vigil —
   *   which is what the title prompt names. Read on the TITLE branch only: a
   *   pause being lifted is the run it already belongs to carrying on.
   */
  private onAnyInput(mode: RunMode = RUN_MODE.WEEKLY): void {
    // §15.3 — a click while the name editor is open does not start a run. The
    // player is mid-sentence; the two keys that end the editor are on screen,
    // and a run that began under their cursor would throw the draft away.
    if (this.nameEdit !== null) {
      return;
    }

    if (this.paused) {
      this.resumeFromPause();
      return;
    }

    if (this.runState === RUN_STATE.TITLE) {
      this.startRun(mode);
    }
  }

  /**
   * §2.2 — entry to PLAYING, from TITLE and from GAME_OVER alike.
   *
   * @param mode The mode to play in. From TITLE it is whichever key or click
   *   got here; from GAME_OVER it is `this.mode`, the mode just played, which
   *   is §14.8's rule that `R` never asks the question again.
   */
  private startRun(mode: RunMode): void {
    this.mode = mode;
    this.resolveRunWeek();
    this.runState = RUN_STATE.PLAYING;
    this.elapsedSeconds = 0;
    this.banished = 0;
    this.score = 0;
    this.restartLockoutLeft = 0;
    this.restartBuffered = false;
    this.field.reset();

    // §15 — belt and braces. Nothing can start a run with the editor open, so
    // this is never true; if it ever became true, the screen would be told on
    // the same frame rather than left showing a field over a live run.
    if (this.nameEdit !== null) {
      this.nameEdit = null;
      this.emitDisplayName();
    }

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

    // The mode is named because criterion 29 asks for the restart to be
    // measured in *both* modes: a weekly restart resolves a week on the way
    // through and a Free Play one does not, so the two numbers are two
    // measurements and the log has to say which is which.
    const verdict = RestartClock.withinBudget(measured) ? 'within' : 'OVER';
    console.info(
      `[vigil] ${this.mode} restart ${verdict} budget: ` +
        `${measured.fromDeathMs.toFixed(1)} ms from death, ` +
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
      mode: this.mode,
      week: this.weekSnapshot(),
    };
    this.events.emit(VIGIL_EVENTS.RUN_STATE_CHANGED, payload);
  }

  /**
   * §15.2 — the whole name block, in one reading.
   *
   * Emitted when the name or the editing session changes, and never on a frame
   * of PLAYING: this event is a title-screen event.
   */
  private emitDisplayName(): void {
    const payload: DisplayNamePayload = {
      name: this.displayName.name,
      renameLockDays: renameLockDays(this.displayName, Date.now()),
      editing: this.nameEdit !== null,
      draft: this.nameEdit?.draft ?? null,
      notice: this.nameEdit?.notice ?? null,
    };

    this.renameLockShown = payload.renameLockDays;
    this.events.emit(VIGIL_EVENTS.DISPLAY_NAME_CHANGED, payload);
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
