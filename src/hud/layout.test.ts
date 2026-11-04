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
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_RENAME_INTERVAL_DAYS,
  GAME_OVER_HEADING_SIZE,
  GAME_OVER_HEADING_TRACKING,
  GAME_OVER_PROMPT_SIZE,
  GAME_OVER_STATS_SIZE,
  GAME_OVER_WEEK_SIZE,
  HUD_LEFT_X,
  HUD_MARGIN_Y,
  HUD_POWER_METER_WIDTH,
  NAME_EDITOR_HEADING_SIZE,
  NAME_EDITOR_HEADING_TRACKING,
  NAME_EDITOR_NOTICE_SIZE,
  NAME_EDITOR_PROMPT_SIZE,
  NAME_EDITOR_RULE_SIZE,
  PAUSE_NOTE_SIZE,
  PAUSE_PROMPT_SIZE,
  POWER_FOCUS_REARM,
  POWER_MAX,
  RENDER_HEIGHT,
  RENDER_WIDTH,
  TITLE_BEST_SIZE,
  TITLE_FOOTNOTE_SIZE,
  TITLE_FREE_PLAY_SIZE,
  TITLE_HEADING_SIZE,
  TITLE_HEADING_TRACKING,
  TITLE_NAME_SIZE,
  TITLE_PROMPT_SIZE,
  TITLE_TAGLINE_SIZE,
  TITLE_WEEK_SIZE,
} from '../config/index';
import { weeklyCells } from '../config/weeklyModifiers';
import { RUN_MODE } from '../scenes/events';
import { weekReadout } from './readouts';
import * as strings from './strings';
import {
  GAME_OVER_BOXES,
  GAME_OVER_CLEAR_BAND,
  NAME_EDITOR_BOXES,
  NAME_FIELD_BOX,
  NAME_FIELD_LONGEST_DRAFT,
  NAME_FIELD_TEXT_BOX,
  NAME_FIELD_TEXT_BUDGET,
  PLAY_HUD_BOXES,
  TITLE_BOXES,
  fitBox,
  fitScale,
  OVERLAY_ROW_BUDGET,
  formatCount,
  formatRunTime,
  formatSeconds,
  nameDraftWidth,
  overlaps,
  overlayTextWidth,
  powerFillWidth,
  powerMarkX,
  resetCountdownParts,
  type HudBox,
  type Viewport,
} from './layout';

const ALL_BOXES: readonly HudBox[] = [
  ...PLAY_HUD_BOXES.map((entry) => entry.box),
  ...TITLE_BOXES,
  ...GAME_OVER_BOXES,
  ...NAME_EDITOR_BOXES,
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
    for (const rows of [TITLE_BOXES, GAME_OVER_BOXES, NAME_EDITOR_BOXES]) {
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

describe('the weekly rows (design.md §14.8, criterion 27)', () => {
  it('puts the week above the prompt on the title screen, under the figures', () => {
    const names = TITLE_BOXES.map((box) => box.name);
    const week = names.indexOf('title week');
    const freePlay = names.indexOf('title free play');

    assert.ok(week > names.indexOf('title best score'), 'the figures come first');
    assert.ok(freePlay === week + 1, 'the other mode reads directly under the week it replaces');
    assert.ok(freePlay < names.indexOf('title prompt'), 'and both are read before the prompt');
  });

  it('puts the week on the game-over screen, below the lamp', () => {
    const week = GAME_OVER_BOXES.find((box) => box.name === 'game-over week');

    assert.ok(week !== undefined, 'the run names the week it was played under (criterion 27)');
    assert.ok(
      week.top >= GAME_OVER_CLEAR_BAND.bottom,
      'and does it without covering the crawler still touching the lamp',
    );
  });

  it('keeps every frame of PLAYING clear of the week (C2.2)', () => {
    // The week is on the two screens either side of a run and on no frame
    // inside one, and the four corner clusters are exactly as they were: the
    // power, score and best-score readouts are not displaced by any of this.
    for (const entry of PLAY_HUD_BOXES) {
      assert.ok(
        !/week|reset|free play/iu.test(entry.box.name),
        `${entry.box.name} would put the week in front of a player mid-run`,
      );
    }

    const names = PLAY_HUD_BOXES.map((entry) => entry.box.name);
    for (const readout of ['power meter', 'score value', 'best score']) {
      assert.ok(names.includes(readout), `${readout} is still on screen during a run`);
    }
  });
});

describe('every centred row fits between the margins', () => {
  // The horizontal half of criterion 7, and the one the box model cannot see:
  // a centred row is budgeted at the full frame width there, so a sentence that
  // has outgrown the frame overlaps nothing and fails nothing. Each row below
  // is the *longest* thing it can ever say — the longest legal name, a
  // seven-figure score, the wordiest cell in the §14.5 table beside the
  // wordiest countdown — measured against the generous ratio in `src/config`.

  /** The widest the week row can ever be: worst cell, worst countdown. */
  const longestWeekRow = (): string => {
    let longest = '';

    for (const { entry, valueIndex } of weeklyCells()) {
      // 0 ms is "Resets within the minute", which is longer than any figure.
      for (const msRemaining of [0, 2 * 24 * 60 * 60 * 1000 + 14 * 60 * 60 * 1000]) {
        const row = weekReadout({ key: '2026-W45', entryId: entry.id, valueIndex, msRemaining });
        if (row.length > longest.length) {
          longest = row;
        }
      }
    }

    return longest;
  };

  const LONGEST_NAME = 'W'.repeat(DISPLAY_NAME_MAX_LENGTH);
  const BIG_FIGURE = formatCount(9_999_999);

  const ROWS: readonly { content: string; size: number; tracking?: number }[] = [
    // Title screen
    { content: strings.TITLE_HEADING, size: TITLE_HEADING_SIZE, tracking: TITLE_HEADING_TRACKING },
    { content: strings.TITLE_TAGLINE, size: TITLE_TAGLINE_SIZE },
    { content: strings.displayNameRow(LONGEST_NAME, 0), size: TITLE_NAME_SIZE },
    {
      content: strings.displayNameRow(LONGEST_NAME, DISPLAY_NAME_RENAME_INTERVAL_DAYS),
      size: TITLE_NAME_SIZE,
    },
    { content: strings.bestScoreLine(BIG_FIGURE), size: TITLE_BEST_SIZE },
    { content: strings.TITLE_NO_BEST, size: TITLE_BEST_SIZE },
    { content: longestWeekRow(), size: TITLE_WEEK_SIZE },
    { content: strings.TITLE_FREE_PLAY, size: TITLE_FREE_PLAY_SIZE },
    { content: strings.TITLE_PROMPT, size: TITLE_PROMPT_SIZE },
    { content: strings.TITLE_FOOTNOTE, size: TITLE_FOOTNOTE_SIZE },

    // Game over
    {
      content: strings.GAME_OVER_HEADING,
      size: GAME_OVER_HEADING_SIZE,
      tracking: GAME_OVER_HEADING_TRACKING,
    },
    {
      content: strings.gameOverStatsLine(RUN_MODE.WEEKLY, '10:03.5', BIG_FIGURE),
      size: GAME_OVER_STATS_SIZE,
    },
    {
      content: strings.gameOverStatsLine(RUN_MODE.FREE_PLAY, '10:03.5', BIG_FIGURE),
      size: GAME_OVER_STATS_SIZE,
    },
    { content: longestWeekRow(), size: GAME_OVER_WEEK_SIZE },
    { content: strings.newBestLine(BIG_FIGURE), size: GAME_OVER_PROMPT_SIZE },
    { content: strings.GAME_OVER_PROMPT, size: GAME_OVER_PROMPT_SIZE },

    // Pause and the name editor, which share this geometry
    { content: strings.PAUSE_NOTE, size: PAUSE_NOTE_SIZE },
    { content: strings.PAUSE_PROMPT, size: PAUSE_PROMPT_SIZE },
    {
      content: strings.NAME_EDITOR_HEADING,
      size: NAME_EDITOR_HEADING_SIZE,
      tracking: NAME_EDITOR_HEADING_TRACKING,
    },
    { content: strings.NAME_EDITOR_RULE, size: NAME_EDITOR_RULE_SIZE },
    { content: strings.NAME_EDITOR_WEEKLY, size: NAME_EDITOR_NOTICE_SIZE },
    { content: strings.nameEditorPrompt(LONGEST_NAME), size: NAME_EDITOR_PROMPT_SIZE },
  ];

  it('never writes a row wider than the frame it is centred in', () => {
    for (const row of ROWS) {
      const width = overlayTextWidth(row.content, row.size, row.tracking ?? 0);

      assert.ok(
        width <= OVERLAY_ROW_BUDGET,
        `"${row.content}" needs ${width.toFixed(0)}px and the frame offers ${OVERLAY_ROW_BUDGET}px`,
      );
    }
  });

  it('measures the longest week the table can produce, not a convenient one', () => {
    const longest = longestWeekRow();

    assert.ok(longest.includes('2026-W45'), 'the row that was measured is a real week row');
    assert.ok(
      weeklyCells().length > 1,
      'and it was chosen from every cell the §14.5 table declares',
    );
  });
});

describe('the layout at every window size (vision.md §6 criterion 7)', () => {
  // The claim the fixed render target rests on, run rather than asserted: FIT
  // scales one 960x540 frame uniformly and letterboxes the rest, so a row that
  // fits here fits at the 640x360 floor and at 2560x1440. The new title and
  // game-over rows are inside ALL_BOXES, so they are covered by every case.
  const VIEWPORTS: readonly Viewport[] = [
    { width: 640, height: 360 },
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    // Shapes that are not 16:9, because the game is a widget in someone else's
    // box (§2.6) and that box is whatever the host page made it.
    { width: 1024, height: 1024 },
    { width: 1600, height: 400 },
  ];

  for (const viewport of VIEWPORTS) {
    it(`keeps every readout inside a ${viewport.width}x${viewport.height} window`, () => {
      const scale = fitScale(viewport);
      assert.ok(scale > 0, 'the frame is scaled, never collapsed');

      for (const box of ALL_BOXES) {
        const scaled = fitBox(box, viewport);

        assert.ok(scaled.left >= -0.000001, `${box.name} starts off the left edge`);
        assert.ok(scaled.top >= -0.000001, `${box.name} starts above the top edge`);
        assert.ok(scaled.right <= viewport.width + 0.000001, `${box.name} runs off the right`);
        assert.ok(scaled.bottom <= viewport.height + 0.000001, `${box.name} runs off the bottom`);
      }
    });

    it(`never writes one overlay row over another at ${viewport.width}x${viewport.height}`, () => {
      for (const rows of [TITLE_BOXES, GAME_OVER_BOXES, NAME_EDITOR_BOXES]) {
        const scaled = rows.map((box) => fitBox(box, viewport));

        for (let i = 0; i < scaled.length - 1; i += 1) {
          const above = scaled[i];
          const below = scaled[i + 1];
          if (above === undefined || below === undefined) {
            continue;
          }

          assert.ok(above.bottom <= below.top + 0.000001, `${above.name} runs into ${below.name}`);
        }
      }
    });
  }
});

describe('the countdown to the weekly reset (design.md §14.2)', () => {
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  it('splits the remainder into days, hours and minutes', () => {
    assert.deepEqual(resetCountdownParts(2 * DAY + 14 * HOUR + 31 * MINUTE), {
      days: 2,
      hours: 14,
      minutes: 31,
    });
    assert.deepEqual(resetCountdownParts(7 * DAY), { days: 7, hours: 0, minutes: 0 });
  });

  it('truncates, so a countdown never promises time it is about to take back', () => {
    const almost = resetCountdownParts(3 * DAY - 1);

    assert.deepEqual(almost, { days: 2, hours: 23, minutes: 59 });
  });

  it('reads zero in the last minute of the week, and on a nonsense reading', () => {
    for (const ms of [MINUTE - 1, 0, -1, Number.NaN]) {
      assert.deepEqual(
        resetCountdownParts(ms),
        { days: 0, hours: 0, minutes: 0 },
        `${String(ms)} ms is not a countdown`,
      );
    }
  });

  it('never reports more than a week, because a week is all there is', () => {
    const parts = resetCountdownParts(7 * DAY - 1);

    assert.equal(parts.days, 6);
    assert.ok(parts.hours < 24 && parts.minutes < 60, 'units stay inside their own range');
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

describe('the name editor (design.md §15.3)', () => {
  it('fits the longest legal name, and its caret, inside the field', () => {
    // The one thing this screen may not do is let a player edit text they
    // cannot see. The name is mono, so the widest it can ever be is arithmetic.
    assert.ok(
      NAME_FIELD_LONGEST_DRAFT <= NAME_FIELD_TEXT_BUDGET,
      `a ${DISPLAY_NAME_MAX_LENGTH}-character name needs ${NAME_FIELD_LONGEST_DRAFT}px ` +
        `and the field offers ${NAME_FIELD_TEXT_BUDGET}px`,
    );
  });

  it('keeps the line of text inside the box drawn around it', () => {
    assert.ok(NAME_FIELD_TEXT_BOX.top >= NAME_FIELD_BOX.top, 'the draft starts inside the field');
    assert.ok(
      NAME_FIELD_TEXT_BOX.bottom <= NAME_FIELD_BOX.bottom,
      'and the whole line is inside it',
    );
    assert.ok(NAME_FIELD_TEXT_BOX.left >= NAME_FIELD_BOX.left, 'with padding on the left');
    assert.ok(NAME_FIELD_TEXT_BOX.right <= NAME_FIELD_BOX.right, 'and on the right');
  });

  it('grows the draft budget with the draft, and never reports a negative one', () => {
    assert.ok(nameDraftWidth(1) < nameDraftWidth(2), 'a longer name is a wider one');
    assert.ok(nameDraftWidth(0) > 0, 'an empty field still shows a caret');
    assert.equal(nameDraftWidth(-5), nameDraftWidth(0), 'a nonsense length is an empty one');
  });

  it('puts the name on the title screen between the controls and the best score', () => {
    const names = TITLE_BOXES.map((box) => box.name);
    const nameRow = names.indexOf('title display name');

    assert.ok(nameRow > names.indexOf('control row 4'), 'the control table still comes first');
    assert.ok(nameRow < names.indexOf('title best score'), 'and the figures follow it');
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
