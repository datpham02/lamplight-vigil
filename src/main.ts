import Phaser from 'phaser';

import { BACKGROUND_COLOR, RENDER_HEIGHT, RENDER_WIDTH } from './config/index';
import { VigilScene } from './scenes/VigilScene';

/**
 * The game renders at a fixed RENDER_WIDTH x RENDER_HEIGHT and is scaled to fit
 * the window, so every gameplay coordinate is in render-space and never depends
 * on the browser size.
 */
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: BACKGROUND_COLOR,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: RENDER_WIDTH,
    height: RENDER_HEIGHT,
  },
  scene: [VigilScene],
};

new Phaser.Game(config);
