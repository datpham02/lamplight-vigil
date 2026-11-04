// The §8 scoring rules of docs/design.md, including the weighting the crossover
// between patience and aggression is derived from.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SCORE_PER_BANISH, SCORE_PER_SECOND_SURVIVED, SCORE_STORAGE_KEY } from '../config/index';
import { readBestScore, writeBestScore } from './bestScore';
import { runScore } from './score';

describe('score formula (design.md §8)', () => {
  it('pays for time survived and for crawlers banished', () => {
    assert.equal(runScore(0, 0), 0);
    assert.equal(runScore(1, 0), SCORE_PER_SECOND_SURVIVED);
    assert.equal(runScore(0, 1), SCORE_PER_BANISH);
    assert.equal(runScore(10, 4), 10 * SCORE_PER_SECOND_SURVIVED + 4 * SCORE_PER_BANISH);
  });

  it('floors the time term so the readout counts up smoothly', () => {
    assert.equal(runScore(1.9, 0), Math.floor(1.9 * SCORE_PER_SECOND_SURVIVED));
    assert.equal(Number.isInteger(runScore(37.4821, 3)), true);
  });

  it('puts the patience-to-aggression crossover inside a real run', () => {
    // §8: banish income is spawn-rate limited, so the two strategies are equal
    // at a spawn rate of SCORE_PER_SECOND_SURVIVED / SCORE_PER_BANISH per second.
    const crossoverSpawnRate = SCORE_PER_SECOND_SURVIVED / SCORE_PER_BANISH;

    assert.ok(crossoverSpawnRate > 0.25, 'surviving pays at the opening spawn rate');
    assert.ok(crossoverSpawnRate < 0.6, 'banishing pays by the practised crossing');
  });
});

describe('best score (design.md §8)', () => {
  it('reports 0 when there is no usable stored value', () => {
    withStorage(null, () => {
      assert.equal(readBestScore(), 0, 'no storage at all degrades to session-only');
    });

    withStorage(new Map(), () => {
      assert.equal(readBestScore(), 0, 'missing key');
    });

    withStorage(new Map([[SCORE_STORAGE_KEY, 'not a number']]), () => {
      assert.equal(readBestScore(), 0, 'unparseable');
    });

    withStorage(new Map([[SCORE_STORAGE_KEY, '-5']]), () => {
      assert.equal(readBestScore(), 0, 'negative');
    });
  });

  it('round-trips a score, and survives storage that throws', () => {
    const store = new Map<string, string>();

    withStorage(store, () => {
      assert.equal(writeBestScore(1234), true);
      assert.equal(readBestScore(), 1234);
    });

    withStorage('throws', () => {
      assert.equal(writeBestScore(1), false, 'a refused write must not break the run');
      assert.equal(readBestScore(), 0);
    });
  });
});

/**
 * Swaps a stand-in for `localStorage` for the duration of a block. `null` means
 * no storage object at all (a browser with it disabled); `'throws'` means one
 * that throws on every call, which is what private-mode browsers do.
 */
function withStorage(store: Map<string, string> | null | 'throws', body: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  const stub =
    store === null
      ? undefined
      : store === 'throws'
        ? {
            getItem: (): string => {
              throw new Error('denied');
            },
            setItem: (): void => {
              throw new Error('denied');
            },
          }
        : {
            getItem: (key: string): string | null => store.get(key) ?? null,
            setItem: (key: string, value: string): void => {
              store.set(key, value);
            },
          };

  Object.defineProperty(globalThis, 'localStorage', {
    value: stub,
    configurable: true,
    writable: true,
  });

  try {
    body();
  } finally {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, 'localStorage');
    } else {
      Object.defineProperty(globalThis, 'localStorage', descriptor);
    }
  }
}
