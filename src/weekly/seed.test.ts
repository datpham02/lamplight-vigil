// docs/design.md §14.3 and its acceptance criterion 19: the seed functions match
// the published vectors. A mismatch is not a local bug — it means a server
// written against D4 later will disagree with this client about which week a
// score was played in, and no amount of testing on one device finds it.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WEEKLY_SEED_NAMESPACE } from '../config/index';
import { fnv1a32, mulberry32, seededUnitRandom } from './seed';

/** §14.3 — "Conformance vectors (criterion 19)". */
const FNV_VECTORS: readonly { readonly input: string; readonly expected: number }[] = [
  { input: '', expected: 2166136261 },
  { input: 'a', expected: 3826002220 },
  { input: 'lamplight-vigil', expected: 2718592447 },
  { input: 'lamplight-vigil/weekly/1|block|0', expected: 3239841354 },
  { input: 'lamplight-vigil/weekly/1|2026-W45|plain|value', expected: 3660224661 },
];

describe('fnv1a32 (design.md §14.3, criterion 19)', () => {
  it('matches every published vector, decimal and hex', () => {
    const hex: readonly string[] = [
      '0x811c9dc5',
      '0xe40c292c',
      '0xa20a6dbf',
      '0xc11c0e4a',
      '0xda2a9895',
    ];

    FNV_VECTORS.forEach((vector, i) => {
      const actual = fnv1a32(vector.input);
      assert.equal(actual, vector.expected, `fnv1a32(${JSON.stringify(vector.input)})`);
      assert.equal(`0x${actual.toString(16)}`, hex[i], 'and the published hex');
    });
  });

  it('is namespaced by the schedule version the vectors were taken at', () => {
    // Two of the vectors above hard-code the namespace string. If the schedule
    // version in src/config is bumped — a game-director decision, §14.3 — they
    // stop describing the shipped seeds, and this is the test that says so
    // rather than letting the vectors quietly become decoration.
    assert.equal(WEEKLY_SEED_NAMESPACE, 'lamplight-vigil/weekly/1');
  });

  it('is a uint32: hashes a long string without overflowing or going negative', () => {
    for (let i = 0; i < 2000; i += 1) {
      const hash = fnv1a32(`${WEEKLY_SEED_NAMESPACE}|2026-W${i}|entry|value`);
      assert.ok(Number.isInteger(hash) && hash >= 0 && hash <= 0xffffffff, `out of range at ${i}`);
    }
  });

  it('hashes UTF-8 bytes, not UTF-16 code units', () => {
    // The spec says "the UTF-8 bytes of the string", and every published vector
    // is ASCII, where the two are the same. 'é' (U+00E9) is one UTF-16 code unit
    // and two UTF-8 bytes, so a TextEncoder swapped for a charCodeAt loop passes
    // all five vectors above and disagrees here — on, say, a display name.
    const step = (hash: number, byte: number): number => Math.imul(hash ^ byte, 0x01000193) >>> 0;
    const utf8 = [0xc3, 0xa9].reduce(step, 0x811c9dc5);
    const utf16 = step(0x811c9dc5, 0xe9);

    assert.equal(fnv1a32('é'), utf8);
    assert.notEqual(fnv1a32('é'), utf16);
  });
});

describe('mulberry32 (design.md §14.3)', () => {
  it('is a pure function of its seed', () => {
    const first = mulberry32(12345);
    const second = mulberry32(12345);

    for (let i = 0; i < 100; i += 1) {
      assert.equal(first(), second(), `draw ${i} diverged`);
    }
  });

  it('returns uint32 words, not floats — §14.4 takes next() % n', () => {
    const next = mulberry32(fnv1a32(`${WEEKLY_SEED_NAMESPACE}|block|0`));

    for (let i = 0; i < 1000; i += 1) {
      const word = next();
      assert.ok(Number.isInteger(word), 'a float here is a different schedule');
      assert.ok(word >= 0 && word <= 0xffffffff);
    }
  });

  it('does not repeat itself over a run-sized draw', () => {
    const next = mulberry32(1);
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i += 1) {
      seen.add(next());
    }
    assert.ok(seen.size > 9990, `only ${seen.size} distinct words in 10 000 draws`);
  });
});

describe('the seeded unit source the field rolls', () => {
  it('stays inside [0, 1)', () => {
    const random = seededUnitRandom(fnv1a32('lamplight-vigil|range'));

    for (let i = 0; i < 20_000; i += 1) {
      const value = random();
      assert.ok(value >= 0 && value < 1, `${value} is outside [0, 1)`);
    }
  });

  it('is uniform enough to weight four edges with', () => {
    // §6.2 draws an edge by comparing against cumulative weights, so a source
    // that clumps in one part of the range would quietly re-weight the table.
    const random = seededUnitRandom(fnv1a32('lamplight-vigil|uniformity'));
    const buckets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const draws = 100_000;

    for (let i = 0; i < draws; i += 1) {
      const bucket = Math.floor(random() * buckets.length);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }

    for (const [i, count] of buckets.entries()) {
      const share = count / draws;
      assert.ok(Math.abs(share - 0.1) < 0.01, `bucket ${i} took ${(share * 100).toFixed(2)}%`);
    }
  });

  it('rewinds to the first draw, so a restart replays the week', () => {
    const random = seededUnitRandom(4242);
    const first = Array.from({ length: 50 }, () => random());

    random.rewind?.();
    const second = Array.from({ length: 50 }, () => random());

    assert.deepEqual(second, first);
  });

  it('two sources on one seed agree — two clients, one week (vision.md B5)', () => {
    const here = seededUnitRandom(fnv1a32('lamplight-vigil/weekly/1|2026-W45|spawn'));
    const there = seededUnitRandom(fnv1a32('lamplight-vigil/weekly/1|2026-W45|spawn'));

    for (let i = 0; i < 500; i += 1) {
      assert.equal(here(), there(), `draw ${i} diverged`);
    }
  });

  it('two different weeks do not', () => {
    const thisWeek = seededUnitRandom(fnv1a32('lamplight-vigil/weekly/1|2026-W45|spawn'));
    const nextWeek = seededUnitRandom(fnv1a32('lamplight-vigil/weekly/1|2026-W46|spawn'));

    const diverged = Array.from({ length: 20 }, () => thisWeek() !== nextWeek()).some(Boolean);
    assert.ok(diverged, 'the pattern must change across a week boundary');
  });

  it('leaves Math.random alone: the unseeded path has nothing to rewind', () => {
    // src/enemies treats `rewind` as optional precisely so that Math.random
    // satisfies the same type. §14.8: Free Play is unseeded, and a restart there
    // is a different hollow rather than a replay.
    assert.equal(Object.hasOwn(Math.random, 'rewind'), false);
    assert.equal(Object.hasOwn(seededUnitRandom(1), 'rewind'), true);
  });
});
