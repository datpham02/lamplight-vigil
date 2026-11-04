// src/hud owns the on-screen readouts. This one is the lamp's power.
//
// It is the readout the player is least able to look at: their eyes are on the
// beam and on whatever is walking toward the lamp. So it answers its question —
// "can I burn, and for how much longer?" — with a length and a colour, and puts
// the digits second.
//
// Three colours, three meanings (`docs/design.md` §4):
//
//   lamplight  power banked, the focused beam is available
//   ember      power leaving the meter, the beam is burning for it right now
//   hollow     §4.2 lockout: focus is being ignored until the fill reaches the
//              rearm tick, which is drawn across the track so the player can see
//              how much further it has to climb
//
// §4.2 is explicit that both the level and the threshold must be on screen, and
// pillar 2 is explicit that a locked-out key with no visible reason is hidden
// state. The tick is that reason.

import Phaser from 'phaser';

import {
  HUD_LEFT_X,
  HUD_POWER_BORDER_ALPHA,
  HUD_POWER_BORDER_WIDTH,
  HUD_POWER_DRAIN_COLOR,
  HUD_POWER_FILL_COLOR,
  HUD_POWER_LOCKED_COLOR,
  HUD_POWER_METER_CORNER_RADIUS,
  HUD_POWER_METER_HEIGHT,
  HUD_POWER_METER_WIDTH,
  HUD_POWER_METER_Y,
  HUD_POWER_REARM_TICK_ALPHA,
  HUD_POWER_REARM_TICK_COLOR,
  HUD_POWER_REARM_TICK_OVERHANG,
  HUD_POWER_REARM_TICK_WIDTH,
  HUD_POWER_TRACK_ALPHA,
} from '../config/index';
import { powerFillWidth, powerMarkX } from './layout';

/** What the power is doing, which is what sets the fill colour. */
export type PowerMood = 'banked' | 'draining' | 'locked';

const FILL_COLOR: Readonly<Record<PowerMood, number>> = {
  banked: HUD_POWER_FILL_COLOR,
  draining: HUD_POWER_DRAIN_COLOR,
  locked: HUD_POWER_LOCKED_COLOR,
};

/** Fully opaque. The meter is the one readout that never competes with the world. */
const SOLID = 1;

export class PowerMeter {
  private readonly graphics: Phaser.GameObjects.Graphics;

  /** Last drawn state, so a settled meter is not redrawn every frame. */
  private drawnWidth = -1;
  private drawnMood: PowerMood | null = null;
  private drawnTickX = -1;

  public constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics();
  }

  /** The graphics object, for the caller to add to its container. */
  public get display(): Phaser.GameObjects.Graphics {
    return this.graphics;
  }

  /**
   * @param power Current lamp power.
   * @param max `POWER_MAX`, passed in on the event rather than imported.
   * @param rearmAt `POWER_FOCUS_REARM` — where the §4.2 tick goes.
   */
  public draw(power: number, max: number, rearmAt: number, mood: PowerMood): void {
    // Whole pixels: a fill that lands on a half pixel shimmers as it drains.
    const fillWidth = Math.round(powerFillWidth(power, max));
    const tickX = Math.round(powerMarkX(rearmAt, max));

    if (fillWidth === this.drawnWidth && mood === this.drawnMood && tickX === this.drawnTickX) {
      return;
    }

    this.drawnWidth = fillWidth;
    this.drawnMood = mood;
    this.drawnTickX = tickX;

    const g = this.graphics;
    g.clear();

    // The empty track, so the meter has a shape even at zero power.
    g.fillStyle(FILL_COLOR[mood], HUD_POWER_TRACK_ALPHA);
    g.fillRoundedRect(
      HUD_LEFT_X,
      HUD_POWER_METER_Y,
      HUD_POWER_METER_WIDTH,
      HUD_POWER_METER_HEIGHT,
      HUD_POWER_METER_CORNER_RADIUS,
    );

    if (fillWidth > 0) {
      // A corner radius wider than the bar itself inverts the rounding, which
      // is what the last few pixels of a drain would otherwise look like.
      const radius = Math.min(HUD_POWER_METER_CORNER_RADIUS, fillWidth / 2);

      g.fillStyle(FILL_COLOR[mood], SOLID);
      g.fillRoundedRect(HUD_LEFT_X, HUD_POWER_METER_Y, fillWidth, HUD_POWER_METER_HEIGHT, radius);
    }

    // §4.2 — the rearm threshold, drawn over the fill so it stays findable once
    // the fill has climbed past it.
    g.fillStyle(HUD_POWER_REARM_TICK_COLOR, HUD_POWER_REARM_TICK_ALPHA);
    g.fillRect(
      tickX - HUD_POWER_REARM_TICK_WIDTH / 2,
      HUD_POWER_METER_Y - HUD_POWER_REARM_TICK_OVERHANG,
      HUD_POWER_REARM_TICK_WIDTH,
      HUD_POWER_METER_HEIGHT + HUD_POWER_REARM_TICK_OVERHANG * 2,
    );

    g.lineStyle(HUD_POWER_BORDER_WIDTH, FILL_COLOR[mood], HUD_POWER_BORDER_ALPHA);
    g.strokeRoundedRect(
      HUD_LEFT_X,
      HUD_POWER_METER_Y,
      HUD_POWER_METER_WIDTH,
      HUD_POWER_METER_HEIGHT,
      HUD_POWER_METER_CORNER_RADIUS,
    );
  }
}
