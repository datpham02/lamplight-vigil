import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PauseSignal, type PauseSources, type VisibilitySource } from './pauseSignal';

class CountingTarget extends EventTarget {
  public live = 0;

  public override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    this.live += 1;
    super.addEventListener(type, callback, options);
  }

  public override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    this.live -= 1;
    super.removeEventListener(type, callback, options);
  }
}

/** Stands in for `document`: an EventTarget that also reports `hidden`. */
class FakeDocument extends CountingTarget implements VisibilitySource {
  public hidden = false;

  /** Hides or reveals the tab and fires the event the browser would. */
  public setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

interface Harness extends PauseSources {
  readonly blur: CountingTarget;
  readonly visibility: FakeDocument;
  readonly signal: PauseSignal;
}

function harness(startHidden = false): Harness {
  const blur = new CountingTarget();
  const visibility = new FakeDocument();
  visibility.hidden = startHidden;

  return { blur, visibility, signal: new PauseSignal({ blur, visibility }) };
}

describe('PauseSignal', () => {
  it('starts low on a visible page', () => {
    assert.equal(harness().signal.pauseRequested, false);
  });

  it('starts raised when the game is mounted into a tab that is already hidden', () => {
    assert.equal(harness(true).signal.pauseRequested, true);
  });

  it('raises when the window loses focus', () => {
    const { blur, signal } = harness();

    blur.dispatchEvent(new Event('blur'));

    assert.equal(signal.pauseRequested, true);
  });

  it('raises when the tab goes into the background', () => {
    const { visibility, signal } = harness();

    visibility.setHidden(true);

    assert.equal(signal.pauseRequested, true);
  });

  it('ignores a visibility change that leaves the tab visible', () => {
    const { visibility, signal } = harness();

    visibility.setHidden(false);

    assert.equal(signal.pauseRequested, false);
  });

  it('stays raised when the window comes back, because returning focus is not an input', () => {
    const { blur, visibility, signal } = harness();

    blur.dispatchEvent(new Event('blur'));
    blur.dispatchEvent(new Event('focus'));
    visibility.setHidden(true);
    visibility.setHidden(false);

    assert.equal(signal.pauseRequested, true);
  });

  it('lowers only when the player gives the game an input', () => {
    const { blur, signal } = harness();

    blur.dispatchEvent(new Event('blur'));
    signal.clear();

    assert.equal(signal.pauseRequested, false);
  });

  it('raises again on the next blur after being cleared', () => {
    const { blur, signal } = harness();

    blur.dispatchEvent(new Event('blur'));
    signal.clear();
    blur.dispatchEvent(new Event('blur'));

    assert.equal(signal.pauseRequested, true);
  });

  it('detaches every listener on dispose and goes deaf', () => {
    const { blur, visibility, signal } = harness();

    assert.equal(blur.live, 1);
    assert.equal(visibility.live, 1);

    signal.dispose();

    assert.equal(blur.live, 0);
    assert.equal(visibility.live, 0);

    blur.dispatchEvent(new Event('blur'));
    visibility.setHidden(true);

    assert.equal(signal.pauseRequested, false);
  });

  it('leaks nothing across repeated mount and destroy', () => {
    const blur = new CountingTarget();
    const visibility = new FakeDocument();

    for (let i = 0; i < 20; i += 1) {
      new PauseSignal({ blur, visibility }).dispose();
    }

    assert.equal(blur.live, 0);
    assert.equal(visibility.live, 0);
  });

  it('two signals on one page are independent, as two mounted games are', () => {
    const blur = new CountingTarget();
    const visibility = new FakeDocument();

    const first = new PauseSignal({ blur, visibility });
    const second = new PauseSignal({ blur, visibility });

    blur.dispatchEvent(new Event('blur'));
    assert.equal(first.pauseRequested, true);
    assert.equal(second.pauseRequested, true);

    // Destroying one game must not take the other's pause handling with it —
    // the failure Phaser's own `window.onblur = ...` would produce here.
    first.dispose();
    second.clear();
    blur.dispatchEvent(new Event('blur'));

    assert.equal(second.pauseRequested, true);
  });
});
