// src/config owns every tuning value in the game; no magic numbers elsewhere.

/** Fixed render size. The canvas is scaled to the window, never re-laid out. */
export const RENDER_WIDTH = 960;
export const RENDER_HEIGHT = 540;

/** The dark hollow the lamp stands in. */
export const BACKGROUND_COLOR = '#06070b';

/** Placeholder lamp, drawn at the centre of the screen. */
export const LAMP_RADIUS = 18;
export const LAMP_COLOR = 0xffd9a0;
export const LAMP_GLOW_RADIUS = 64;
export const LAMP_GLOW_COLOR = 0xffb347;
export const LAMP_GLOW_ALPHA = 0.18;
