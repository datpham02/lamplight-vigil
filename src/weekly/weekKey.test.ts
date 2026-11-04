// docs/design.md §14.2 and its acceptance criterion 18: the week key is a pure
// function of the UTC clock, per ISO-8601. The nine vectors below are the ones
// §14.2 publishes, including the 2026-W53 -> 2027-W01 boundary that is the case
// an implementation gets wrong.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WEEK_RESET_UTC_OFFSET_HOURS, WEEKLY_EPOCH_UTC_MS } from '../config/index';
import { msRemainingInWeek, weekIndex, weekKey } from './weekKey';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** §14.2 — "Worked examples, which are also acceptance vectors". */
const VECTORS: readonly { readonly instant: string; readonly key: string; readonly index: number }[] =
  [
    { instant: '2026-01-05T00:00:00Z', key: '2026-W02', index: 0 },
    { instant: '2026-01-11T23:59:59Z', key: '2026-W02', index: 0 },
    { instant: '2026-01-12T00:00:00Z', key: '2026-W03', index: 1 },
    { instant: '2026-11-02T00:00:00Z', key: '2026-W45', index: 43 },
    { instant: '2026-11-08T23:59:59Z', key: '2026-W45', index: 43 },
    { instant: '2026-11-09T00:00:00Z', key: '2026-W46', index: 44 },
    { instant: '2026-12-28T00:00:00Z', key: '2026-W53', index: 51 },
    { instant: '2027-01-03T00:00:00Z', key: '2026-W53', index: 51 },
    { instant: '2027-01-04T00:00:00Z', key: '2027-W01', index: 52 },
  ];

describe('the week key (design.md §14.2, criterion 18)', () => {
  it('matches every published vector, key and index', () => {
    for (const vector of VECTORS) {
      const ms = Date.parse(vector.instant);
      assert.equal(weekKey(ms), vector.key, `weekKey at ${vector.instant}`);
      assert.equal(weekIndex(ms), vector.index, `weekIndex at ${vector.instant}`);
    }
  });

  it('is pure: the same instant answers the same whatever the host clock says', () => {
    const ms = Date.parse('2026-11-04T09:30:00Z');
    const first = weekKey(ms);

    // Nothing is memoised and no clock is read, so a thousand calls interleaved
    // with real time passing cannot disagree. Criterion 18 says "freeze the
    // clock; no other input" — this is that, from the other direction.
    for (let i = 0; i < 1000; i += 1) {
      assert.equal(weekKey(ms), first);
      assert.equal(weekIndex(ms), 43);
    }
  });

  it('is anchored to the one named offset constant (D6)', () => {
    // The week-key function reads WEEK_RESET_UTC_OFFSET_HOURS and nothing else
    // for its boundary. At the value §14.2 specifies, the week begins Monday
    // 00:00:00 UTC — which is what the vectors above pin. If this constant ever
    // moves, every vector above moves with it and §14.2/§14.4 must be re-derived
    // by `game-designer`: that is the point of it being one named number.
    assert.equal(WEEK_RESET_UTC_OFFSET_HOURS, 0, 'docs/design.md §14.2 derives its vectors at 0');

    const monday = Date.UTC(2026, 10, 2, 0, 0, 0);
    assert.equal(weekKey(monday - 1), '2026-W44', 'the last millisecond of the previous week');
    assert.equal(weekKey(monday), '2026-W45', 'the first millisecond of the week');
  });

  it('puts the epoch at index 0 and never goes negative (§14.2)', () => {
    assert.equal(weekIndex(WEEKLY_EPOCH_UTC_MS), 0);
    assert.equal(weekIndex(WEEKLY_EPOCH_UTC_MS + WEEK_MS), 1);

    // A device clock set to 1999 must still resolve a week rather than index a
    // permutation with a negative slot.
    assert.equal(weekIndex(Date.UTC(1999, 0, 1)), 0);
  });

  it('counts down the week for the title screen, from a whole week to nothing', () => {
    const monday = Date.UTC(2026, 10, 2, 0, 0, 0);

    assert.equal(msRemainingInWeek(monday), WEEK_MS, 'a full week at the reset');
    assert.equal(msRemainingInWeek(monday + WEEK_MS - 1), 1, 'one millisecond at the end');
    assert.equal(msRemainingInWeek(monday + WEEK_MS), WEEK_MS, 'and it rolls over');
  });

  it('holds the ISO rule that a week belongs to the year of its Thursday', () => {
    // 2026 is a 53-week ISO year, so the first three days of January 2027 are
    // still 2026-W53. The reverse case: 2027-W01 opens on 4 January 2027.
    assert.equal(weekKey(Date.UTC(2026, 11, 31)), '2026-W53', 'new year, old ISO year');
    assert.equal(weekKey(Date.UTC(2027, 0, 1)), '2026-W53');
    assert.equal(weekKey(Date.UTC(2027, 0, 4)), '2027-W01');
  });
});
