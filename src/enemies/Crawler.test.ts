// The §5.1 movement and §5.2 freeze/burn/banish rules of docs/design.md.
//
// The first suite is the core-loop correctness test from docs/vision.md §3 — the
// QA check that survived the fourth-pillar ruling as an ordinary correctness test
// of the loop. A failure here is a core-loop bug, not a pillar failure.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BURN_DECAY_MULTIPLIER,
  BURN_DWELL_TIME,
  CRAWLER_RADIUS,
  CRAWLER_SPEED_BASE,
  FREEZE_FLASH_TIME,
  LAMP_RADIUS,
  LAMP_X,
  LAMP_Y,
  RENDER_WIDTH,
} from '../config/index';
import { BASE_TUNING, type CrawlerTuning } from '../config/tuning';
import {
  WEEKLY_MODIFIERS,
  applyWeeklyModifier,
  weeklyCellLabel,
  type WeeklyModifier,
} from '../config/weeklyModifiers';
import { Crawler } from './Crawler';

const FRAME = 1 / 60;

/** A crawler that has just spawned on the right edge, with no speed jitter. */
function freshCrawler(config?: CrawlerTuning): Crawler {
  return new Crawler(RENDER_WIDTH - CRAWLER_RADIUS, LAMP_Y, 1, config);
}

describe('core-loop correctness test (vision.md §3)', () => {
  it('stays frozen and does not die under 30 s of wide beam', () => {
    const crawler = freshCrawler();
    const startX = crawler.x;
    const startY = crawler.y;

    const frames = Math.round(30 / FRAME);
    for (let i = 0; i < frames; i += 1) {
      const banished = crawler.advance(FRAME, CRAWLER_SPEED_BASE, true, false);
      assert.equal(banished, false, 'wide light holds many and kills none');
    }

    assert.equal(crawler.x, startX, 'did not move');
    assert.equal(crawler.y, startY);
    assert.equal(crawler.isFrozen, true);
    assert.equal(crawler.burnFraction, 0, 'a wide beam banks no burn progress');
  });

  it('dies after BURN_DWELL_TIME under a focused beam', () => {
    const crawler = freshCrawler();

    let dwelled = 0;
    let banished = false;
    while (!banished && dwelled < BURN_DWELL_TIME * 2) {
      banished = crawler.advance(FRAME, CRAWLER_SPEED_BASE, true, true);
      dwelled += FRAME;
    }

    assert.equal(banished, true);
    assert.ok(
      Math.abs(dwelled - BURN_DWELL_TIME) <= FRAME,
      `banished at ${dwelled}s, expected about ${BURN_DWELL_TIME}s`,
    );
  });
});

describe('freeze (design.md §5.2 rule 1)', () => {
  it('resumes the frame the light leaves it — no grace, no easing', () => {
    const crawler = freshCrawler();
    crawler.advance(FRAME, CRAWLER_SPEED_BASE, true, false);
    const frozenX = crawler.x;

    crawler.advance(FRAME, CRAWLER_SPEED_BASE, false, false);

    assert.ok(crawler.x < frozenX, 'moving again on the very next frame');
    assert.ok(
      Math.abs(frozenX - crawler.x - CRAWLER_SPEED_BASE * FRAME) < 1e-9,
      'at full speed, with no residual slow',
    );
    assert.equal(crawler.isFrozen, false);
  });

  it('is frozen and burning at once under a focused beam', () => {
    const crawler = freshCrawler();
    const startX = crawler.x;

    crawler.advance(FRAME, CRAWLER_SPEED_BASE, true, true);

    assert.equal(crawler.x, startX, 'the focused beam holds it still too');
    assert.ok(crawler.burnFraction > 0, 'and burns it');
  });
});

describe('burn dwell (design.md §5.2 rule 2)', () => {
  it('accrues only in a focused cone, never in a wide, narrowing or widening one', () => {
    const crawler = freshCrawler();

    crawler.advance(FRAME, CRAWLER_SPEED_BASE, true, false);
    assert.equal(crawler.burnFraction, 0, 'lit by a non-focused beam banks nothing');
  });

  it('decays at BURN_DECAY_MULTIPLIER rather than resetting', () => {
    const crawler = freshCrawler();

    const burnSeconds = BURN_DWELL_TIME / 2;
    const burnFrames = Math.round(burnSeconds / FRAME);
    for (let i = 0; i < burnFrames; i += 1) {
      crawler.advance(FRAME, CRAWLER_SPEED_BASE, true, true);
    }
    const peak = crawler.burnFraction;
    assert.ok(peak > 0 && peak < 1);

    // One frame off-target costs BURN_DECAY_MULTIPLIER frames of progress...
    crawler.advance(FRAME, CRAWLER_SPEED_BASE, false, false);
    const expected = peak - (FRAME * BURN_DECAY_MULTIPLIER) / BURN_DWELL_TIME;
    assert.ok(Math.abs(crawler.burnFraction - expected) < 1e-9, 'decays at the configured rate');

    // ...but does not erase the whole commitment.
    assert.ok(crawler.burnFraction > 0, 'a single jittery frame is not an instant reset');
  });

  it('floors at zero rather than going negative', () => {
    const crawler = freshCrawler();

    for (let i = 0; i < Math.round(1 / FRAME); i += 1) {
      crawler.advance(FRAME, CRAWLER_SPEED_BASE, false, false);
    }

    assert.equal(crawler.burnFraction, 0);
  });
});

describe('movement and contact (design.md §5.1)', () => {
  it('holds a fixed heading straight at the lamp', () => {
    const crawler = new Crawler(CRAWLER_RADIUS, CRAWLER_RADIUS, 1);
    const firstX = crawler.x;
    const firstY = crawler.y;

    crawler.advance(FRAME, CRAWLER_SPEED_BASE, false, false);
    const dx1 = crawler.x - firstX;
    const dy1 = crawler.y - firstY;

    const secondX = crawler.x;
    const secondY = crawler.y;
    crawler.advance(FRAME, CRAWLER_SPEED_BASE, false, false);

    assert.ok(Math.abs(crawler.x - secondX - dx1) < 1e-9, 'same heading every frame');
    assert.ok(Math.abs(crawler.y - secondY - dy1) < 1e-9);
  });

  it('applies the per-crawler jitter on top of the ramped speed', () => {
    const plain = freshCrawler();
    const fast = new Crawler(RENDER_WIDTH - CRAWLER_RADIUS, LAMP_Y, 1.2);

    plain.advance(FRAME, CRAWLER_SPEED_BASE, false, false);
    fast.advance(FRAME, CRAWLER_SPEED_BASE, false, false);

    assert.ok(fast.x < plain.x, 'the jittered crawler covers more ground');
  });

  it('reaches the lamp at LAMP_RADIUS + CRAWLER_RADIUS', () => {
    const contact = LAMP_RADIUS + CRAWLER_RADIUS;
    const crawler = new Crawler(LAMP_X + contact + 1, LAMP_Y, 1);

    assert.equal(crawler.hasReachedLamp, false, 'one pixel short is not contact');

    while (!crawler.hasReachedLamp) {
      crawler.advance(FRAME, CRAWLER_SPEED_BASE, false, false);
    }

    assert.ok(Math.hypot(crawler.x - LAMP_X, crawler.y - LAMP_Y) <= contact);
  });
});

// ---------------------------------------------------------------------------
// Game feel — GAM-12
// ---------------------------------------------------------------------------
//
// The feedback state a crawler carries, and the thing that actually matters
// about a feel pass: that it is only feedback. Nothing in these suites may
// change when a crawler freezes, burns, moves or dies — the suites above own
// that, and they are unchanged.

describe('the catch, as a hook (GAM-12)', () => {
  it('fires on the frame the light arrives, and only that frame', () => {
    const crawler = freshCrawler();

    crawler.advance(FRAME, CRAWLER_SPEED_BASE, false, false);
    assert.equal(crawler.justFroze, false, 'unlit is not a catch');

    crawler.advance(FRAME, CRAWLER_SPEED_BASE, true, false);
    assert.equal(crawler.justFroze, true, 'the light arrived');

    for (let i = 0; i < 10; i += 1) {
      crawler.advance(FRAME, CRAWLER_SPEED_BASE, true, false);
      assert.equal(crawler.justFroze, false, 'held is not caught again');
    }
  });

  it('fires again when the light leaves and comes back', () => {
    const crawler = freshCrawler();

    crawler.advance(FRAME, CRAWLER_SPEED_BASE, true, false);
    crawler.advance(FRAME, CRAWLER_SPEED_BASE, false, false);
    assert.equal(crawler.justFroze, false);

    crawler.advance(FRAME, CRAWLER_SPEED_BASE, true, false);
    assert.equal(crawler.justFroze, true, 'a second catch is a second catch');
  });

  it('counts the first lit frame of a crawler spawned into the beam', () => {
    const crawler = freshCrawler();
    crawler.advance(FRAME, CRAWLER_SPEED_BASE, true, false);

    assert.equal(crawler.justFroze, true);
  });
});

describe('the catch flash (GAM-12)', () => {
  it('starts full on the catch and decays to nothing over FREEZE_FLASH_TIME', () => {
    const crawler = freshCrawler();
    assert.equal(crawler.freezeFlash, 0, 'nothing to show before the catch');

    crawler.advance(FRAME, CRAWLER_SPEED_BASE, true, false);
    assert.equal(crawler.freezeFlash, 1);

    const frames = Math.ceil(FREEZE_FLASH_TIME / FRAME);
    for (let i = 0; i < frames; i += 1) {
      crawler.advance(FRAME, CRAWLER_SPEED_BASE, true, false);
    }

    assert.equal(crawler.freezeFlash, 0, 'and it is gone');
  });

  it('restarts on a second catch rather than carrying over', () => {
    const crawler = freshCrawler();

    crawler.advance(FRAME, CRAWLER_SPEED_BASE, true, false);
    crawler.advance(FRAME, CRAWLER_SPEED_BASE, true, false);
    assert.ok(crawler.freezeFlash < 1, 'it had started to fade');

    crawler.advance(FRAME, CRAWLER_SPEED_BASE, false, false);
    crawler.advance(FRAME, CRAWLER_SPEED_BASE, true, false);

    assert.equal(crawler.freezeFlash, 1, 'the new catch owns the flash');
  });

  it('plays out after the light has left, and holds nothing while it does', () => {
    const crawler = freshCrawler();
    crawler.advance(FRAME, CRAWLER_SPEED_BASE, true, false);

    const frozenX = crawler.x;
    crawler.advance(FRAME, CRAWLER_SPEED_BASE, false, false);

    assert.ok(crawler.freezeFlash > 0, 'the flash outlives the freeze');
    assert.equal(crawler.isFrozen, false, 'but the crawler is not held by it');
    assert.ok(crawler.x < frozenX, 'and it walks again on that same frame (§5.2 rule 1)');
  });
});

// ---------------------------------------------------------------------------
// A weekly modifier reaches the crawler — GAM-46, design.md §14.5
// ---------------------------------------------------------------------------
//
// The bug these exist against is the one GAM-44 fixed for the beam, one module
// over: `BURN_DWELL_TIME` was read from `src/config` at module load, so under
// `clinging-dark` the sim modelled a 0.46 s or 0.52 s burn and the game played
// the shipped 0.40 s. The sweep then certified a week the game does not play.

/** The §14.5 entry with this `id`, or a failed assertion naming it. */
function entryById(id: string): WeeklyModifier {
  const entry = WEEKLY_MODIFIERS.find((candidate) => candidate.id === id);
  assert.ok(entry !== undefined, `§14.5 has no entry ${id}`);
  return entry;
}

/** Seconds of focused cone this crawler takes to be banished from a cold start. */
function secondsToBanish(crawler: Crawler): number {
  let dwelled = 0;

  // Two seconds is five times the shipped dwell and well past the top of
  // `BURN_DWELL_TIME`'s §10.6 safe range, so a crawler that is still alive here
  // is not burning on any number a week can resolve to.
  while (dwelled < 2) {
    dwelled += FRAME;
    if (crawler.advance(FRAME, CRAWLER_SPEED_BASE, true, true)) {
      return dwelled;
    }
  }

  assert.fail('the crawler never burned away');
}

describe('a weekly modifier reaches the crawler (§14.5)', () => {
  const clingingDark = entryById('clinging-dark');

  it('under plain, the burn takes the shipped 0.40 s (§14.8, W3)', () => {
    const plain = applyWeeklyModifier(BASE_TUNING, entryById('plain'), 0);

    assert.equal(plain.BURN_DWELL_TIME, 0.4, 'the shipped dwell, exactly');
    assert.equal(secondsToBanish(freshCrawler(plain)), secondsToBanish(freshCrawler()));
    assert.ok(
      Math.abs(secondsToBanish(freshCrawler(plain)) - BURN_DWELL_TIME) <= FRAME,
      'and it is the dwell src/config ships',
    );
  });

  // Every value `clinging-dark` can resolve to, so the week the game plays is
  // checked at each of them rather than at a representative one.
  for (let valueIndex = 0; valueIndex < clingingDark.values.length; valueIndex += 1) {
    const label = weeklyCellLabel(clingingDark, valueIndex);
    const config = applyWeeklyModifier(BASE_TUNING, clingingDark, valueIndex);

    it(`takes the week's dwell, not the shipped one: ${label}`, () => {
      assert.ok(config.BURN_DWELL_TIME > BURN_DWELL_TIME, 'the dark clings this week');

      const burned = secondsToBanish(freshCrawler(config));

      assert.ok(
        Math.abs(burned - config.BURN_DWELL_TIME) <= FRAME,
        `banished at ${burned}s, expected about ${config.BURN_DWELL_TIME}s`,
      );
      assert.ok(
        burned - BURN_DWELL_TIME > FRAME,
        'and it is not the shipped dwell wearing the week as a label',
      );
    });

    it(`shows progress against the week's dwell, not the shipped one: ${label}`, () => {
      // Pillar 2: `CrawlerRenderer` sweeps the burn arc from `burnFraction`, so
      // a full arc that banishes nothing — or a banish at three-quarters of one
      // — is the same failure §14.5 names for a freeze outside the drawn cone.
      const crawler = freshCrawler(config);
      const shipped = freshCrawler();

      const frames = Math.round(BURN_DWELL_TIME / FRAME) - 1;
      for (let i = 0; i < frames; i += 1) {
        assert.equal(crawler.advance(FRAME, CRAWLER_SPEED_BASE, true, true), false);
        shipped.advance(FRAME, CRAWLER_SPEED_BASE, true, true);
      }

      assert.ok(crawler.burnFraction < 1, 'the week is not done burning yet');
      assert.ok(crawler.burnFraction < shipped.burnFraction, 'it is further behind');
      assert.ok(
        Math.abs(crawler.burnFraction - (frames * FRAME) / config.BURN_DWELL_TIME) < 1e-9,
        'the arc is the dwell it will actually be banished at',
      );
    });
  }

  it('is fixed at spawn, so one crawler cannot play two weeks', () => {
    const weekly = freshCrawler(applyWeeklyModifier(BASE_TUNING, clingingDark, 1));
    const shipped = freshCrawler();

    assert.notEqual(secondsToBanish(weekly), secondsToBanish(shipped));
  });

  it('resolving a cell does not retune the shipped config', () => {
    const before = { ...BASE_TUNING };
    applyWeeklyModifier(BASE_TUNING, clingingDark, 1);

    assert.deepEqual({ ...BASE_TUNING }, before);
    assert.ok(Math.abs(secondsToBanish(freshCrawler()) - BURN_DWELL_TIME) <= FRAME);
  });
});
