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
  LAMP_RADIUS,
  LAMP_X,
  LAMP_Y,
  RENDER_WIDTH,
} from '../config/index';
import { Crawler } from './Crawler';

const FRAME = 1 / 60;

/** A crawler that has just spawned on the right edge, with no speed jitter. */
function freshCrawler(): Crawler {
  return new Crawler(RENDER_WIDTH - CRAWLER_RADIUS, LAMP_Y, 1);
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
