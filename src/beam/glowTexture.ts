// src/beam owns the player's light. Both of the game's soft glows — the lamp's
// halo and the beam's bloom — are the same thing: a radial gradient baked into a
// canvas texture once, the first time a scene asks for it.
//
// Regenerating a gradient per frame is the named performance trap in
// `docs/concept.md` §9, and `docs/vision.md` §6 criterion 3 is the frame rate it
// would cost. Baking is therefore deliberately a boot-time cost, and this is the
// only place in the game that writes pixels.
import Phaser from 'phaser';

/** One baked radial glow. Every field is a named export in `src/config`. */
export interface RadialGlowSpec {
  /** Texture key. Also how a second scene finds an already-baked texture. */
  readonly key: string;
  /** Radius in px. The texture is a square of twice this. */
  readonly radius: number;
  readonly color: number;
  /** Alpha at the centre. The edge is always fully transparent. */
  readonly alpha: number;
  /** Where the mid gradient stop sits, 0 to 1, so falloff is soft not linear. */
  readonly midStop: number;
  /** The mid stop's alpha, as a share of `alpha`. */
  readonly midAlphaScale: number;
}

/**
 * Bakes `spec` into a canvas texture, or does nothing if that key is already
 * baked.
 *
 * @returns false if the renderer refused the texture, in which case the caller
 * is expected to go without its glow rather than fall back to drawing one per
 * frame. A missing glow is cosmetic; a per-frame gradient is a frame-rate bug.
 */
export function ensureRadialGlowTexture(scene: Phaser.Scene, spec: RadialGlowSpec): boolean {
  if (scene.textures.exists(spec.key)) {
    return true;
  }

  const diameter = spec.radius * 2;
  const texture = scene.textures.createCanvas(spec.key, diameter, diameter);
  if (!texture) {
    return false;
  }

  const ctx = texture.getContext();
  const { red, green, blue } = Phaser.Display.Color.IntegerToColor(spec.color);
  const rgba = (alpha: number): string => `rgba(${red}, ${green}, ${blue}, ${alpha})`;

  const gradient = ctx.createRadialGradient(
    spec.radius,
    spec.radius,
    0,
    spec.radius,
    spec.radius,
    spec.radius,
  );
  gradient.addColorStop(0, rgba(spec.alpha));
  gradient.addColorStop(spec.midStop, rgba(spec.alpha * spec.midAlphaScale));
  gradient.addColorStop(1, rgba(0));

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, diameter, diameter);
  texture.refresh();

  return true;
}
