// src/host owns the boundary between the game and the page it is embedded in.
// This file is that boundary's whole public surface: `mount()` in, `destroy()`
// out, and nothing global in between.
//
// Everything here exists because the game has to behave on a page it does not
// own. The five rules, and the line of config or code that keeps each one:
//
//  1. **Nothing global.** No module-level state, no `window.onblur`, no shared
//     singleton. Two mounts are two independent games, and destroying one is
//     invisible to the other.
//  2. **Input stays inside.** `input.keyboard.target` is the container, not
//     `window`, so a key typed into a form beside the game never reaches it and
//     a key aimed at the game never reaches the form. Pointer presses need a
//     second gate — `ownsEventTarget` — because Phaser also listens for
//     `mousedown` on the window; see `hostContext.ts` for why it does and what
//     that costs.
//  3. **Audio waits for the player.** `audio.noAudio` stops Phaser creating an
//     AudioContext at boot; `GestureGate` lets `VigilAudio` create its own
//     inside the first real gesture (see `src/scenes/VigilAudio.ts`).
//  4. **The canvas stays inside.** FIT is bound to the container, not the
//     window, `expandParent` is off so the host's `<body>` is never restyled,
//     and the container is clipped (see `container.ts`).
//  5. **Focus is never stolen.** `autoFocus` is off — Phaser's default calls
//     `window.focus()` at boot *and on every mouse press*. The container takes
//     focus on a pointer press inside the game, and otherwise only when the
//     host calls `focus()` itself.

import Phaser from 'phaser';

import { BACKGROUND_COLOR, RENDER_HEIGHT, RENDER_WIDTH } from '../config/index';
import { VigilScene } from '../scenes/VigilScene';
import { prepareContainer, resolveContainer } from './container';
import { Disposer } from './disposer';
import { GestureGate } from './gestureGate';
import { putHostContext, type HostContext } from './hostContext';
import { PauseSignal } from './pauseSignal';

export interface MountOptions {
  /**
   * The element to render into, or its id.
   *
   * It must have a size of its own: the mount deliberately never sets one, and
   * never expands the host's `<body>` to make room, so a zero-height container
   * gets a zero-sized game. That is the host's layout to decide, not the
   * game's.
   */
  readonly parent: string | HTMLElement;
}

/** One mounted game. The only handle a host needs. */
export interface VigilGame {
  /** True once `destroy()` has been called. */
  readonly destroyed: boolean;

  /**
   * Gives the game keyboard focus.
   *
   * Keyboard input is scoped to the container, so until something focuses it
   * the game hears no keys. A page that is nothing but the game should call
   * this at boot; a page with other content should leave it to the player.
   */
  focus(): void;

  /**
   * Takes the game back off the page.
   *
   * The half that matters — every listener this mount added, the AudioContext,
   * and the container's original attributes — happens synchronously, because
   * Phaser's own teardown is deferred to the next frame and does not run at all
   * while a hidden tab has the loop paused. Calling it twice is a no-op.
   */
  destroy(): void;
}

export function mount(options: MountOptions): VigilGame {
  const container = resolveContainer(options.parent, document);
  const teardown = new Disposer();

  teardown.add(prepareContainer(container));

  const gesture = new GestureGate(container);
  teardown.add(() => {
    gesture.dispose();
  });

  const pause = new PauseSignal({ blur: window, visibility: document });
  teardown.add(() => {
    pause.dispose();
  });

  // A press inside the game is the player asking for it, which is the one time
  // taking focus is not rude. In the capture phase so it still happens if
  // something inside the game stops the event.
  const onPointerDown = (): void => {
    container.focus();
  };
  container.addEventListener('pointerdown', onPointerDown, { capture: true });
  teardown.add(() => {
    container.removeEventListener('pointerdown', onPointerDown, { capture: true });
  });

  const host: HostContext = {
    gesture,
    pause,
    ownsEventTarget: (target) => target instanceof Node && container.contains(target),
    addDisposable: (entry) => {
      teardown.add(entry);
    },
  };

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    backgroundColor: BACKGROUND_COLOR,
    autoFocus: false,
    audio: { noAudio: true },
    input: { keyboard: { target: container } },
    scale: {
      parent: container,
      expandParent: false,
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: RENDER_WIDTH,
      height: RENDER_HEIGHT,
    },
    // The only hook that runs after the registry exists and before any scene
    // does, which is exactly the window the host context has to land in.
    callbacks: {
      preBoot: (booted: Phaser.Game): void => {
        putHostContext(booted, host);
      },
    },
    scene: [VigilScene],
  });

  let destroyed = false;

  return {
    get destroyed(): boolean {
      return destroyed;
    },

    focus(): void {
      container.focus();
    },

    destroy(): void {
      if (destroyed) {
        return;
      }

      destroyed = true;
      teardown.dispose();

      // `removeCanvas` true, `noReturn` false: the canvas leaves the host's
      // element, and Phaser's shared plugins survive so the next mount — or the
      // other game on this page — still works.
      game.destroy(true, false);
    },
  };
}
