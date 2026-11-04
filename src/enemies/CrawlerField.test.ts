// The §5.3 cap, the §5.4 ramps and the §6 spawn rules of docs/design.md, plus
// the readability bound those rules exist to protect (vision.md §6 criterion 4).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BURN_DWELL_TIME,
  CRAWLER_RADIUS,
  CRAWLER_SPEED_BASE,
  CRAWLER_SPEED_JITTER,
  CRAWLER_SPEED_MAX,
  LAMP_RADIUS,
  LAMP_X,
  LAMP_Y,
  MAX_CRAWLERS,
  RENDER_HEIGHT,
  RENDER_WIDTH,
  SPAWN_CORNER_INSET,
  SPAWN_EDGE_WEIGHTS,
  SPAWN_FIRST_DELAY,
  SPAWN_INTERVAL_MIN,
  SPAWN_INTERVAL_START,
} from '../config/index';
import { CrawlerField, rampedSpeed, spawnInterval, type BeamLight } from './CrawlerField';

const FRAME = 1 / 60;

/** docs/vision.md §6 criterion 4: the readability floor, in seconds. */
const READABILITY_FLOOR = 1.5;

/** docs/design.md §11.2: the effective-speed bound the floor reduces to. */
const EFFECTIVE_SPEED_BOUND = 156;

/** No light anywhere: crawlers walk. */
const DARK: BeamLight = { containsPoint: () => false, isBurning: false };

/** Wide light everywhere: crawlers freeze where they spawned and never die. */
const FLOODLIT: BeamLight = { containsPoint: () => true, isBurning: false };

/** Focused light everywhere: everything burns. */
const BURNING: BeamLight = { containsPoint: () => true, isBurning: true };

/** Deterministic PRNG, so placement assertions are reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run(field: CrawlerField, seconds: number, beam: BeamLight): void {
  const frames = Math.ceil(seconds / FRAME);
  let elapsed = 0;
  for (let i = 0; i < frames; i += 1) {
    elapsed += FRAME;
    field.step(FRAME, elapsed, beam);
  }
}

describe('difficulty ramps (design.md §5.4)', () => {
  it('starts at SPAWN_INTERVAL_START and decays geometrically to the floor', () => {
    assert.equal(spawnInterval(0), SPAWN_INTERVAL_START);
    assert.ok(spawnInterval(60) < spawnInterval(0));
    assert.ok(spawnInterval(120) < spawnInterval(60));
    assert.equal(spawnInterval(10000), SPAWN_INTERVAL_MIN, 'floored, never zero');
  });

  it('reproduces the §11.1 crossings the run-length target is derived from', () => {
    // 1 / interval(t) is the spawn rate. §11.1 puts first-timer capacity
    // (0.31/s) at about t = 55 s and practised capacity (0.60/s) at about 218 s.
    assert.ok(Math.abs(1 / spawnInterval(55) - 0.31) < 0.01);
    assert.ok(Math.abs(1 / spawnInterval(218) - 0.6) < 0.01);
  });

  it('ramps speed linearly and caps it', () => {
    assert.equal(rampedSpeed(0), CRAWLER_SPEED_BASE);
    assert.ok(rampedSpeed(60) > rampedSpeed(0));
    assert.equal(rampedSpeed(10000), CRAWLER_SPEED_MAX, 'capped before jitter');
  });
});

describe('readability (vision.md §6 criterion 4, derived in design.md §11.2)', () => {
  it('honours the joint speed bound as a product, not as two ranges', () => {
    assert.ok(
      CRAWLER_SPEED_MAX * (1 + CRAWLER_SPEED_JITTER) <= EFFECTIVE_SPEED_BOUND,
      'CRAWLER_SPEED_MAX * (1 + CRAWLER_SPEED_JITTER) must stay within the bound',
    );
  });

  it('gives every spawn position at least 1.5 s on screen before contact', () => {
    const field = new CrawlerField(seededRandom(7));
    // Floodlit, so every crawler stays exactly where it spawned.
    run(field, 400, FLOODLIT);
    assert.ok(field.all.length > 0, 'the spawner produced something to check');

    const worstCaseSpeed = CRAWLER_SPEED_MAX * (1 + CRAWLER_SPEED_JITTER);

    for (const crawler of field.all) {
      const travel =
        Math.hypot(crawler.x - LAMP_X, crawler.y - LAMP_Y) - (LAMP_RADIUS + CRAWLER_RADIUS);
      assert.ok(
        travel / worstCaseSpeed >= READABILITY_FLOOR,
        `spawn at (${crawler.x}, ${crawler.y}) reaches the lamp too fast`,
      );
    }
  });
});

describe('spawn placement (design.md §6.3)', () => {
  it('spawns only on an edge, fully on screen, and never inside the field', () => {
    const field = new CrawlerField(seededRandom(11));
    run(field, 400, FLOODLIT);

    for (const { x, y } of field.all) {
      const onVerticalEdge = x === CRAWLER_RADIUS || x === RENDER_WIDTH - CRAWLER_RADIUS;
      const onHorizontalEdge = y === CRAWLER_RADIUS || y === RENDER_HEIGHT - CRAWLER_RADIUS;

      assert.ok(onVerticalEdge || onHorizontalEdge, `(${x}, ${y}) is not on an edge`);
      assert.ok(x >= CRAWLER_RADIUS && x <= RENDER_WIDTH - CRAWLER_RADIUS, 'fully on screen');
      assert.ok(y >= CRAWLER_RADIUS && y <= RENDER_HEIGHT - CRAWLER_RADIUS, 'fully on screen');
    }
  });

  it('keeps corner spawns out of play', () => {
    const field = new CrawlerField(seededRandom(23));
    run(field, 400, FLOODLIT);

    for (const { x, y } of field.all) {
      const onVerticalEdge = x === CRAWLER_RADIUS || x === RENDER_WIDTH - CRAWLER_RADIUS;

      if (onVerticalEdge) {
        assert.ok(y >= SPAWN_CORNER_INSET && y <= RENDER_HEIGHT - SPAWN_CORNER_INSET);
      } else {
        assert.ok(x >= SPAWN_CORNER_INSET && x <= RENDER_WIDTH - SPAWN_CORNER_INSET);
      }
    }
  });

  it('weights the long axis more heavily than the short one (§6.2)', () => {
    const total = SPAWN_EDGE_WEIGHTS.top + SPAWN_EDGE_WEIGHTS.bottom + SPAWN_EDGE_WEIGHTS.left + SPAWN_EDGE_WEIGHTS.right;

    assert.ok(Math.abs(total - 1) < 1e-9, 'the weights must sum to 1');
    assert.ok(
      SPAWN_EDGE_WEIGHTS.left + SPAWN_EDGE_WEIGHTS.right >
        SPAWN_EDGE_WEIGHTS.top + SPAWN_EDGE_WEIGHTS.bottom,
      'a majority of crawlers come from the long axis',
    );
  });
});

describe('spawn timing (design.md §6.1)', () => {
  it('holds the first crawler back by SPAWN_FIRST_DELAY', () => {
    const field = new CrawlerField(seededRandom(3));

    run(field, SPAWN_FIRST_DELAY - FRAME * 2, DARK);
    assert.equal(field.all.length, 0, 'the player gets a beat to find their cursor');

    run(field, FRAME * 4, DARK);
    assert.equal(field.all.length, 1);
  });

  it('rewinds to SPAWN_FIRST_DELAY on reset (§2.2)', () => {
    const field = new CrawlerField(seededRandom(5));
    run(field, 30, FLOODLIT);
    assert.ok(field.all.length > 0);

    field.reset();
    assert.equal(field.all.length, 0, 'all live crawlers destroyed');

    run(field, SPAWN_FIRST_DELAY - FRAME * 2, DARK);
    assert.equal(field.all.length, 0, 'the grace period applies to a restart too');
  });
});

describe('the crawler cap (design.md §5.3)', () => {
  it('never exceeds MAX_CRAWLERS', () => {
    const field = new CrawlerField(seededRandom(13));
    run(field, 600, FLOODLIT);

    assert.equal(field.all.length, MAX_CRAWLERS, 'the cap is reachable by freezing, per §11.4');
  });

  it('drops a spawn at the cap rather than queuing it', () => {
    const field = new CrawlerField(seededRandom(17));
    run(field, 600, FLOODLIT);
    assert.equal(field.all.length, MAX_CRAWLERS);

    // Hundreds of spawns were dropped while the field sat at the cap. Clear it
    // with a focused beam, then watch the refill: arrivals must track the spawn
    // interval, not flush a backlog the moment there is room.
    run(field, 5, BURNING);

    const before = field.all.length;
    const window = 3;
    run(field, window, DARK);
    const arrivals = field.all.length - before;

    assert.ok(
      arrivals <= Math.ceil(window / SPAWN_INTERVAL_MIN),
      `a backlog arrived: ${arrivals} crawlers in ${window}s`,
    );
  });
});

describe('the run-ending contact (design.md §5.1)', () => {
  it('reports a lamp hit, and reports nothing while the field is held', () => {
    const walking = new CrawlerField(seededRandom(29));
    let hit = false;
    const frames = Math.ceil(60 / FRAME);
    let elapsed = 0;

    for (let i = 0; i < frames && !hit; i += 1) {
      elapsed += FRAME;
      hit = walking.step(FRAME, elapsed, DARK).lampHit !== null;
    }
    assert.equal(hit, true, 'an unopposed crawler eventually reaches the lamp');

    const held = new CrawlerField(seededRandom(29));
    elapsed = 0;
    for (let i = 0; i < frames; i += 1) {
      elapsed += FRAME;
      assert.equal(held.step(FRAME, elapsed, FLOODLIT).lampHit, null, 'wide light buys time');
    }
  });

  it('counts a banish exactly once', () => {
    const field = new CrawlerField(seededRandom(31));
    run(field, 30, FLOODLIT);
    const held = field.all.length;
    assert.ok(held > 0);

    // A wide beam banks no dwell, so every crawler it was holding starts its
    // burn together and is banished together, exactly once each.
    let banished = 0;
    const frames = Math.ceil((BURN_DWELL_TIME + FRAME) / FRAME);
    let elapsed = 30;
    for (let i = 0; i < frames; i += 1) {
      elapsed += FRAME;
      banished += field.step(FRAME, elapsed, BURNING).banished.length;
    }

    assert.equal(banished, held, 'every crawler held was counted once and only once');
  });
});

describe('the catch, reported by the field (GAM-12)', () => {
  it('reports each crawler once when the light arrives, not once per frame', () => {
    const field = new CrawlerField(seededRandom(37));
    run(field, 30, DARK);
    const walking = field.all.length;
    assert.ok(walking > 0, 'there is a field to catch');

    const first = field.step(FRAME, 30, FLOODLIT);
    assert.equal(first.froze.length, walking, 'the whole field was caught at once');

    for (let i = 0; i < 10; i += 1) {
      const held = field.step(FRAME, 30, FLOODLIT);
      assert.equal(held.froze.length, 0, 'holding them is not catching them again');
    }
  });

  it('reports a crawler again after the light has left it', () => {
    const field = new CrawlerField(seededRandom(41));
    run(field, 30, DARK);
    const walking = field.all.length;

    field.step(FRAME, 30, FLOODLIT);
    field.step(FRAME, 30, DARK);

    assert.equal(field.step(FRAME, 30, FLOODLIT).froze.length, walking, 'caught again');
  });

  it('is empty on a frame where nothing is lit', () => {
    const field = new CrawlerField(seededRandom(43));
    run(field, 30, DARK);

    assert.equal(field.step(FRAME, 30, DARK).froze.length, 0);
  });

  it('is cleared by reset, so a restart cannot replay the last run (§2.2)', () => {
    const field = new CrawlerField(seededRandom(47));
    run(field, 30, DARK);
    assert.ok(field.step(FRAME, 30, FLOODLIT).froze.length > 0);

    field.reset();

    assert.equal(field.step(FRAME, 0, FLOODLIT).froze.length, 0);
  });
});
