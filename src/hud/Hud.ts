// src/hud owns the on-screen readouts. This is the one piece of it the scene
// knows about: construct it, and it wires itself to the event contract in
// `src/scenes/events.ts`.
//
// It holds no rules. Every figure it shows arrives on an event, and the only
// state it keeps is the three things an event payload does not carry: which way
// the beam is currently moving, what the best score was when this run started,
// and where the crawler that ended the run made contact.

import Phaser from 'phaser';

import {
  BEAM_STATE,
  RUN_STATE,
  VIGIL_EVENTS,
  type BeamState,
  type BeamStatePayload,
  type DisplayNamePayload,
  type PausePayload,
  type PointPayload,
  type PowerPayload,
  type RunStatePayload,
  type ScorePayload,
  type WeekPayload,
} from '../scenes/events';
import { GameOverOverlay } from './GameOverOverlay';
import { NameEditorOverlay } from './NameEditorOverlay';
import { PauseOverlay } from './PauseOverlay';
import { PlayHud } from './PlayHud';
import { TitleOverlay } from './TitleOverlay';

export class Hud {
  private readonly scene: Phaser.Scene;
  private readonly play: PlayHud;
  private readonly title: TitleOverlay;
  private readonly gameOver: GameOverOverlay;

  /**
   * `docs/design.md` §15.3. Built with the rest of them, shown only over the
   * title screen, and taken down by `onRunState` on any state that is not
   * TITLE — which is the HUD's half of condition C3.2: whatever the scene
   * does, there is no frame of PLAYING or GAME_OVER with a name field on it.
   */
  private readonly nameEditor: NameEditorOverlay;

  /**
   * §2.5. Built last so that it wins the depth tie against the other two
   * overlays: a pause covers whatever was on screen when it began.
   */
  private readonly pause: PauseOverlay;

  /**
   * What the beam is doing, so the power meter can say whether the drain is
   * being spent on purpose. `docs/design.md` §2.2 resets the beam to WIDE on
   * every entry to PLAYING, and `Beam.reset` does that without emitting, so
   * this mirrors the reset rather than waiting for an event that will not come.
   */
  private beamState: BeamState = BEAM_STATE.WIDE;

  /**
   * The best score as it stood when this run began. "New best" means beating
   * it; equalling it is not beating it, and comparing against the *final* best
   * cannot tell the two apart because the scene has already overwritten it.
   */
  private bestAtRunStart = 0;

  /** Where the run ended, for the mark on the game-over screen. */
  private contact: PointPayload | null = null;

  public constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.play = new PlayHud(scene);
    this.title = new TitleOverlay(scene);
    this.gameOver = new GameOverOverlay(scene);
    this.nameEditor = new NameEditorOverlay(scene);
    this.pause = new PauseOverlay(scene);

    scene.events.on(VIGIL_EVENTS.RUN_STATE_CHANGED, this.onRunState, this);
    scene.events.on(VIGIL_EVENTS.DISPLAY_NAME_CHANGED, this.onDisplayName, this);
    scene.events.on(VIGIL_EVENTS.WEEK_CHANGED, this.onWeek, this);
    scene.events.on(VIGIL_EVENTS.PAUSE_CHANGED, this.onPause, this);
    scene.events.on(VIGIL_EVENTS.POWER_CHANGED, this.onPower, this);
    scene.events.on(VIGIL_EVENTS.SCORE_CHANGED, this.onScore, this);
    scene.events.on(VIGIL_EVENTS.BEAM_STATE_CHANGED, this.onBeamState, this);
    scene.events.on(VIGIL_EVENTS.LAMP_HIT, this.onLampHit, this);

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.unsubscribe, this);
  }

  /** `docs/design.md` §2 — which screen is up. */
  private onRunState(payload: RunStatePayload): void {
    switch (payload.state) {
      case RUN_STATE.TITLE:
        this.gameOver.hide();
        this.play.setVisible(false);
        this.title.show(payload.bestScore);
        break;

      case RUN_STATE.PLAYING:
        this.beamState = BEAM_STATE.WIDE;
        this.bestAtRunStart = payload.bestScore;
        this.contact = null;

        this.title.hide();
        this.gameOver.hide();
        this.nameEditor.hide();
        this.play.setVisible(true);
        break;

      case RUN_STATE.GAME_OVER:
        // The overlay carries every figure the play HUD was showing, so the
        // readouts come down rather than being stacked under the scrim.
        this.play.setVisible(false);
        this.nameEditor.hide();
        this.gameOver.show(payload, payload.bestScore > this.bestAtRunStart, this.contact);
        break;
    }
  }

  /**
   * §15.2 — the name, the state of its weekly rename, and the editor if one is
   * open. The title row is written whether or not the title screen is up, so
   * that showing it is never a frame behind the name it states.
   */
  private onDisplayName(payload: DisplayNamePayload): void {
    this.title.showDisplayName(payload);
    this.nameEditor.show(payload);
  }

  /**
   * §14.2 — the week the title screen is naming, or a minute of it passing.
   *
   * A title-screen event: it is written straight to the title overlay and
   * reaches no other screen. The week a *run* was played under arrives on the
   * run-state payload instead, and the play HUD is handed neither — C2.2 keeps
   * every frame of PLAYING clear of the week.
   */
  private onWeek(payload: WeekPayload): void {
    this.title.showWeek(payload);
  }

  /** §2.5 — the run is suspended, or is not any more. */
  private onPause(payload: PausePayload): void {
    this.pause.setVisible(payload.paused);
  }

  private onPower(payload: PowerPayload): void {
    this.play.showPower(payload, this.beamState);
  }

  private onScore(payload: ScorePayload): void {
    this.play.showScore(payload);
  }

  private onBeamState(payload: BeamStatePayload): void {
    this.beamState = payload.state;
  }

  private onLampHit(payload: PointPayload): void {
    this.contact = payload;
  }

  /**
   * Phaser keeps scene event listeners across a shutdown so a scene can be
   * restarted, so they are removed by hand. The display objects go with the
   * scene on their own.
   */
  private unsubscribe(): void {
    const events = this.scene.events;

    events.off(VIGIL_EVENTS.RUN_STATE_CHANGED, this.onRunState, this);
    events.off(VIGIL_EVENTS.DISPLAY_NAME_CHANGED, this.onDisplayName, this);
    events.off(VIGIL_EVENTS.WEEK_CHANGED, this.onWeek, this);
    events.off(VIGIL_EVENTS.PAUSE_CHANGED, this.onPause, this);
    events.off(VIGIL_EVENTS.POWER_CHANGED, this.onPower, this);
    events.off(VIGIL_EVENTS.SCORE_CHANGED, this.onScore, this);
    events.off(VIGIL_EVENTS.BEAM_STATE_CHANGED, this.onBeamState, this);
    events.off(VIGIL_EVENTS.LAMP_HIT, this.onLampHit, this);
  }
}
