// The parts of the HUD that are arithmetic: where every readout sits, how the
// power fill is derived, and how figures are written out.
//
// The placement tests are how `docs/vision.md` §6 criterion 7 is held without a
// browser. The game renders at a fixed 960x540 and `Phaser.Scale.FIT` scales
// that one frame to the window, so a layout that fits inside the render target
// fits identically at 640x360 and at 2560x1440 — what criterion 7 can actually
// catch is a readout placed off the edge, or two of them written over each
// other, and those are decided entirely by the numbers checked below.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  HUD_LEFT_X,
  HUD_MARGIN_Y,
  HUD_POWER_METER_WIDTH,
  POWER_FOCUS_REARM,
  POWER_MAX,
  RENDER_HEIGHT,
  RENDER_WIDTH,
} from '../config/index';
import {
  GAME_OVER_BOXES,
  GAME_OVER_CLEAR_BAND,
  PLAY_HUD_BOXES,
  TITLE_BOXES,
  formatCount,
  formatRunTime,
  formatSeconds,
  overlaps,
  powerFillWidth,
  powerMarkX,
  type HudBox,
} from './layout';

const ALL_BOXES: readonly HudBox[] = [
  ...PLAY_HUD_BOXES.map((entry) => entry.box),
  ...TITLE_BOXES,
  ...GAME_OVER_BOXES,
];

describe('HUD placement (vision.md §6 criterion 7)', () => {
  it('keeps every readout inside the render target', () => {
    for (const box of ALL_BOXES) {
      assert.ok(box.left >= 0, `${box.name} starts off the left edge`);
      assert.ok(box.top >= 0, `${box.name} starts above the top edge`);
      assert.ok(box.right <= RENDER_WIDTH, `${box.name} runs off the right edge`);
      assert.ok(box.bottom <= RENDER_HEIGHT, `${box.name} runs off the bottom edge`);
    }
  });

  it('keeps every readout inside the vertical margin', () => {
    for (const box of ALL_BOXES) {
      assert.ok(box.top >= HUD_MARGIN_Y, `${box.name} crowds the top of the frame`);
      assert.ok(
        box.bottom <= RENDER_HEIGHT - HUD_MARGIN_Y,
        `${box.name} crowds the bottom of the frame`,
      );
    }
  });

  it('never writes one play-HUD readout over another', () => {
    for (let i = 0; i < PLAY_HUD_BOXES.length; i += 1) {
      for (let j = i + 1; j < PLAY_HUD_BOXES.length; j += 1) {
        const a = PLAY_HUD_BOXES[i];
        const b = PLAY_HUD_BOXES[j];
        if (a === undefined || b === undefined) {
          continue;
        }

        assert.equal(
          overlaps(a.box, b.box),
          false,
          `${a.box.name} and ${b.box.name} overlap at their full width budget`,
        );
      }
    }
  });

  it('gives the spawn countdown a row of its own, not a share of the ramp’s', () => {
    // Pillar 2: the countdown `CrawlerField` holds and the §5.4 interval it is
    // reset to are two different pieces of state, so they get two rows. The
    // non-overlap proof above then applies to them like any other pair.
    const names = PLAY_HUD_BOXES.map((entry) => entry.box.name);

    assert.ok(names.includes('spawn countdown'), 'the held countdown is on screen');
    assert.ok(names.includes('spawn ramp'), 'so is the interval it is reset to');
  });

  it('puts the four play-HUD clusters in four different corners', () => {
    const corners = new Set(PLAY_HUD_BOXES.map((entry) => entry.corner));
    assert.equal(corners.size, 4, 'readouts sit in the corners, which crawlers walk away from');
  });

  it('never writes one overlay row over another', () => {
    for (const rows of [TITLE_BOXES, GAME_OVER_BOXES]) {
      for (let i = 0; i < rows.length - 1; i += 1) {
        const above = rows[i];
        const below = rows[i + 1];
        if (above === undefined || below === undefined) {
          continue;
        }

        assert.ok(
          above.bottom <= below.top,
          `${above.name} runs into ${below.name}`,
        );
      }
    }
  });
});

describe('game-over overlay (vision.md §6 criterion 6)', () => {
  it('leaves the lamp and the crawler touching it uncovered', () => {
    for (const box of GAME_OVER_BOXES) {
      const clearsAbove = box.bottom <= GAME_OVER_CLEAR_BAND.top;
      const clearsBelow = box.top >= GAME_OVER_CLEAR_BAND.bottom;

      assert.ok(
        clearsAbove || clearsBelow,
        `${box.name} covers the lamp, where the crawler that killed the player is frozen`,
      );
    }
  });

  it('shows the figures both above and below the lamp, not stacked on one side', () => {
    const above = GAME_OVER_BOXES.filter((box) => box.bottom <= GAME_OVER_CLEAR_BAND.top);
    const below = GAME_OVER_BOXES.filter((box) => box.top >= GAME_OVER_CLEAR_BAND.bottom);

    assert.ok(above.length > 0, 'the headline and score read above the lamp');
    assert.ok(below.length > 0, 'the stats, best score and restart prompt read below it');
  });
});

describe('power meter', () => {
  it('fills the whole track at full power and none of it at zero', () => {
    assert.equal(powerFillWidth(0, POWER_MAX), 0);
    assert.equal(powerFillWidth(POWER_MAX, POWER_MAX), HUD_POWER_METER_WIDTH);
    assert.equal(powerFillWidth(POWER_MAX / 2, POWER_MAX), HUD_POWER_METER_WIDTH / 2);
  });

  it('clamps readings that land outside the range', () => {
    // Power is integrated from frame deltas, so it can overshoot by a hair.
    assert.equal(powerFillWidth(-0.0001, POWER_MAX), 0);
    assert.equal(powerFillWidth(POWER_MAX + 0.0001, POWER_MAX), HUD_POWER_METER_WIDTH);
    assert.equal(powerFillWidth(Number.NaN, POWER_MAX), 0);
    assert.equal(powerFillWidth(50, 0), 0, 'a zero range must not divide');
  });

  it('rises with power and never leaves the track', () => {
    let previous = -1;
    for (let power = 0; power <= POWER_MAX; power += 1) {
      const width = powerFillWidth(power, POWER_MAX);
      assert.ok(width > previous, 'the fill grows with every point of power');
      assert.ok(width <= HUD_POWER_METER_WIDTH, 'the fill never exceeds its track');
      previous = width;
    }
  });

  it('puts the §4.2 rearm tick on the track, where the fill will reach it', () => {
    const tick = powerMarkX(POWER_FOCUS_REARM, POWER_MAX);

    assert.ok(tick > HUD_LEFT_X, 'the rearm mark is not hidden at the empty end');
    assert.ok(
      tick < HUD_LEFT_X + HUD_POWER_METER_WIDTH,
      'the rearm mark is not hidden at the full end',
    );
  });
});

describe('writing figures out', () => {
  it('formats the run timer as m:ss.t', () => {
    assert.equal(formatRunTime(0), '0:00.0');
    assert.equal(formatRunTime(7.42), '0:07.4');
    assert.equal(formatRunTime(59.99), '0:59.9', 'truncates, never rounds up into the next minute');
    assert.equal(formatRunTime(60), '1:00.0');
    assert.equal(formatRunTime(603.5), '10:03.5');
  });

  it('treats a nonsense elapsed time as zero rather than printing NaN', () => {
    assert.equal(formatRunTime(Number.NaN), '0:00.0');
    assert.equal(formatRunTime(-1), '0:00.0');
  });

  it('groups figures every three digits', () => {
    assert.equal(formatCount(0), '0');
    assert.equal(formatCount(7), '7');
    assert.equal(formatCount(999), '999');
    assert.equal(formatCount(1000).replace(/\s/gu, ''), '1000');
    assert.equal(formatCount(1000).length, 5, 'one separator in a four-figure score');
    assert.equal(formatCount(1234567).length, 9, 'two separators in a seven-figure score');
  });

  it('rounds the spawn ramp to a readable number of places', () => {
    assert.equal(formatSeconds(4, 1), '4.0');
    assert.equal(formatSeconds(2.4444, 1), '2.4');
    assert.equal(formatSeconds(Number.NaN, 1), '0.0');
  });
});
