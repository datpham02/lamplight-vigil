// src/hud owns the on-screen readouts. A scrim is the wash of ink an overlay
// lays over the hollow so its text wins.
//
// It is tuned per screen rather than shared, because the two screens want
// opposite things: the title screen has nothing behind it worth reading, and
// the game-over screen has the single most important thing in the game behind
// it — the crawler still touching the lamp (`docs/vision.md` §6 criterion 6).

import Phaser from 'phaser';

import { HUD_INK, RENDER_HEIGHT, RENDER_WIDTH } from '../config/index';

const CENTER_X = RENDER_WIDTH / 2;
const CENTER_Y = RENDER_HEIGHT / 2;

/** A full-frame wash of ink at the given alpha. */
export function scrim(scene: Phaser.Scene, alpha: number): Phaser.GameObjects.Rectangle {
  return scene.add.rectangle(CENTER_X, CENTER_Y, RENDER_WIDTH, RENDER_HEIGHT, HUD_INK, alpha);
}
