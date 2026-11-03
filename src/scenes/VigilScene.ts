// src/scenes owns the Phaser scenes and their lifecycle wiring.
import Phaser from 'phaser';

import {
  LAMP_COLOR,
  LAMP_GLOW_ALPHA,
  LAMP_GLOW_COLOR,
  LAMP_GLOW_RADIUS,
  LAMP_RADIUS,
  RENDER_HEIGHT,
  RENDER_WIDTH,
} from '../config/index';

/**
 * Placeholder scene for the skeleton: a single lamp in the centre of the dark
 * hollow. Beam, enemies and HUD are added by later tasks.
 */
export class VigilScene extends Phaser.Scene {
  public static readonly KEY = 'vigil';

  constructor() {
    super(VigilScene.KEY);
  }

  // Not `override`: Phaser's Scene base class does not declare create().
  create(): void {
    const centreX = RENDER_WIDTH / 2;
    const centreY = RENDER_HEIGHT / 2;

    this.add.circle(centreX, centreY, LAMP_GLOW_RADIUS, LAMP_GLOW_COLOR, LAMP_GLOW_ALPHA);
    this.add.circle(centreX, centreY, LAMP_RADIUS, LAMP_COLOR);
  }
}
