// src/hud owns the on-screen readouts. This is the set of them that is up
// while the run is.
//
// Everything sits in the four corners. That is not a style choice: crawlers
// enter from the edges and walk toward the lamp in the middle, so the corners
// are the only part of the frame they move *away* from, and a readout there is
// the one that never ends up on top of the thing the player is trying to see
// (`docs/vision.md` pillar 2).
//
//   top-left      lamp power, the meter, and what the beam is doing for it
//   top-right     score, and the best score it is chasing
//   bottom-left   time survived
//   bottom-right  crawlers banished, and how fast they are arriving now
//
// Nothing here decides anything. It renders the payloads `src/scenes` emits.

import Phaser from 'phaser';

import {
  HUD_BANISHED_LABEL_Y,
  HUD_BANISHED_VALUE_Y,
  HUD_BEST_Y,
  HUD_CLUSTER_MAX_WIDTH,
  HUD_DEPTH,
  HUD_LABEL_SIZE,
  HUD_LABEL_TRACKING,
  HUD_LEFT_X,
  HUD_NEXT_SPAWN_Y,
  HUD_NOTE_SIZE,
  HUD_POWER_LABEL_Y,
  HUD_POWER_METER_WIDTH,
  HUD_POWER_STATUS_Y,
  HUD_RIGHT_X,
  HUD_SCORE_LABEL_Y,
  HUD_SCORE_SIZE,
  HUD_SCORE_VALUE_Y,
  HUD_STATUS_SIZE,
  HUD_SURGE_Y,
  HUD_TEXT_DIM,
  HUD_TEXT_PRIMARY,
  HUD_TEXT_WARN,
  HUD_TIME_LABEL_Y,
  HUD_TIME_VALUE_Y,
  HUD_VALUE_SIZE,
} from '../config/index';
import { BEAM_STATE, type BeamState, type PowerPayload, type ScorePayload } from '../scenes/events';
import { PowerMeter, type PowerMood } from './PowerMeter';
import { formatCount } from './layout';
import { scoreReadouts } from './readouts';
import * as strings from './strings';
import { hudText, setTextIfChanged } from './text';

/** Colour of the status line under the meter, by what the power is doing. */
const STATUS_COLOR: Readonly<Record<PowerMood, string>> = {
  banked: HUD_TEXT_DIM,
  draining: HUD_TEXT_WARN,
  locked: HUD_TEXT_WARN,
};

const STATUS_TEXT: Readonly<Record<PowerMood, string>> = {
  banked: strings.STATUS_WIDE,
  draining: strings.STATUS_FOCUSED,
  locked: strings.STATUS_LOCKED_OUT,
};

/** The beam states that are spending power (`docs/design.md` §4.1). */
const DRAINING_STATES: readonly BeamState[] = [BEAM_STATE.NARROWING, BEAM_STATE.FOCUSED];

export class PlayHud {
  private readonly container: Phaser.GameObjects.Container;
  private readonly meter: PowerMeter;

  private readonly powerValue: Phaser.GameObjects.Text;
  private readonly powerStatus: Phaser.GameObjects.Text;
  private readonly scoreValue: Phaser.GameObjects.Text;
  private readonly bestValue: Phaser.GameObjects.Text;
  private readonly timeValue: Phaser.GameObjects.Text;
  private readonly banishedValue: Phaser.GameObjects.Text;
  private readonly nextSpawn: Phaser.GameObjects.Text;
  private readonly surge: Phaser.GameObjects.Text;

  private drawnMood: PowerMood | null = null;

  public constructor(scene: Phaser.Scene) {
    this.meter = new PowerMeter(scene);

    const powerLabel = label(scene, HUD_LEFT_X, HUD_POWER_LABEL_Y, 'left', strings.LABEL_POWER);
    this.powerValue = hudText(scene, {
      x: HUD_LEFT_X + HUD_POWER_METER_WIDTH,
      y: HUD_POWER_LABEL_Y,
      content: '',
      size: HUD_LABEL_SIZE,
      color: HUD_TEXT_PRIMARY,
      align: 'right',
      mono: true,
    });
    this.powerStatus = hudText(scene, {
      x: HUD_LEFT_X,
      y: HUD_POWER_STATUS_Y,
      content: strings.STATUS_WIDE,
      size: HUD_STATUS_SIZE,
      color: HUD_TEXT_DIM,
      align: 'left',
    });

    const scoreLabel = label(scene, HUD_RIGHT_X, HUD_SCORE_LABEL_Y, 'right', strings.LABEL_SCORE);
    this.scoreValue = value(scene, HUD_RIGHT_X, HUD_SCORE_VALUE_Y, 'right', HUD_SCORE_SIZE);
    this.bestValue = hudText(scene, {
      x: HUD_RIGHT_X,
      y: HUD_BEST_Y,
      content: '',
      size: HUD_LABEL_SIZE,
      color: HUD_TEXT_DIM,
      align: 'right',
      mono: true,
    });

    const timeLabel = label(scene, HUD_LEFT_X, HUD_TIME_LABEL_Y, 'left', strings.LABEL_TIME);
    this.timeValue = value(scene, HUD_LEFT_X, HUD_TIME_VALUE_Y, 'left', HUD_VALUE_SIZE);

    const banishedLabel = label(
      scene,
      HUD_RIGHT_X,
      HUD_BANISHED_LABEL_Y,
      'right',
      strings.LABEL_BANISHED,
    );
    this.banishedValue = value(scene, HUD_RIGHT_X, HUD_BANISHED_VALUE_Y, 'right', HUD_VALUE_SIZE);
    this.nextSpawn = hudText(scene, {
      x: HUD_RIGHT_X,
      y: HUD_NEXT_SPAWN_Y,
      content: '',
      size: HUD_NOTE_SIZE,
      color: HUD_TEXT_PRIMARY,
      align: 'right',
    });
    this.surge = hudText(scene, {
      x: HUD_RIGHT_X,
      y: HUD_SURGE_Y,
      content: '',
      size: HUD_NOTE_SIZE,
      color: HUD_TEXT_DIM,
      align: 'right',
    });

    this.container = scene.add.container(0, 0, [
      this.meter.display,
      powerLabel,
      this.powerValue,
      this.powerStatus,
      scoreLabel,
      this.scoreValue,
      this.bestValue,
      timeLabel,
      this.timeValue,
      banishedLabel,
      this.banishedValue,
      this.nextSpawn,
      this.surge,
    ]);
    this.container.setDepth(HUD_DEPTH);
  }

  public setVisible(visible: boolean): void {
    this.container.setVisible(visible);
  }

  /** `docs/design.md` §4 — the whole power economy, as a bar and one line. */
  public showPower(payload: PowerPayload, beamState: BeamState): void {
    const mood: PowerMood = payload.focusLockedOut
      ? 'locked'
      : DRAINING_STATES.includes(beamState)
        ? 'draining'
        : 'banked';

    this.meter.draw(payload.power, payload.max, payload.rearmAt, mood);
    setTextIfChanged(this.powerValue, formatCount(payload.power));

    if (mood !== this.drawnMood) {
      this.drawnMood = mood;
      this.powerStatus.setColor(STATUS_COLOR[mood]);
      setTextIfChanged(this.powerStatus, STATUS_TEXT[mood]);
      warnIfOverBudget(this.powerStatus);
    }
  }

  /**
   * Score, best score, time survived, banishments, and the spawn clock: both
   * the countdown the spawner is holding and the §5.4 interval it resets to.
   *
   * What to show is decided in `readouts.ts`, which has no Phaser in it and so
   * can be asserted on; this method only puts the result on screen.
   */
  public showScore(payload: ScorePayload): void {
    const readouts = scoreReadouts(payload);

    setTextIfChanged(this.scoreValue, readouts.score);
    setTextIfChanged(this.bestValue, readouts.best);
    setTextIfChanged(this.timeValue, readouts.time);
    setTextIfChanged(this.banishedValue, readouts.banished);
    setTextIfChanged(this.nextSpawn, readouts.nextSpawn);
    setTextIfChanged(this.surge, readouts.surge);
  }
}

function label(
  scene: Phaser.Scene,
  x: number,
  y: number,
  align: 'left' | 'right',
  content: string,
): Phaser.GameObjects.Text {
  const text = hudText(scene, {
    x,
    y,
    content,
    size: HUD_LABEL_SIZE,
    color: HUD_TEXT_DIM,
    align,
    tracking: HUD_LABEL_TRACKING,
  });

  warnIfOverBudget(text);
  return text;
}

function value(
  scene: Phaser.Scene,
  x: number,
  y: number,
  align: 'left' | 'right',
  size: number,
): Phaser.GameObjects.Text {
  return hudText(scene, {
    x,
    y,
    content: '',
    size,
    color: HUD_TEXT_PRIMARY,
    align,
    mono: true,
  });
}

/**
 * `src/hud/layout.ts` proves the four corner clusters fit inside the margins
 * and clear each other at `HUD_CLUSTER_MAX_WIDTH`. It cannot measure a string,
 * so this is the other half of that proof: in a dev build, any fixed string
 * that overruns the budget says so in the console instead of quietly reaching
 * toward the middle of the screen.
 */
function warnIfOverBudget(text: Phaser.GameObjects.Text): void {
  if (import.meta.env.DEV && text.width > HUD_CLUSTER_MAX_WIDTH) {
    console.warn(
      `HUD: "${text.text}" is ${Math.round(text.width)}px wide, over the ` +
        `${HUD_CLUSTER_MAX_WIDTH}px cluster budget in src/config.`,
    );
  }
}
