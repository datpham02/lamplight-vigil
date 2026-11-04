// Game boot, and nothing else. Everything that used to be here — the Phaser
// config, the scale mode, the scene list — is `src/host/mount.ts` now, because
// all of it is decided by the element the game is going into rather than by the
// page it happens to be on.
//
// This file is therefore one of possibly many callers: `index.html` is the
// standalone game, and anyone embedding it calls `mount()` the same way.

import { mount } from './host/index';

/** The element in `index.html` this page keeps for the game. */
const GAME_PARENT_ID = 'game';

const game = mount({ parent: GAME_PARENT_ID });

// This page is the game and nothing else, so it takes the keyboard at boot.
// `mount()` never does that by itself — on an embedded page, stealing focus
// from whatever the visitor was doing is exactly the behaviour this task was
// about removing.
game.focus();

// Vite replaces this module on every save. Without the hook the old game keeps
// its canvas, its listeners and its audio device while the new one mounts
// beside it, which is the leak the host layer exists to prevent — and dev is
// where we would notice it first.
import.meta.hot?.dispose(() => {
  game.destroy();
});
