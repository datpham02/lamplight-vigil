// What the play HUD puts on screen for a given payload.
//
// The subject of these tests is `docs/vision.md` pillar 2: the game must not
// hold a timer the screen never shows. The spawn countdown is the one that was
// hidden — the HUD used to print the §5.4 interval, which is a different number
// — so the tests below drive a real CrawlerField, take the countdown the scene
// would put on the payload, and assert the HUD prints that.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  HUD_NEXT_SPAWN_DECIMALS,
  SPAWN_FIRST_DELAY,
  SPAWN_INTERVAL_MIN,
} from '../config/index';
import { WEEKLY_MODIFIERS, weeklyCells } from '../config/weeklyModifiers';
// Past the barrel, which re-exports a Phaser-importing renderer this test
// cannot load. Same reason `src/enemies/CrawlerField.test.ts` does it.
import { CrawlerField, spawnInterval, type BeamLight } from '../enemies/CrawlerField';
import { RUN_MODE, type ScorePayload, type WeekPayload } from '../scenes/events';
import { resolveWeekAt } from '../weekly/index';
import { formatSeconds } from './layout';
import { scoreReadouts, weekReadout } from './readouts';
import * as strings from './strings';

/** A beam that lights nothing, so crawlers only ever walk. */
const DARK: BeamLight = { containsPoint: () => false, isBurning: false };

function payload(overrides: Partial<ScorePayload> = {}): ScorePayload {
  return {
    score: 0,
    banished: 0,
    elapsedSeconds: 0,
    bestScore: 0,
    nextSpawnIn: 0,
    ...overrides,
  };
}

/** Pull the number back out of a readout, so a test asserts on seconds. */
function secondsIn(line: string): number {
  const digits = /([0-9]+\.[0-9]+)/u.exec(line);
  assert.ok(digits !== null, `no figure in "${line}"`);
  return Number(digits[1]);
}

describe('the spawn countdown (vision.md pillar 2, criterion 5)', () => {
  it('shows the countdown the payload carries', () => {
    const lines = scoreReadouts(payload({ nextSpawnIn: 2.44, elapsedSeconds: 30 }));

    assert.equal(
      lines.nextSpawn,
      strings.nextSpawnLine(formatSeconds(2.44, HUD_NEXT_SPAWN_DECIMALS)),
    );
    assert.equal(secondsIn(lines.nextSpawn), 2.4);
  });

  it('shows the spawner’s own clock, not the interval it was reset to', () => {
    // Half a second after a spawn at t=0, the countdown reads the gap minus
    // that half second. The ramp still reads the whole gap. If the HUD printed
    // the ramp for both rows the two figures would be identical, which is the
    // defect this test exists to catch.
    const elapsed = 0.5;
    const lines = scoreReadouts(
      payload({ elapsedSeconds: elapsed, nextSpawnIn: spawnInterval(elapsed) - elapsed }),
    );

    assert.notEqual(
      secondsIn(lines.nextSpawn),
      secondsIn(lines.surge),
      'the countdown and the interval are different numbers',
    );
    assert.ok(
      secondsIn(lines.nextSpawn) < secondsIn(lines.surge),
      'time remaining is less than the gap it is counting down',
    );
  });

  it('tracks a real CrawlerField frame by frame', () => {
    const field = new CrawlerField(() => 0.5);
    const frame = 1 / 60;

    // Before the first frame the spawner is sitting on its opening delay.
    assert.equal(field.secondsToNextSpawn, SPAWN_FIRST_DELAY);
    assert.equal(
      secondsIn(scoreReadouts(payload({ nextSpawnIn: field.secondsToNextSpawn })).nextSpawn),
      Number(formatSeconds(SPAWN_FIRST_DELAY, HUD_NEXT_SPAWN_DECIMALS)),
    );

    let elapsed = 0;
    let previous = field.secondsToNextSpawn;
    let sawReset = false;

    for (let i = 0; i < 600; i += 1) {
      elapsed += frame;
      field.step(frame, elapsed, DARK);

      const shown = secondsIn(
        scoreReadouts(payload({ elapsedSeconds: elapsed, nextSpawnIn: field.secondsToNextSpawn }))
          .nextSpawn,
      );

      assert.ok(shown >= 0, 'the countdown never reads negative');
      assert.ok(
        shown <= spawnInterval(elapsed) + SPAWN_FIRST_DELAY,
        'the countdown never exceeds the gap it was set from',
      );

      // It falls between spawns and jumps back up on one.
      if (field.secondsToNextSpawn > previous) {
        sawReset = true;
      }
      previous = field.secondsToNextSpawn;
    }

    assert.ok(sawReset, 'ten seconds of play contains at least one spawn');
    assert.ok(field.all.length > 0, 'and the crawlers it counted down to arrived');
  });

  it('counts down toward zero rather than standing still', () => {
    const field = new CrawlerField(() => 0.5);
    const before = field.secondsToNextSpawn;

    field.step(0.25, 0.25, DARK);

    assert.ok(field.secondsToNextSpawn < before, 'a frame of play spends the countdown');
    assert.equal(field.secondsToNextSpawn, SPAWN_FIRST_DELAY - 0.25);
  });

  it('rewinds with the spawner on a new run', () => {
    const field = new CrawlerField(() => 0.5);
    field.step(0.25, 0.25, DARK);
    field.reset();

    assert.equal(field.secondsToNextSpawn, SPAWN_FIRST_DELAY);
  });

  it('never reads below the floor the ramp bottoms out at, once it has', () => {
    assert.ok(
      SPAWN_INTERVAL_MIN > 0,
      'a zero floor would make the countdown meaningless to print',
    );
  });
});

describe('the rest of the play readouts', () => {
  it('writes the figures the way the HUD shows them', () => {
    const lines = scoreReadouts(
      payload({ score: 1234, banished: 7, elapsedSeconds: 65.4, bestScore: 2000 }),
    );

    assert.equal(lines.score.replace(/\s/gu, ''), '1234');
    assert.equal(lines.banished, '7');
    assert.equal(lines.time, '1:05.4');
    assert.ok(lines.best.startsWith('BEST'), 'the best score is labelled wherever it appears');
  });
});

// ---------------------------------------------------------------------------
// The week on screen — docs/design.md §14.2, §14.5, §14.8
// ---------------------------------------------------------------------------
//
// Criterion 27: *a player who has never read the design document can say what
// is different this week.* These tests are what stops that becoming an id, a
// multiplier or a cell label on a screen, and what keeps the copy in this
// folder honest about the table in `src/config` — the two are separate files by
// §14.1 rule 4, so a cell added there with nothing to say here has to fail.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function weekPayload(overrides: Partial<WeekPayload> = {}): WeekPayload {
  return {
    key: '2026-W45',
    entryId: 'restless-hollow',
    valueIndex: 1,
    msRemaining: 2 * DAY_MS + 14 * HOUR_MS,
    ...overrides,
  };
}

describe('the week row (design.md §14.5, criterion 27)', () => {
  it('names the week, what it does, and when it ends', () => {
    const line = weekReadout(weekPayload());

    assert.ok(line.includes('2026-W45'), 'the week key is on screen');
    assert.ok(line.includes('A restless hollow.'), 'and what this week is called');
    assert.ok(line.includes('The crawl is quicker this week.'), 'and what it does, in plain words');
    assert.ok(line.includes('Resets in 2d 14h'), 'and how long is left of it');
  });

  it('never names a time zone, an hour of the day, or a weekday', () => {
    // §14.2 — the screen states a countdown. An unqualified hour is hidden
    // state in a friendlier font, and a qualified one puts a time zone on the
    // title screen of an arcade game.
    for (const ms of [0, 1, 59_000, HOUR_MS, 3 * DAY_MS, 7 * DAY_MS]) {
      const line = weekReadout(weekPayload({ msRemaining: ms }));

      assert.ok(
        !/utc|gmt|monday|sunday|[0-2]?\d:[0-5]\d/iu.test(line),
        `"${line}" reads as a clock time rather than a countdown`,
      );
    }
  });

  it('says the last minute in words rather than counting to zero', () => {
    assert.ok(weekReadout(weekPayload({ msRemaining: 30_000 })).includes('within the minute'));
    assert.ok(weekReadout(weekPayload({ msRemaining: 0 })).includes('within the minute'));
  });

  it('drops to the units that are left', () => {
    assert.ok(weekReadout(weekPayload({ msRemaining: 5 * HOUR_MS + 2 * 60_000 })).includes('5h 2m'));
    assert.ok(weekReadout(weekPayload({ msRemaining: 7 * 60_000 })).includes('7m'));
  });

  it('has no row at all in Free Play', () => {
    // §14.8 — Free Play resolves no entry and never reads the clock for a week
    // key, so there is nothing for this row to say and it says nothing.
    assert.equal(weekReadout(null), '');
  });

  it('composes the row from a real resolved week', () => {
    // The whole path a player sees, at a fixed instant from the §14.2 vectors:
    // the schedule resolves a cell, this folder finds its words, and the
    // countdown comes from the same arithmetic the week key does. No clock is
    // read here and nothing is awaited — criterion 20's half that does not need
    // a browser.
    const nowMs = Date.UTC(2026, 10, 4, 9, 0, 0);
    const week = resolveWeekAt(nowMs);

    assert.equal(week.key, '2026-W45', 'the §14.2 vector table says so');

    const line = weekReadout({
      key: week.key,
      entryId: week.entry.id,
      valueIndex: week.valueIndex,
      // Monday 2026-11-02 00:00 at UTC+7 is 2026-11-01T17:00:00Z, so this
      // instant is 2d 16h into the week and 4d 8h from the end of it.
      msRemaining: 4 * DAY_MS + 8 * HOUR_MS,
    });

    assert.ok(line.startsWith('2026-W45 · '), `"${line}" opens with the week`);
    assert.ok(line.endsWith('Resets in 4d 8h'), `"${line}" closes with the countdown`);
    assert.ok(
      line.includes(strings.weeklyCellLine(week.entry.id, week.valueIndex)),
      'and carries the cell the schedule actually resolved',
    );
  });
});

describe('the words every cell is said in (§14.5 "On screen")', () => {
  it('has copy for every cell the table can resolve to', () => {
    for (const { entry, valueIndex } of weeklyCells()) {
      const copy = strings.WEEKLY_CELL_COPY[entry.id]?.[valueIndex];

      assert.ok(
        copy !== undefined,
        `${entry.id} value ${valueIndex} is a week the game can generate with nothing to say about it`,
      );
      assert.ok(copy.name.endsWith('.'), `${entry.id}: the name is a sentence`);
      assert.ok(copy.effect.endsWith('.'), `${entry.id}: so is the effect`);
    }
  });

  it('has no copy for a cell the table cannot resolve to', () => {
    for (const [id, copies] of Object.entries(strings.WEEKLY_CELL_COPY)) {
      const entry = WEEKLY_MODIFIERS.find((modifier) => modifier.id === id);

      assert.ok(entry !== undefined, `${id} is not an entry in the table any more`);
      assert.equal(copies.length, entry.values.length, `${id} has a line per value and no more`);
    }
  });

  it('never puts an id or a multiplier on screen', () => {
    // `clinging-dark x1.30` is how the sweep names a cell. A screen names it in
    // words, or it has not told the player anything they can act on.
    for (const { entry, valueIndex } of weeklyCells()) {
      const line = strings.weeklyCellLine(entry.id, valueIndex);

      assert.ok(!/\d/u.test(line), `"${line}" shows a figure the player cannot use`);
      assert.ok(!/-/u.test(line), `"${line}" reads like an id`);
      assert.ok(line !== entry.id, `${entry.id} fell through to the fallback`);
    }
  });

  it('falls back to naming the week rather than saying nothing', () => {
    assert.equal(strings.weeklyCellLine('a-week-from-a-later-table', 0), 'a-week-from-a-later-table');
    assert.equal(strings.weeklyCellLine('plain', 99), 'plain');
  });

  it('says the direction each value actually moves', () => {
    // The copy and the table are two files, so "quicker" sitting on the slower
    // of two values is a mistake nothing else would catch. §14.5's slashes are
    // split across the values in the table's own order; these are the three
    // rows that have a direction at all.
    const DIRECTIONS = [
      { id: 'restless-hollow', below: 'slower', above: 'quicker' },
      { id: 'crowded-threshold', below: 'sooner', above: 'later' },
      { id: 'narrow-lantern', below: 'holds less', above: 'holds more' },
    ] as const;

    for (const { id, below, above } of DIRECTIONS) {
      const entry = WEEKLY_MODIFIERS.find((modifier) => modifier.id === id);
      assert.ok(entry !== undefined, `${id} is still in the table`);

      entry.values.forEach((value, valueIndex) => {
        assert.equal(typeof value, 'number', `${id} is a multiplier entry`);
        const line = strings.weeklyCellLine(id, valueIndex);
        const expected = (value as number) < 1 ? below : above;

        assert.ok(
          line.includes(expected),
          `${id} x${String(value)} reads "${line}", which does not say "${expected}"`,
        );
      });
    }
  });
});

describe('the mode on the game-over screen (§14.8)', () => {
  it('names the mode the run was played in', () => {
    const weekly = strings.gameOverStatsLine(RUN_MODE.WEEKLY, '0:42.8', '12');
    const free = strings.gameOverStatsLine(RUN_MODE.FREE_PLAY, '0:42.8', '12');

    assert.ok(weekly.startsWith(strings.MODE_WEEKLY), 'the mode leads the row');
    assert.ok(free.startsWith(strings.MODE_FREE_PLAY));
    assert.notEqual(weekly, free, 'one best score spans two modes, so the row says which');
    assert.ok(weekly.includes('0:42.8') && weekly.includes('12'), 'the figures are still there');
  });

  it('calls each mode what the title screen called it', () => {
    assert.ok(strings.TITLE_PROMPT.includes(strings.MODE_WEEKLY), 'the prompt names what it begins');
    assert.ok(strings.TITLE_FREE_PLAY.includes(strings.MODE_FREE_PLAY));
  });
});
