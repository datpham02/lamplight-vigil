// src/host owns the boundary between the game and the page it is embedded in.
// This file is the first-user-gesture gate.
//
// Browsers refuse to start an AudioContext that was not created or resumed from
// inside a real user gesture, and a page that creates one anyway gets a
// suspended context plus a console warning it did not ask for. A game embedded
// in someone else's page must therefore create *nothing* audio-shaped until the
// player has touched it.
//
// The listeners are attached in the capture phase on the game's own container,
// so the gate sees the gesture before anything inside the game can stop it, and
// never sees a gesture aimed at the rest of the page. They come straight back
// off the moment the gate opens: this costs one listener for the life of the
// title screen and nothing after it.
//
// Typed against the structural slice of `EventTarget` it actually uses, so the
// gate can be opened by a plain `new EventTarget()` in a Node test.

/**
 * What counts as the player touching the game.
 *
 * `keydown` is in the list because the container is focusable and the title
 * screen says "press any key"; without it, a player who never clicks would
 * start a run with no sound. `touchstart` is listed alongside `pointerdown`
 * because Safari has historically unlocked audio on one and not the other.
 */
export const GESTURE_EVENTS: readonly string[] = ['pointerdown', 'keydown', 'touchstart'];

/** Called once, synchronously inside the first gesture. */
export type GestureListener = () => void;

/**
 * Opens exactly once, on the first user gesture inside `target`, and then
 * detaches itself.
 */
export class GestureGate {
  private openedValue = false;

  private readonly waiting: GestureListener[] = [];
  private readonly detach: (() => void)[] = [];

  public constructor(target: EventTarget, events: readonly string[] = GESTURE_EVENTS) {
    const onGesture = (): void => {
      this.open();
    };

    for (const type of events) {
      target.addEventListener(type, onGesture, { capture: true });
      this.detach.push(() => {
        target.removeEventListener(type, onGesture, { capture: true });
      });
    }
  }

  /** True once the player has touched the game. */
  public get opened(): boolean {
    return this.openedValue;
  }

  /**
   * Runs `listener` inside the first gesture, or immediately if the gate is
   * already open.
   *
   * Running immediately matters: a subscriber that registers late would
   * otherwise wait for a second gesture that may never come, and "audio works
   * only if you click twice" is the bug this whole file exists to prevent.
   */
  public whenOpen(listener: GestureListener): void {
    if (this.openedValue) {
      listener();
      return;
    }

    this.waiting.push(listener);
  }

  /** Detaches without opening. Safe to call after the gate has opened. */
  public dispose(): void {
    this.detachAll();
    this.waiting.length = 0;
  }

  private open(): void {
    if (this.openedValue) {
      return;
    }

    this.openedValue = true;
    this.detachAll();

    // Drained rather than iterated, so a listener that registers another one
    // from inside the gesture is still inside the gesture when it runs.
    while (this.waiting.length > 0) {
      const listener = this.waiting.shift();
      listener?.();
    }
  }

  private detachAll(): void {
    while (this.detach.length > 0) {
      const off = this.detach.pop();
      off?.();
    }
  }
}
