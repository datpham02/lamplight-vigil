// docs/design.md §14.2 and its acceptance criterion 18: the week key is a pure
// function of the clock instant, read at the fixed offset
// WEEK_RESET_UTC_OFFSET_HOURS = 7 (GAM-16 decision D6).
//
// The nine vectors below are the ones §14.2 publishes. Every one of them sits on
// a Sunday afternoon or evening in UTC, which is deliberate and is what
// criterion 18 means by "the offset must be exercised rather than assumed": at
// an offset of 0 this table fails six of its nine rows, and only the three
// 16:59:59Z rows still pass. The three 17:00:00Z rows are the sharpest — they
// are Monday 00:00 in the reset frame, and a UTC build reports the week that is
// ending instead of the one that has just begun.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WEEK_RESET_UTC_OFFSET_HOURS, WEEKLY_EPOCH_UTC_MS } from '../config/index';
import { msRemainingInWeek, weekIndex, weekKey } from './weekKey';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** §14.2 — "Worked examples, which are also acceptance vectors". */
const VECTORS: readonly {
  readonly instant: string;
  readonly inResetFrame: string;
  readonly key: string;
  readonly index: number;
}[] = [
  { instant: '2026-01-04T17:00:00Z', inResetFrame: 'Mon 2026-01-05 00:00:00', key: '2026-W02', index: 0 },
  { instant: '2026-01-11T16:59:59Z', inResetFrame: 'Sun 2026-01-11 23:59:59', key: '2026-W02', index: 0 },
  { instant: '2026-01-11T17:00:00Z', inResetFrame: 'Mon 2026-01-12 00:00:00', key: '2026-W03', index: 1 },
  { instant: '2026-11-01T17:00:00Z', inResetFrame: 'Mon 2026-11-02 00:00:00', key: '2026-W45', index: 43 },
  { instant: '2026-11-08T16:59:59Z', inResetFrame: 'Sun 2026-11-08 23:59:59', key: '2026-W45', index: 43 },
  { instant: '2026-11-08T17:00:00Z', inResetFrame: 'Mon 2026-11-09 00:00:00', key: '2026-W46', index: 44 },
  { instant: '2026-12-27T17:00:00Z', inResetFrame: 'Mon 2026-12-28 00:00:00', key: '2026-W53', index: 51 },
  { instant: '2027-01-03T16:59:59Z', inResetFrame: 'Sun 2027-01-03 23:59:59', key: '2026-W53', index: 51 },
  { instant: '2027-01-03T17:00:00Z', inResetFrame: 'Mon 2027-01-04 00:00:00', key: '2027-W01', index: 52 },
];

/** The boundary, in milliseconds, derived from the one constant that owns it. */
const OFFSET_MS = WEEK_RESET_UTC_OFFSET_HOURS * 60 * 60 * 1000;

describe('the week key (design.md §14.2, criterion 18)', () => {
  it('matches every published vector, key and index', () => {
    for (const vector of VECTORS) {
      const ms = Date.parse(vector.instant);
      assert.equal(weekKey(ms), vector.key, `weekKey at ${vector.instant} (${vector.inResetFrame})`);
      assert.equal(
        weekIndex(ms),
        vector.index,
        `weekIndex at ${vector.instant} (${vector.inResetFrame})`,
      );
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

  it('is anchored to the one named offset constant, at 7 (D6)', () => {
    // GAM-16 decision D6, restated by the Board on 2026-11-04 ("Keep UTC+7")
    // and written into §14.2 and §14.4 by GAM-43. The value is asserted here so
    // that it cannot drift silently: every vector in this file moves with it,
    // and §14.2/§14.4 would have to be re-derived by `game-designer` again.
    //
    // This is §14.10's "the week boundary is written down exactly once", which
    // that table numbers 36 — a number §15's table already uses for something
    // else. Cited by its text rather than its number until that is renumbered.
    assert.equal(WEEK_RESET_UTC_OFFSET_HOURS, 7, 'docs/design.md §14.2 derives its vectors at 7');
  });

  it('turns the week over at Monday 00:00 in the reset frame, and nowhere else', () => {
    // Expressed through the constant rather than as a literal Sunday 17:00, so
    // this stays a test of the boundary rather than a second copy of it
    // (criterion 36).
    const resetFrameMonday = Date.UTC(2026, 10, 2, 0, 0, 0);
    const reset = resetFrameMonday - OFFSET_MS;

    assert.equal(weekKey(reset - 1), '2026-W44', 'the last millisecond of the previous week');
    assert.equal(weekKey(reset), '2026-W45', 'the first millisecond of the week');

    // And the UTC midnight that the withdrawn draft used as the boundary is now
    // squarely *inside* the week, not the start of it.
    assert.equal(weekKey(resetFrameMonday), '2026-W45', 'Monday 00:00 UTC is mid-week now');
  });

  it('puts the epoch at index 0 and never goes negative (§14.2)', () => {
    assert.equal(weekIndex(WEEKLY_EPOCH_UTC_MS), 0);
    assert.equal(weekIndex(WEEKLY_EPOCH_UTC_MS + WEEK_MS), 1);

    // A device clock set to 1999 must still resolve a week rather than index a
    // permutation with a negative slot.
    assert.equal(weekIndex(Date.UTC(1999, 0, 1)), 0);
  });

  it('counts down the week for the title screen, from a whole week to nothing', () => {
    const reset = Date.UTC(2026, 10, 2, 0, 0, 0) - OFFSET_MS;

    assert.equal(msRemainingInWeek(reset), WEEK_MS, 'a full week at the reset');
    assert.equal(msRemainingInWeek(reset + WEEK_MS - 1), 1, 'one millisecond at the end');
    assert.equal(msRemainingInWeek(reset + WEEK_MS), WEEK_MS, 'and it rolls over');
  });

  it('holds the ISO rule that a week belongs to the year of its Thursday', () => {
    // 2026 is a 53-week ISO year, so the first days of January 2027 are still
    // 2026-W53. The reverse case: 2027-W01 opens on 4 January 2027 in the reset
    // frame, which is 3 January 17:00 UTC.
    assert.equal(weekKey(Date.UTC(2026, 11, 31)), '2026-W53', 'new year, old ISO year');
    assert.equal(weekKey(Date.UTC(2027, 0, 1)), '2026-W53');
    assert.equal(weekKey(Date.UTC(2027, 0, 4) - OFFSET_MS), '2027-W01');
  });
});
