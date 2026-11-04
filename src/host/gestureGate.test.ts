import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GESTURE_EVENTS, GestureGate } from './gestureGate';

/**
 * A real EventTarget that also counts live listeners, which is the thing the
 * acceptance criterion is actually about: repeated mount and destroy must leak
 * no listener.
 */
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

describe('GestureGate', () => {
  it('starts closed, so nothing audio-shaped exists before a gesture', () => {
    const gate = new GestureGate(new CountingTarget());

    assert.equal(gate.opened, false);
  });

  it('opens on a pointer press inside the container', () => {
    const target = new CountingTarget();
    const gate = new GestureGate(target);
    let opened = 0;

    gate.whenOpen(() => {
      opened += 1;
    });
    target.dispatchEvent(new Event('pointerdown'));

    assert.equal(gate.opened, true);
    assert.equal(opened, 1);
  });

  it('opens on a key press too, because the title screen says "press any key"', () => {
    const target = new CountingTarget();
    const gate = new GestureGate(target);

    target.dispatchEvent(new Event('keydown'));

    assert.equal(gate.opened, true);
  });

  it('opens once and only once', () => {
    const target = new CountingTarget();
    const gate = new GestureGate(target);
    let opened = 0;

    gate.whenOpen(() => {
      opened += 1;
    });

    target.dispatchEvent(new Event('pointerdown'));
    target.dispatchEvent(new Event('keydown'));
    target.dispatchEvent(new Event('pointerdown'));

    assert.equal(opened, 1);
  });

  it('runs a late subscriber immediately rather than waiting for a second gesture', () => {
    const target = new CountingTarget();
    const gate = new GestureGate(target);

    target.dispatchEvent(new Event('pointerdown'));

    let ran = false;
    gate.whenOpen(() => {
      ran = true;
    });

    assert.equal(ran, true);
  });

  it('runs a listener registered from inside the gesture, still inside it', () => {
    const target = new CountingTarget();
    const gate = new GestureGate(target);
    const order: string[] = [];

    gate.whenOpen(() => {
      order.push('first');
      gate.whenOpen(() => order.push('nested'));
    });

    target.dispatchEvent(new Event('pointerdown'));

    assert.deepEqual(order, ['first', 'nested']);
  });

  it('attaches one listener per gesture kind and detaches all of them on opening', () => {
    const target = new CountingTarget();
    const gate = new GestureGate(target);

    assert.equal(target.live, GESTURE_EVENTS.length);

    target.dispatchEvent(new Event('pointerdown'));

    assert.equal(target.live, 0);
    assert.equal(gate.opened, true);
  });

  it('detaches on dispose without opening, and stays closed afterwards', () => {
    const target = new CountingTarget();
    const gate = new GestureGate(target);
    let opened = false;

    gate.whenOpen(() => {
      opened = true;
    });
    gate.dispose();

    assert.equal(target.live, 0);

    target.dispatchEvent(new Event('pointerdown'));

    assert.equal(gate.opened, false);
    assert.equal(opened, false);
  });

  it('leaks nothing across repeated mount and destroy', () => {
    const target = new CountingTarget();

    for (let i = 0; i < 20; i += 1) {
      new GestureGate(target).dispose();
    }

    assert.equal(target.live, 0);
  });

  it('disposing after opening is a no-op, not a double detach', () => {
    const target = new CountingTarget();
    const gate = new GestureGate(target);

    target.dispatchEvent(new Event('pointerdown'));
    gate.dispose();

    assert.equal(target.live, 0);
  });
});
