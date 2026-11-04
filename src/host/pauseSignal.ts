// src/host owns the boundary between the game and the page it is embedded in.
// This file is the auto-pause proposal from `docs/vision.md` §8.6, as a signal.
//
// It holds one bit — "the player is not looking at this any more" — and nothing
// else. It does not know what a run is, does not stop anything, and cannot
// resume anything: the scene reads the bit and decides. That split is the point.
// A pause that lived in here would be a second place that can stop the run
// clock, and `docs/design.md` §2 is meant to be the only one.
//
// **Resuming is a player action, never a window event.** The signal is raised by
// blur or by the tab being hidden, and is only lowered by `clear()`, which the
// scene calls when the player gives the game an input. Resuming on `focus`
// instead would drop a player back into a live run on the frame their window
// came forward — a death the screen never showed them, which is the pillar 2
// failure that `docs/design.md` §2.4's delta clamp already exists to prevent.
//
// Phaser raises its own BLUR and HIDDEN events, and they are deliberately not
// used here: Phaser installs them by assigning `window.onblur`, so a second game
// on the same page silently takes them away from the first, and nothing ever
// removes them. `addEventListener` is additive, per-instance and removable,
// which is what an embedded game needs.
//
// No Phaser import and no DOM import, so the signal can be driven by a plain
// `EventTarget` in a Node test.

/** The slice of `document` this needs: `hidden`, plus `visibilitychange`. */
export interface VisibilitySource extends EventTarget {
  readonly hidden: boolean;
}

/** Where the two halves of "not looking at this any more" come from. */
export interface PauseSources {
  /** `window`, for `blur`: the page is visible but another window has focus. */
  readonly blur: EventTarget;
  /** `document`, for `visibilitychange`: the tab is in the background. */
  readonly visibility: VisibilitySource;
}

export class PauseSignal {
  private requested: boolean;

  private readonly detach: (() => void)[] = [];

  public constructor(sources: PauseSources) {
    // A game mounted into a tab that is already in the background starts in the
    // raised state rather than discovering it on the first blur.
    this.requested = sources.visibility.hidden;

    this.listen(sources.blur, 'blur', () => {
      this.requested = true;
    });

    this.listen(sources.visibility, 'visibilitychange', () => {
      if (sources.visibility.hidden) {
        this.requested = true;
      }
    });
  }

  /** True while the game should not be advancing the run. */
  public get pauseRequested(): boolean {
    return this.requested;
  }

  /** The player gave the game an input, so they are back. */
  public clear(): void {
    this.requested = false;
  }

  public dispose(): void {
    while (this.detach.length > 0) {
      const off = this.detach.pop();
      off?.();
    }
  }

  private listen(target: EventTarget, type: string, handler: () => void): void {
    target.addEventListener(type, handler);
    this.detach.push(() => {
      target.removeEventListener(type, handler);
    });
  }
}
