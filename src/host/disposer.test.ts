import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Disposer } from './disposer';

describe('Disposer', () => {
  it('runs every registered teardown exactly once', () => {
    const disposer = new Disposer();
    let a = 0;
    let b = 0;

    disposer.add(() => {
      a += 1;
    });
    disposer.add(() => {
      b += 1;
    });

    disposer.dispose();
    disposer.dispose();

    assert.equal(a, 1);
    assert.equal(b, 1);
  });

  it('disposes newest first, so later work comes down before what it was built on', () => {
    const disposer = new Disposer();
    const order: string[] = [];

    disposer.add(() => order.push('container'));
    disposer.add(() => order.push('listeners'));
    disposer.add(() => order.push('audio'));

    disposer.dispose();

    assert.deepEqual(order, ['audio', 'listeners', 'container']);
  });

  it('reports disposal', () => {
    const disposer = new Disposer();

    assert.equal(disposer.disposed, false);
    disposer.dispose();
    assert.equal(disposer.disposed, true);
  });

  it('runs a late registration immediately rather than dropping it', () => {
    const disposer = new Disposer();
    disposer.dispose();

    let ran = false;
    disposer.add(() => {
      ran = true;
    });

    assert.equal(ran, true);
  });

  it('finishes the pass when one teardown throws, then re-throws the first error', () => {
    const disposer = new Disposer();
    const ran: string[] = [];

    disposer.add(() => ran.push('first'));
    disposer.add(() => {
      throw new Error('boom');
    });
    disposer.add(() => ran.push('last'));

    assert.throws(() => {
      disposer.dispose();
    }, /boom/);

    // Half-torn-down is the worst outcome available, so both survivors ran.
    assert.deepEqual(ran, ['last', 'first']);
  });
});
