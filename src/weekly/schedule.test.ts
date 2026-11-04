// docs/design.md §14.4 and §14.5, and acceptance criteria 21 and 22.
//
// Criterion 21 is deliberately two assertions, and the second is a property
// rather than a sample: §14.4 records that the rejected rotation rule leaks its
// first repeated week at week 1023, about nineteen years past the epoch, so a
// 520-week sample reports a defective schedule as holding. Bumping the schedule
// version re-rolls that dice and may put the first leak in week 20.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WEEKLY_EPOCH_UTC_MS } from '../config/index';
import { WEEKLY_MODIFIERS } from '../config/weeklyModifiers';
import { BLOCK_LENGTH, blockOrder, rawBlockOrder, resolveWeek } from './schedule';
import { weekIndex, weekKey } from './weekKey';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The epoch, which §14.2 states in the reset frame. Taken from `src/config`
 * rather than written out again: criterion 36 allows the week boundary exactly
 * one home, and a second `Date.UTC(2026, 0, 5)` here would be a copy of it that
 * stops moving when the real one does.
 */
const EPOCH = WEEKLY_EPOCH_UTC_MS;

const ALL_IDS = WEEKLY_MODIFIERS.map((modifier) => modifier.id).sort();

// The closed table itself — eight entries, fifteen cells, one constant each,
// every resolved value inside its §10 band — is `src/config/weeklyModifiers.ts`'s
// and is swept cell by cell in `tools/throughput-sim.test.ts` (OV-3). What is
// tested here is only what §14.4 adds on top of it: which entry a given week
// gets, and the two properties criterion 21 demands of that choice.

describe('the block schedule (design.md §14.4, criterion 21)', () => {
  it('(b) is a permutation of the whole table at every one of 10 000 blocks', () => {
    for (let block = 0; block <= 10_000; block += 1) {
      const order = [...blockOrder(block)].sort();
      assert.deepEqual(order, ALL_IDS, `block ${block} is not a permutation`);
    }
  });

  it('(b) never opens on the entry the previous block closed with', () => {
    // The property, not a sample. This is the assertion the rotation rule fails.
    for (let block = 1; block <= 10_000; block += 1) {
      const previous = blockOrder(block - 1);
      const current = blockOrder(block);

      assert.notEqual(
        current[0],
        previous[previous.length - 1],
        `block ${block} repeats across the boundary`,
      );
    }
  });

  it('(b) closes on rawBlockOrder(b)[N - 1], which is what makes the swap work', () => {
    // The swap never touches order[N - 1], so a block's closing entry is
    // rotation-independent and `blockOrder` never has to recurse to the epoch.
    // If this stops holding, the O(1) stateless property above is gone with it.
    for (let block = 0; block <= 20_000; block += 1) {
      const order = blockOrder(block);
      const raw = rawBlockOrder(block);
      assert.equal(order[order.length - 1], raw[raw.length - 1], `block ${block}`);
    }
  });

  it('needs N >= 3 for the swap to be safe, and has it', () => {
    assert.ok(BLOCK_LENGTH >= 3, 'a two-entry table makes the swap a rotation');
  });

  it('is stateless: the same block answers the same from any order of calls', () => {
    const forwards = [0, 1, 2, 3, 4, 5].map((block) => blockOrder(block).join(','));
    const backwards = [5, 4, 3, 2, 1, 0].map((block) => blockOrder(block).join(',')).reverse();

    assert.deepEqual(backwards, forwards);
  });
});

describe('the schedule over weeks (design.md §14.4, criterion 21a)', () => {
  const weeks = Array.from({ length: 520 }, (_, index) => resolveWeek(weekKey(EPOCH + index * WEEK_MS), index));

  it('(a) gives each of the eight entries exactly 65 of 520 weeks', () => {
    const counts = new Map<string, number>();
    for (const week of weeks) {
      counts.set(week.entry.id, (counts.get(week.entry.id) ?? 0) + 1);
    }

    assert.equal(counts.size, BLOCK_LENGTH, 'every entry must appear');
    for (const id of ALL_IDS) {
      assert.equal(counts.get(id), 65, `${id} came up ${String(counts.get(id))} times, not 65`);
    }
  });

  it('(a) never runs the same entry two weeks together', () => {
    let longestRun = 1;
    let run = 1;

    for (let i = 1; i < weeks.length; i += 1) {
      run = weeks[i]?.entry.id === weeks[i - 1]?.entry.id ? run + 1 : 1;
      longestRun = Math.max(longestRun, run);
    }

    assert.equal(longestRun, 1, '"the twist did not change this week" must be unrepresentable');
  });

  it('resolves a week from the clock the same way it does from a key', () => {
    const instant = Date.UTC(2026, 10, 4, 11, 30);
    const fromClock = resolveWeek(weekKey(instant), weekIndex(instant));

    assert.equal(fromClock.key, '2026-W45');
    assert.equal(fromClock.index, 43);
  });
});

describe('the published schedule vector (design.md §14.4, criterion 22)', () => {
  /**
   * §14.4 — "the first ten weeks from the Board's approval date", as re-derived
   * at UTC+7 by GAM-43. `begins` is the "Begins (UTC)" column: the real instant
   * the week opens at, which is Monday 00:00 in the reset frame and therefore
   * the Sunday evening before on a UTC clock.
   *
   * §14.4 is explicit that the entry and value columns did **not** move when the
   * offset did, and says why: the schedule reads only the week key and the week
   * index, and both are computed wholly inside the reset frame against an epoch
   * stated in that same frame. So this vector is two claims at once — the ten
   * cells are unchanged, and they begin seven hours earlier on a UTC clock than
   * the withdrawn UTC draft said.
   */
  const VECTOR: readonly {
    readonly key: string;
    readonly begins: string;
    readonly index: number;
    readonly entry: string;
    readonly value: string;
  }[] = [
    { key: '2026-W45', begins: '2026-11-01T17:00:00Z', index: 43, entry: 'clinging-dark', value: 'x1.30' },
    { key: '2026-W46', begins: '2026-11-08T17:00:00Z', index: 44, entry: 'plain', value: 'x1.00' },
    { key: '2026-W47', begins: '2026-11-15T17:00:00Z', index: 45, entry: 'one-axis', value: 'over-the-top' },
    { key: '2026-W48', begins: '2026-11-22T17:00:00Z', index: 46, entry: 'restless-hollow', value: 'x1.10' },
    { key: '2026-W49', begins: '2026-11-29T17:00:00Z', index: 47, entry: 'hungry-flame', value: 'x1.10' },
    { key: '2026-W50', begins: '2026-12-06T17:00:00Z', index: 48, entry: 'narrow-lantern', value: 'x1.15' },
    { key: '2026-W51', begins: '2026-12-13T17:00:00Z', index: 49, entry: 'clinging-dark', value: 'x1.15' },
    { key: '2026-W52', begins: '2026-12-20T17:00:00Z', index: 50, entry: 'crowded-threshold', value: 'x1.06' },
    { key: '2026-W53', begins: '2026-12-27T17:00:00Z', index: 51, entry: 'hungry-flame', value: 'x1.20' },
    { key: '2027-W01', begins: '2027-01-03T17:00:00Z', index: 52, entry: 'one-axis', value: 'long-dark' },
  ];

  it('resolves all ten weeks to exactly the published entry and value', () => {
    for (const row of VECTOR) {
      const resolved = resolveWeek(row.key, row.index);
      assert.equal(resolved.entry.id, row.entry, `${row.key} entry`);
      assert.equal(resolved.label, `${row.entry} ${row.value}`, `${row.key} value`);
    }
  });

  it('opens each week at the published instant, to the millisecond (§14.4)', () => {
    // The column the offset actually moved. Each row is asserted from both
    // sides, because a build that ignores the offset gets the inside of the week
    // right and only the boundary wrong — §14.2 is explicit that this is the
    // failure a mid-week sample cannot see.
    for (const row of VECTOR) {
      const begins = Date.parse(row.begins);

      assert.equal(weekKey(begins), row.key, `${row.key} begins at ${row.begins}`);
      assert.equal(weekIndex(begins), row.index, `${row.key} index at its first instant`);
      assert.notEqual(weekKey(begins - 1), row.key, `${row.key} had not begun a millisecond earlier`);
    }
  });

  it('reaches the same ten weeks from the clock alone', () => {
    // Criterion 20 reads "a week resolves with no network access"; this is the
    // arithmetic half of it. The instant goes in, the week comes out, and
    // nothing in between reads storage, a zone or a socket.
    for (const row of VECTOR) {
      // Tuesday noon of the reset frame — the epoch is a reset-frame Monday, so
      // offsetting from it stays in that frame without naming the offset again.
      const instant = EPOCH + row.index * WEEK_MS + 36 * 60 * 60 * 1000;
      const resolved = resolveWeek(weekKey(instant), weekIndex(instant));

      assert.equal(resolved.key, row.key);
      assert.equal(resolved.entry.id, row.entry, `${row.key} entry from the clock`);
      assert.equal(resolved.label, `${row.entry} ${row.value}`, `${row.key} value from the clock`);
    }
  });

  it('spans blocks 5 and 6, and neither of them swaps', () => {
    // §14.4 states this explicitly: the vector was re-derived under the
    // corrected rule and is unchanged because neither block collides with its
    // predecessor. If a future edit makes one of them swap, the vector moves and
    // this says which block did it.
    for (const block of [5, 6]) {
      assert.deepEqual(blockOrder(block), rawBlockOrder(block), `block ${block} swapped`);
    }

    const block4 = rawBlockOrder(4);
    const block5 = rawBlockOrder(5);
    const block6 = rawBlockOrder(6);

    assert.equal(block4[block4.length - 1], 'narrow-lantern', 'block 4 closes on narrow-lantern');
    assert.equal(block5[0], 'thin-wick', 'block 5 opens on thin-wick');
    assert.equal(block5[block5.length - 1], 'hungry-flame', 'block 5 closes on hungry-flame');
    assert.equal(block6[0], 'narrow-lantern', 'block 6 opens on narrow-lantern');
  });

  it('is resolved once per run, not re-read from a moving clock (criterion 26)', () => {
    // §14.2: the key is resolved at the transition to PLAYING and held. The
    // function is pure in its instant, so holding the resolved value is all that
    // is needed — a clock change mid-run cannot reach back into it.
    // One minute before the reset: 16:59 UTC on a Sunday, which is 23:59 on the
    // Sunday of the reset frame. Under the withdrawn UTC draft this instant was
    // seven hours into the *next* week, which is exactly the kind of row that
    // makes the offset visible rather than assumed.
    const started = Date.UTC(2026, 10, 8, 16, 59, 0);
    const held = resolveWeek(weekKey(started), weekIndex(started));

    const crossed = started + 2 * 60 * 1000; // past the Monday 00:00 UTC+7 boundary
    const next = resolveWeek(weekKey(crossed), weekIndex(crossed));

    assert.equal(held.key, '2026-W45');
    assert.equal(next.key, '2026-W46', 'the next run picks up the new week');
    assert.notEqual(held.entry.id, next.entry.id, 'and it is a different entry');
  });
});
