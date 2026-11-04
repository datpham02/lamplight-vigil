// docs/design.md §14.5, §14.8 and §14.9 — the override layer.
//
// The headline requirement on this file is the one §14.9 states twice: **it must
// not change shipped behaviour at the base config.** Everything else here is
// about keeping a resolved cell inside the fence §14.6 draws around it.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BEAM_WIDE_ANGLE_DEG,
  BEAM_WIDE_HALF_ANGLE_RAD,
  SHIPPED_RUN_CONFIG,
  SPAWN_EDGE_WEIGHTS,
  WEEKLY_MODIFIERS,
  WEEKLY_MODIFIER_SAFE_RANGES,
  type WeeklyModifierConstant,
} from '../config/index';
import {
  applyWeeklyModifier,
  changedRunConfigKeys,
  freePlayRun,
  weeklyModifierCells,
  weeklyRunAt,
  weeklySpawnSeed,
} from './run';
import { fnv1a32 } from './seed';

const CELLS = weeklyModifierCells();

/** §14.5 "Resolved" column. Compared with a tolerance per §14.5's last note. */
const RESOLVED: Readonly<Record<string, number>> = {
  'plain x1.00': 3.2,
  'restless-hollow x0.90': 46.8,
  'restless-hollow x1.10': 57.2,
  'clinging-dark x1.15': 0.46,
  'clinging-dark x1.30': 0.52,
  'thin-wick x0.90': 19.8,
  'thin-wick x0.85': 18.7,
  'hungry-flame x1.10': 28.6,
  'hungry-flame x1.20': 31.2,
  'crowded-threshold x0.94': 3.008,
  'crowded-threshold x1.06': 3.392,
  'narrow-lantern x0.85': 59.5,
  'narrow-lantern x1.15': 80.5,
};

describe('the override layer at the base config (design.md §14.9)', () => {
  it('changes nothing: Free Play is the shipped object itself', () => {
    // §14.8 — Free Play "runs the shipped src/config exactly as committed". Not
    // a copy that can drift from it; the object.
    assert.equal(freePlayRun().config, SHIPPED_RUN_CONFIG);
    assert.equal(freePlayRun().week, null, 'and resolves no entry');
  });

  it('builds the base config from src/config rather than re-declaring it', () => {
    // docs/throughput-sim.md §2: a simulation with its own copy of
    // SPAWN_INTERVAL_START is a document that goes stale, not a check. The same
    // rule applies to the override surface the sweep runs through.
    assert.equal(SHIPPED_RUN_CONFIG.SPAWN_EDGE_WEIGHTS, SPAWN_EDGE_WEIGHTS);
    assert.equal(SHIPPED_RUN_CONFIG.BEAM_WIDE_ANGLE_DEG, BEAM_WIDE_ANGLE_DEG);
    assert.equal(SHIPPED_RUN_CONFIG.BEAM_WIDE_HALF_ANGLE_RAD, BEAM_WIDE_HALF_ANGLE_RAD);
  });

  it('leaves the base untouched when a cell is applied to it', () => {
    const before = { ...SHIPPED_RUN_CONFIG };
    for (const cell of CELLS) {
      void cell.config;
    }
    assert.deepEqual({ ...SHIPPED_RUN_CONFIG }, before, 'applying a modifier must not mutate');
  });

  it('reproduces the shipped config exactly on the plain cell (W3)', () => {
    const plain = CELLS.find((cell) => cell.label === 'plain x1.00');
    assert.ok(plain !== undefined);

    // plain is a x1.00 multiplier rather than a special case (§14.5), so this is
    // also the check that the override layer is not lying about anything: a
    // multiply by one has to come back as the identity.
    assert.deepEqual({ ...plain.config }, { ...SHIPPED_RUN_CONFIG });
  });
});

describe('the fifteen cells (design.md §14.5)', () => {
  it('enumerates every cell the table can produce, in table order', () => {
    assert.equal(CELLS.length, 15);
    assert.equal(CELLS[0]?.label, 'plain x1.00');
    assert.equal(CELLS[CELLS.length - 1]?.label, 'one-axis over-the-top');
  });

  it('resolves each cell to the published value', () => {
    for (const cell of CELLS) {
      const expected = RESOLVED[cell.label];
      if (expected === undefined) {
        continue; // one-axis overrides a record, and has no single number
      }

      const actual = cell.config[cell.entry.constant as Exclude<WeeklyModifierConstant, 'SPAWN_EDGE_WEIGHTS'>];
      assert.ok(
        Math.abs(actual - expected) < 1e-9,
        `${cell.label} resolved to ${actual}, §14.5 publishes ${expected}`,
      );
    }
  });

  it('changes the constant its entry names, and that constant only (W2)', () => {
    for (const cell of CELLS) {
      const changed = changedRunConfigKeys(SHIPPED_RUN_CONFIG, cell.config);

      if (cell.label === 'plain x1.00') {
        assert.deepEqual(changed, [], 'a x1.00 cell changes nothing at all');
        continue;
      }

      // BEAM_WIDE_HALF_ANGLE_RAD is derived from BEAM_WIDE_ANGLE_DEG in
      // src/config and §14.5 requires a modifier to move it too, so it is the
      // one companion key a cell is allowed to change.
      const allowed =
        cell.entry.constant === 'BEAM_WIDE_ANGLE_DEG'
          ? ['BEAM_WIDE_ANGLE_DEG', 'BEAM_WIDE_HALF_ANGLE_RAD']
          : [cell.entry.constant];

      assert.deepEqual([...changed].sort(), [...allowed].sort(), `${cell.label} changed ${changed.join(', ')}`);
    }
  });

  it('keeps every resolved value inside its §10 safe range (W1, criterion 23)', () => {
    for (const cell of CELLS) {
      const range = WEEKLY_MODIFIER_SAFE_RANGES[cell.entry.constant];
      if (range === undefined) {
        continue; // SPAWN_EDGE_WEIGHTS is bounded by B7, not by a numeric range
      }

      const actual = cell.config[cell.entry.constant as Exclude<WeeklyModifierConstant, 'SPAWN_EDGE_WEIGHTS'>];
      assert.ok(
        actual >= range.min && actual <= range.max,
        `${cell.label} resolves ${cell.entry.constant} to ${actual}, outside ${range.min}–${range.max}`,
      );
    }
  });

  it('moves the derived half-angle with the cone it is derived from (§14.5)', () => {
    // A cone whose geometry and whose freeze test disagree freezes crawlers
    // outside the drawn beam. §14.5 calls that a pillar 2 failure, and it is the
    // one derivation in the table that can produce it.
    for (const cell of CELLS) {
      const expected = (cell.config.BEAM_WIDE_ANGLE_DEG * Math.PI) / 180 / 2;
      assert.ok(
        Math.abs(cell.config.BEAM_WIDE_HALF_ANGLE_RAD - expected) < 1e-12,
        `${cell.label}: the half-angle disagrees with the cone`,
      );
    }
  });

  it('overrides the whole edge-weight record for one-axis, not one edge of it', () => {
    const longDark = CELLS.find((cell) => cell.label === 'one-axis long-dark');
    assert.ok(longDark !== undefined);

    assert.deepEqual({ ...longDark.config.SPAWN_EDGE_WEIGHTS }, {
      top: 0.05,
      bottom: 0.05,
      left: 0.45,
      right: 0.45,
    });
    assert.notEqual(longDark.config.SPAWN_EDGE_WEIGHTS, SPAWN_EDGE_WEIGHTS, 'a new record');
  });

  it('refuses a row whose value kind and constant disagree', () => {
    const oneAxis = WEEKLY_MODIFIERS.find((entry) => entry.id === 'one-axis');
    const plain = WEEKLY_MODIFIERS.find((entry) => entry.id === 'plain');
    assert.ok(oneAxis !== undefined && plain !== undefined);

    const multiplier = plain.values[0];
    const weights = oneAxis.values[0];
    assert.ok(multiplier !== undefined && weights !== undefined);

    // An edge-weight value on a numeric constant, or the reverse, is a table
    // edit that would otherwise silently resolve to the wrong thing.
    assert.throws(() => applyWeeklyModifier(SHIPPED_RUN_CONFIG, plain, weights));
    assert.throws(() => applyWeeklyModifier(SHIPPED_RUN_CONFIG, oneAxis, multiplier));
  });
});

describe('a weekly run (design.md §14.2, §14.8)', () => {
  it('is seeded from the week key alone, so two clients agree (vision.md B5)', () => {
    assert.equal(weeklySpawnSeed('2026-W45'), fnv1a32('lamplight-vigil/weekly/1|2026-W45|spawn'));
    assert.notEqual(weeklySpawnSeed('2026-W45'), weeklySpawnSeed('2026-W46'));
  });

  it('carries the week it resolved, the numbers it resolved, and a rewindable source', () => {
    const run = weeklyRunAt(Date.UTC(2026, 10, 4, 11, 30));

    assert.equal(run.week?.key, '2026-W45');
    assert.equal(run.week?.entry.id, 'clinging-dark');
    assert.equal(run.week?.value.id, 'x1.30');
    assert.ok(Math.abs(run.config.BURN_DWELL_TIME - 0.52) < 1e-9, 'the cell is applied');
    assert.equal(typeof run.random.rewind, 'function', 'a weekly run must be replayable');
  });

  it('reads the clock once: the same instant is the same run, every time', () => {
    const instant = Date.UTC(2026, 10, 4, 11, 30);
    const first = weeklyRunAt(instant);
    const second = weeklyRunAt(instant);

    assert.equal(first.week?.key, second.week?.key);
    assert.deepEqual({ ...first.config }, { ...second.config });
    assert.equal(first.random(), second.random());
  });

  it('leaves Free Play unmodified on a week that is anything but (criterion 28)', () => {
    // §14.8, and the criterion names this exact case: on a clinging-dark x1.30
    // week, a Free Play burn still takes the shipped 0.40 s.
    const weekly = weeklyRunAt(Date.UTC(2026, 10, 4, 11, 30));
    const free = freePlayRun();

    assert.ok(Math.abs(weekly.config.BURN_DWELL_TIME - 0.52) < 1e-9);
    assert.equal(free.config.BURN_DWELL_TIME, SHIPPED_RUN_CONFIG.BURN_DWELL_TIME);
    assert.equal(free.config.BURN_DWELL_TIME, 0.4);
  });

  it('is unseeded in Free Play: two runs in one week are different hollows', () => {
    const first = freePlayRun();
    const second = freePlayRun();

    assert.equal(first.random.rewind, undefined, 'nothing to rewind');
    const draws = Array.from({ length: 20 }, () => first.random() !== second.random());
    assert.ok(draws.some(Boolean), 'two Free Play runs must not share a pattern');
  });
});
