// src/config owns every tuning value in the game; no magic numbers elsewhere.
//
// INITIAL SEED VALUES ONLY. Everything below exists because the skeleton's
// placeholder scene has to draw something; none of it is balanced or final.
// Gameplay tasks are expected to replace these and add their own sections here
// rather than inlining numbers into scenes, beam, enemies or HUD code.

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
