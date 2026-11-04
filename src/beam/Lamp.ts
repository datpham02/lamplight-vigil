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

/**
 * Bakes the soft halo into a canvas texture once, the first time a scene asks
 * for it. Regenerating a gradient every frame is the performance trap called out
 * in docs/concept.md §9, so this is deliberately a boot-time cost.
 *
 * Returns false if the renderer refused the texture, in which case the lamp
 * still draws its core and simply goes without a halo.
 */
function ensureGlowTexture(scene: Phaser.Scene): boolean {
  if (scene.textures.exists(LAMP_GLOW_TEXTURE_KEY)) {
    return true;
  }

  const diameter = LAMP_GLOW_RADIUS * 2;
  const texture = scene.textures.createCanvas(LAMP_GLOW_TEXTURE_KEY, diameter, diameter);
  if (!texture) {
    return false;
  }

  const ctx = texture.getContext();
  const { red, green, blue } = Phaser.Display.Color.IntegerToColor(LAMP_GLOW_COLOR);
  const rgba = (alpha: number): string => `rgba(${red}, ${green}, ${blue}, ${alpha})`;

  const gradient = ctx.createRadialGradient(
    LAMP_GLOW_RADIUS,
    LAMP_GLOW_RADIUS,
    0,
    LAMP_GLOW_RADIUS,
    LAMP_GLOW_RADIUS,
    LAMP_GLOW_RADIUS,
  );
  gradient.addColorStop(0, rgba(LAMP_GLOW_ALPHA));
  gradient.addColorStop(LAMP_GLOW_MID_STOP, rgba(LAMP_GLOW_ALPHA * LAMP_GLOW_MID_ALPHA_SCALE));
  gradient.addColorStop(1, rgba(0));

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, diameter, diameter);
  texture.refresh();

  return true;
}

/**
 * The lamp at the centre of the hollow: a bright core and a soft halo.
 *
 * Rendering only. The lamp has no run state of its own — the pulse phase is
 * derived from the scene's per-run clock, which the scene resets in init().
 */
export class Lamp {
  private readonly glow: Phaser.GameObjects.Image | null;

  public constructor(scene: Phaser.Scene) {
    this.glow = ensureGlowTexture(scene)
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
