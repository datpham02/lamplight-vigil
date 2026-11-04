// src/host owns the boundary between the game and the page it is embedded in.
// This file is the teardown ledger every other part of that boundary writes to.
//
// `mount()` returning a working game is the easy half. The half that decides
// whether this game can be put on someone else's page is `destroy()`: every
// listener, timer and audio node the mount created has to come back off, in one
// synchronous pass, or a page that mounts and destroys in a loop grows without
// bound. Phaser's own `game.destroy()` is deferred to the next frame and will
// not run at all while the loop is paused, so anything that must come off *now*
// is registered here instead of relying on it.
//
// No Phaser import and no DOM import, so the ledger can be asserted on in a
// plain Node test.

/** Teardown for one thing the mount created. Must be safe to call once. */
export type Disposable = () => void;

/**
 * A one-shot, last-in-first-out list of teardown callbacks.
 *
 * Disposal order is reversed on purpose: things registered later tend to be
 * built on things registered earlier, so they come down first.
 */
export class Disposer {
  private readonly entries: Disposable[] = [];
  private disposedValue = false;

  /** True once `dispose()` has run. A disposed ledger accepts no more work. */
  public get disposed(): boolean {
    return this.disposedValue;
  }

  /**
   * Registers teardown.
   *
   * Registering after disposal runs the callback immediately rather than
   * dropping it: the caller's intent is "this needs cleaning up", and the mount
   * it belonged to is already gone.
   */
  public add(entry: Disposable): void {
    if (this.disposedValue) {
      entry();
      return;
    }

    this.entries.push(entry);
  }

  /**
   * Runs every registered teardown exactly once, newest first.
   *
   * A callback that throws does not stop the others — half-torn-down is the
   * worst outcome available here — but the first error is re-thrown once the
   * pass is complete, so a broken disposer is still loud.
   */
  public dispose(): void {
    if (this.disposedValue) {
      return;
    }

    this.disposedValue = true;

    let firstError: unknown = null;
    let thrown = false;

    while (this.entries.length > 0) {
      const entry = this.entries.pop();
      if (entry === undefined) {
        continue;
      }

      try {
        entry();
      } catch (error) {
        if (!thrown) {
          thrown = true;
          firstError = error;
        }
      }
    }

    if (thrown) {
      throw firstError;
    }
  }
}
