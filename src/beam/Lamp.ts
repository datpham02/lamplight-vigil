// src/beam owns the player's light. The lamp is the fixed source that light
// comes from; the cone it casts lives in Beam.ts.
import Phaser from 'phaser';

import {
  LAMP_COLOR,
  LAMP_DEPTH,
  LAMP_GLOW_ALPHA,
  LAMP_GLOW_COLOR,
  LAMP_GLOW_DEPTH,
  LAMP_GLOW_MID_ALPHA_SCALE,
  LAMP_GLOW_MID_STOP,
  LAMP_GLOW_RADIUS,
  LAMP_GLOW_TEXTURE_KEY,
  LAMP_PULSE_ALPHA_SWING,
  LAMP_PULSE_PERIOD_MS,
  LAMP_RADIUS,
  LAMP_X,
  LAMP_Y,
} from '../config/index';
import { ensureRadialGlowTexture, type RadialGlowSpec } from './glowTexture';

/**
 * The lamp's halo, baked once at boot. The beam's bloom is the same kind of
 * texture from the same helper — see `glowTexture.ts` for why neither is ever
 * regenerated per frame.
 */
const LAMP_GLOW: RadialGlowSpec = {
  key: LAMP_GLOW_TEXTURE_KEY,
  radius: LAMP_GLOW_RADIUS,
  color: LAMP_GLOW_COLOR,
  alpha: LAMP_GLOW_ALPHA,
  midStop: LAMP_GLOW_MID_STOP,
  midAlphaScale: LAMP_GLOW_MID_ALPHA_SCALE,
};

/**
 * The lamp at the centre of the hollow: a bright core and a soft halo.
 *
 * Rendering only. The lamp has no run state of its own — the pulse phase is
 * derived from the scene's per-run clock, which the scene resets in init().
 */
export class Lamp {
  private readonly glow: Phaser.GameObjects.Image | null;

  public constructor(scene: Phaser.Scene) {
    this.glow = ensureRadialGlowTexture(scene, LAMP_GLOW)
      ? scene.add.image(LAMP_X, LAMP_Y, LAMP_GLOW_TEXTURE_KEY).setDepth(LAMP_GLOW_DEPTH)
      : null;

    // The core never changes, so nothing needs to keep a reference to it.
    scene.add.circle(LAMP_X, LAMP_Y, LAMP_RADIUS, LAMP_COLOR).setDepth(LAMP_DEPTH);
  }

  /**
   * @param elapsedMs Milliseconds since the current run began, accumulated from
   * the scene's delta time so the pulse runs at the same rate on any frame rate.
   */
  public update(elapsedMs: number): void {
    if (this.glow === null) {
      return;
    }

    const phase = ((elapsedMs % LAMP_PULSE_PERIOD_MS) / LAMP_PULSE_PERIOD_MS) * Math.PI * 2;
    this.glow.setAlpha(1 + Math.sin(phase) * LAMP_PULSE_ALPHA_SWING);
  }
}
