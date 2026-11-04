// src/hud owns the on-screen readouts. This is the smallest screen in the game
// and the only reason it exists is pillar 2.
//
// `docs/design.md` §2.5 stops the run clock when the window loses focus. A
// stopped clock the screen never mentions is hidden state, and worse, it is
// indistinguishable from a bug: the player comes back, moves the mouse, sees
// the beam ignore them and the crawlers stand still, and concludes the game
// crashed. The overlay turns both of those into one sentence.
//
// Nothing here animates, loads or waits, for the same reason the game-over
// overlay does not: it is built once in the scene's create() and made visible
// on the frame the pause begins.

import Phaser from 'phaser';

import {
  HUD_TEXT_DIM,
  HUD_TEXT_PRIMARY,
  OVERLAY_DEPTH,
  PAUSE_HEADING_SIZE,
  PAUSE_HEADING_TRACKING,
  PAUSE_HEADING_Y,
  PAUSE_NOTE_SIZE,
  PAUSE_NOTE_Y,
  PAUSE_PROMPT_SIZE,
  PAUSE_PROMPT_Y,
  PAUSE_SCRIM_ALPHA,
  RENDER_WIDTH,
} from '../config/index';
import { scrim } from './scrim';
import * as strings from './strings';
import { hudText } from './text';

const CENTER_X = RENDER_WIDTH / 2;

export class PauseOverlay {
  private readonly container: Phaser.GameObjects.Container;

  public constructor(scene: Phaser.Scene) {
    this.container = scene.add.container(0, 0, [
      scrim(scene, PAUSE_SCRIM_ALPHA),

      hudText(scene, {
        x: CENTER_X,
        y: PAUSE_HEADING_Y,
        content: strings.PAUSE_HEADING,
        size: PAUSE_HEADING_SIZE,
        color: HUD_TEXT_PRIMARY,
        align: 'center',
        tracking: PAUSE_HEADING_TRACKING,
      }),
      hudText(scene, {
        x: CENTER_X,
        y: PAUSE_NOTE_Y,
        content: strings.PAUSE_NOTE,
        size: PAUSE_NOTE_SIZE,
        color: HUD_TEXT_DIM,
        align: 'center',
      }),
      hudText(scene, {
        x: CENTER_X,
        y: PAUSE_PROMPT_Y,
        content: strings.PAUSE_PROMPT,
        size: PAUSE_PROMPT_SIZE,
        color: HUD_TEXT_PRIMARY,
        align: 'center',
      }),
    ]);

    this.container.setDepth(OVERLAY_DEPTH);
    this.container.setVisible(false);
  }

  /** Every string on this screen is fixed, so there is nothing to show *with*. */
  public setVisible(visible: boolean): void {
    this.container.setVisible(visible);
  }
}
