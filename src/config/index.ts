// src/config owns every tuning value in the game; no magic numbers elsewhere.
//
// INITIAL SEED VALUES ONLY. Everything below exists because the skeleton has to
// draw something; none of it is balanced or final. `docs/design.md` (concept §8
// task 1) is the authority on real values, and the core-loop task is expected to
// replace these and add its own sections here rather than inlining numbers into
// scenes, beam, enemies or HUD code.

// ---------------------------------------------------------------------------
// Render target
// ---------------------------------------------------------------------------

/** Fixed render size. The canvas is scaled to the window, never re-laid out. */
export const RENDER_WIDTH = 960;
export const RENDER_HEIGHT = 540;

/** The dark hollow the lamp stands in. */
export const BACKGROUND_COLOR = '#06070b';

/**
 * Draw order. Low numbers sit behind high ones. Named so no module has to guess
 * what another module put on the display list.
 */
export const BEAM_DEPTH = 10;
export const LAMP_GLOW_DEPTH = 20;
export const LAMP_DEPTH = 30;

// ---------------------------------------------------------------------------
// Lamp — the fixed light source at the centre of the hollow
// ---------------------------------------------------------------------------

/** The lamp never moves; it is the origin of every beam calculation. */
export const LAMP_X = RENDER_WIDTH / 2;
export const LAMP_Y = RENDER_HEIGHT / 2;

export const LAMP_RADIUS = 18;
export const LAMP_COLOR = 0xffd9a0;

/** Soft halo baked into a texture once at boot (see src/beam/Lamp.ts). */
export const LAMP_GLOW_TEXTURE_KEY = 'lamp-glow';
export const LAMP_GLOW_RADIUS = 64;
export const LAMP_GLOW_COLOR = 0xffb347;
export const LAMP_GLOW_ALPHA = 0.28;

/** Mid gradient stop, so the halo falls off softly instead of linearly. */
export const LAMP_GLOW_MID_STOP = 0.45;
export const LAMP_GLOW_MID_ALPHA_SCALE = 0.35;

/** Cosmetic breathing of the halo. Purely visual; drives no gameplay state. */
export const LAMP_PULSE_PERIOD_MS = 2600;
export const LAMP_PULSE_ALPHA_SWING = 0.12;

// ---------------------------------------------------------------------------
// Beam — rendering only at this stage; width control and power are task 3
// ---------------------------------------------------------------------------

/**
 * Reach of the cone. The farthest corner of the render target is
 * hypot(960/2, 540/2) ~= 551px from the lamp, so this covers the whole field.
 */
export const BEAM_LENGTH = 560;

/** Total included angle of the wide beam, in degrees. */
export const BEAM_WIDE_ANGLE_DEG = 54;

/** Where the beam points before the player has moved the mouse (up-screen). */
export const BEAM_REST_ANGLE_DEG = -90;

export const BEAM_COLOR = 0xffe9bf;

/** One layer of the cone's falloff. */
export interface BeamConeLayer {
  /** Fraction of BEAM_LENGTH this layer reaches. */
  readonly lengthScale: number;
  /** Alpha this layer contributes. Layers stack, so near the lamp is brightest. */
  readonly alpha: number;
}

/**
 * Nested slices, longest first, approximating distance falloff with alpha only
 * (concept §7 rules out shaders and the Light2D pipeline). Built once at boot
 * and then rotated — never redrawn per frame.
 */
export const BEAM_CONE_LAYERS: readonly BeamConeLayer[] = [
  { lengthScale: 1, alpha: 0.05 },
  { lengthScale: 0.72, alpha: 0.05 },
  { lengthScale: 0.42, alpha: 0.06 },
  { lengthScale: 0.18, alpha: 0.07 },
];
