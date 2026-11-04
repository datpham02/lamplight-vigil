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
// Past the barrel, which re-exports a Phaser-importing renderer this test
// cannot load. Same reason `src/enemies/CrawlerField.test.ts` does it.
import { CrawlerField, spawnInterval, type BeamLight } from '../enemies/CrawlerField';
import type { ScorePayload } from '../scenes/events';
import { formatSeconds } from './layout';
import { scoreReadouts } from './readouts';
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
