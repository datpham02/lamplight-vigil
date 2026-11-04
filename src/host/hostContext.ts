// src/host owns the boundary between the game and the page it is embedded in.
// This file is how the inside of the game reaches that boundary.
//
// The scene must not import `mount.ts` — `mount.ts` imports the scene — and
// AGENTS.md routes cross-module communication through scene events or the
// Phaser registry rather than through held references. The registry is the right
// one here, because this is per-*game* state rather than a per-frame message:
// two games mounted on the same page each have their own container, their own
// gesture gate and their own pause signal, and the registry is per game.
//
// Everything downstream treats a missing context as "no host": the game runs,
// stays silent and never pauses. That is what makes a `VigilScene` constructed
// outside `mount()` still a working scene rather than a crash.

import type Phaser from 'phaser';

import type { Disposable } from './disposer';
import type { GestureGate } from './gestureGate';
import type { PauseSignal } from './pauseSignal';

/** Registry key. Namespaced so it cannot collide with a host's own entries. */
export const HOST_CONTEXT_KEY = 'vigil:host-context';

/** What the mount offers the game running inside it. */
export interface HostContext {
  /** Opens on the first user gesture inside the container. */
  readonly gesture: GestureGate;
  /** Raised while the page is blurred or hidden. */
  readonly pause: PauseSignal;
  /**
   * Whether a DOM event landed inside the game's own box.
   *
   * Phaser listens for `mousedown` on the *window* as well as on the canvas,
   * so that a button released off the canvas is still seen. The side effect is
   * that a press anywhere else on the host page — a form field, a nav link —
   * arrives at the game as a pointer press. This is how the scene tells the two
   * apart; the keyboard needs no equivalent, because its listener is on the
   * container to begin with.
   */
  ownsEventTarget(target: EventTarget | null): boolean;
  /**
   * Registers teardown that must run on the synchronous half of `destroy()`.
   *
   * Phaser's own destroy is deferred to the next frame and does not run at all
   * while the loop is paused, so anything a hidden tab must still release —
   * an AudioContext above all — is registered here instead.
   */
  addDisposable(entry: Disposable): void;
}

/** Called by `mount()` in `preBoot`, before any scene exists. */
export function putHostContext(game: Phaser.Game, context: HostContext): void {
  game.registry.set(HOST_CONTEXT_KEY, context);
}

/** The context for this scene's game, or null when the game was not mounted. */
export function readHostContext(scene: Phaser.Scene): HostContext | null {
  const stored: unknown = scene.registry.get(HOST_CONTEXT_KEY);
  return isHostContext(stored) ? stored : null;
}

/**
 * The registry is untyped by design, so what comes out of it is checked rather
 * than asserted. A host that happens to use the same key gets ignored, not a
 * crash halfway through `create()`.
 */
function isHostContext(value: unknown): value is HostContext {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<HostContext>;

  return (
    typeof candidate.addDisposable === 'function' &&
    typeof candidate.ownsEventTarget === 'function' &&
    candidate.gesture !== undefined &&
    candidate.pause !== undefined
  );
}
