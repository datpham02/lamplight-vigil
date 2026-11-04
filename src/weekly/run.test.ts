// docs/design.md §14.2 and §14.8 — what a run is played under, in each mode.
//
// The §14.5 table and the override layer it is applied through are tested where
// they live: `tools/throughput-sim.test.ts` sweeps every cell (W1–W4, the §14.6
// band, the published per-cell values) against `src/config/weeklyModifiers.ts`.
// This file is only about the two things a *run* adds on top of that — the week
// it resolved and the dice it rolls — and about §14.9's headline requirement,
// that none of it changes shipped behaviour at the base config.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BASE_TUNING } from '../config/tuning';
import { freePlayRun, weeklyRunAt, weeklySpawnSeed } from './run';
import { fnv1a32 } from './seed';

/** A Wednesday, far from any boundary: this file is not testing the week key. */
const MID_WEEK_45 = Date.UTC(2026, 10, 4, 11, 30);

describe('a weekly run (design.md §14.2, §14.8)', () => {
  it('is seeded from the week key alone, so two clients agree (vision.md B5)', () => {
    assert.equal(weeklySpawnSeed('2026-W45'), fnv1a32('lamplight-vigil/weekly/1|2026-W45|spawn'));
    assert.notEqual(weeklySpawnSeed('2026-W45'), weeklySpawnSeed('2026-W46'));
  });

  it('carries the week it resolved, the numbers it resolved, and a rewindable source', () => {
    const run = weeklyRunAt(MID_WEEK_45);

    assert.equal(run.week?.key, '2026-W45');
    assert.equal(run.week?.entry.id, 'clinging-dark');
    assert.equal(run.week?.label, 'clinging-dark x1.30');
    assert.ok(Math.abs(run.config.BURN_DWELL_TIME - 0.52) < 1e-9, 'the cell is applied');
    assert.equal(typeof run.random.rewind, 'function', 'a weekly run must be replayable');
  });

  it('reads the clock once: the same instant is the same run, every time', () => {
    const first = weeklyRunAt(MID_WEEK_45);
    const second = weeklyRunAt(MID_WEEK_45);

    assert.equal(first.week?.key, second.week?.key);
    assert.deepEqual({ ...first.config }, { ...second.config });
    assert.equal(first.random(), second.random());
  });

  it('applies a cell without disturbing the base config (§14.9)', () => {
    const before = { ...BASE_TUNING };
    weeklyRunAt(MID_WEEK_45);

    assert.deepEqual({ ...BASE_TUNING }, before, 'resolving a week must not mutate the shipped config');
  });
});

describe('Free Play (design.md §14.8)', () => {
  it('is the shipped object itself, and resolves no week', () => {
    // §14.8 — Free Play "runs the shipped src/config exactly as committed". Not
    // a copy that can drift from it; the object.
    assert.equal(freePlayRun().config, BASE_TUNING);
    assert.equal(freePlayRun().week, null, 'and resolves no entry');
  });

  it('stays unmodified on a week that is anything but (criterion 28)', () => {
    // The criterion names this exact case: on a clinging-dark x1.30 week, a Free
    // Play burn still takes the shipped 0.40 s.
    const weekly = weeklyRunAt(MID_WEEK_45);
    const free = freePlayRun();

    assert.ok(Math.abs(weekly.config.BURN_DWELL_TIME - 0.52) < 1e-9);
    assert.equal(free.config.BURN_DWELL_TIME, BASE_TUNING.BURN_DWELL_TIME);
    assert.equal(free.config.BURN_DWELL_TIME, 0.4);
  });

  it('is unseeded: two runs in one week are different hollows', () => {
    const first = freePlayRun();
    const second = freePlayRun();

    assert.equal(first.random.rewind, undefined, 'nothing to rewind');
    const draws = Array.from({ length: 20 }, () => first.random() !== second.random());
    assert.ok(draws.some(Boolean), 'two Free Play runs must not share a pattern');
  });
});
