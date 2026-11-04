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
import { SHIPPED_RUN_CONFIG } from '../config/index';
import { freePlayRun, seededUnitRandom, weeklyRunAt } from '../weekly/index';
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

/**
 * Everything one run of the field did, as text: every freeze, banish and lamp
 * hit with the frame it happened on and the point it happened at, then the
 * field it finished with, each crawler's position and bearing.
 *
 * Text rather than a structure so that a failure prints the first line that
 * differs instead of a diff of six hundred objects, and so that "identical
 * spawn sequence" is one equality rather than a list of properties someone has
 * to remember to add to.
 */
function transcribe(field: CrawlerField, seconds: number, beam: BeamLight): string {
  const at = (point: { readonly x: number; readonly y: number }): string =>
    `${point.x.toFixed(6)},${point.y.toFixed(6)}`;
  const frames = Math.ceil(seconds / FRAME);
  const lines: string[] = [];
  let elapsed = 0;

  for (let i = 0; i < frames; i += 1) {
    elapsed += FRAME;
    const step = field.step(FRAME, elapsed, beam);

    for (const point of step.froze) {
      lines.push(`${i} froze ${at(point)}`);
    }
    for (const point of step.banished) {
      lines.push(`${i} banished ${at(point)}`);
    }
    if (step.lampHit !== null) {
      lines.push(`${i} lampHit ${at(step.lampHit)}`);
    }
  }

  for (const crawler of field.all) {
    lines.push(`alive ${at(crawler)} bearing ${crawler.bearingRad.toFixed(9)}`);
  }

  return lines.join('\n');
}

describe('difficulty ramps (design.md §5.4)', () => {
  it('starts at SPAWN_INTERVAL_START and decays geometrically to the floor', () => {
    assert.equal(spawnInterval(0), SPAWN_INTERVAL_START);
    assert.ok(spawnInterval(60) < spawnInterval(0));
    assert.ok(spawnInterval(120) < spawnInterval(60));
    assert.equal(spawnInterval(10000), SPAWN_INTERVAL_MIN, 'floored, never zero');
  });

  it('reproduces the §11.1 crossings the run-length target is derived from', () => {
    // 1 / interval(t) is the spawn rate. After the GAM-17 rebalance §11.1 puts
    // first-timer capacity (0.323/s) at about t = 9 s and practised capacity
    // (0.595/s) at about 184 s. tools/throughput-sim.ts derives both from the
    // same curve and asserts the whole §11.1 table; this is the cheap guard that
    // the curve itself has not moved.
    assert.ok(Math.abs(1 / spawnInterval(9) - 0.323) < 0.01);
    assert.ok(Math.abs(1 / spawnInterval(184) - 0.595) < 0.01);
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

describe('the seeded run (design.md §14, GAM-38)', () => {
  /** Long enough to pass the §11.1 first-timer run length several times over. */
  const RUN_SECONDS = 120;

  it('same seed, same inputs, identical spawn sequence', () => {
    // This is OV-2's headline acceptance criterion, and the whole point of the
    // weekly mode: `docs/vision.md` §5b.3 B5 wants two clients on one week key
    // to see the same crawlers. The two fields below are those two clients.
    const here = new CrawlerField(seededUnitRandom(0xc0ffee));
    const there = new CrawlerField(seededUnitRandom(0xc0ffee));

    const transcript = transcribe(here, RUN_SECONDS, DARK);

    assert.ok(transcript.length > 0, 'the run produced something to compare');
    assert.equal(transcribe(there, RUN_SECONDS, DARK), transcript);
  });

  it('holds under a beam that kills, where the field churns', () => {
    // A dark run is deterministic for a dull reason: almost nothing happens to
    // the crawlers. Burning them away keeps the field turning over, so the
    // spawner, the §6.3 re-roll budget and the §5.3 cap all stay in play.
    const here = new CrawlerField(seededUnitRandom(31337));
    const there = new CrawlerField(seededUnitRandom(31337));

    const transcript = transcribe(here, RUN_SECONDS, BURNING);
    const count = (what: string): number =>
      transcript.split('\n').filter((line) => line.includes(` ${what} `)).length;

    assert.ok(count('froze') > 20, `only ${count('froze')} crawlers were caught`);
    assert.ok(count('banished') > 20, `only ${count('banished')} were banished`);
    assert.equal(transcribe(there, RUN_SECONDS, BURNING), transcript);
  });

  it('gives a different seed a different hollow', () => {
    const here = new CrawlerField(seededUnitRandom(1));
    const there = new CrawlerField(seededUnitRandom(2));

    assert.notEqual(transcribe(there, 60, DARK), transcribe(here, 60, DARK));
  });

  it('replays the week on restart, because reset rewinds the seed', () => {
    // Pillar 3 is one more sweep, at the same week. A player's fourth attempt
    // at a weekly run must be the same run as their first, or the board is
    // comparing scores from different hollows.
    const field = new CrawlerField(seededUnitRandom(90210));
    const first = transcribe(field, 60, DARK);

    field.reset();

    assert.equal(transcribe(field, 60, DARK), first);
  });

  it('keeps Free Play unseeded: two runs are two different hollows (§14.8)', () => {
    const first = new CrawlerField(freePlayRun().random);
    const second = new CrawlerField(freePlayRun().random);

    assert.notEqual(transcribe(second, 60, DARK), transcribe(first, 60, DARK));
  });

  it('defaults to the Free Play path, so an unchanged caller is unchanged', () => {
    const field = new CrawlerField();

    // No argument at all is Math.random on the shipped config — what
    // `src/scenes` has always constructed, and what §14.8 keeps for Free Play.
    run(field, 30, FLOODLIT);
    assert.ok(field.all.length > 0);
    assert.equal(spawnInterval(42), spawnInterval(42, SHIPPED_RUN_CONFIG));
    assert.equal(rampedSpeed(42), rampedSpeed(42, SHIPPED_RUN_CONFIG));
  });

  it('takes a week at reset, because a scene instance outlives a run (§2.2)', () => {
    // Phaser reuses the scene, so the field is built once and the week arrives
    // at the transition to PLAYING. A weekly run and a Free Play run on the
    // same field object must not resemble each other.
    const weekly = weeklyRunAt(Date.UTC(2026, 10, 4, 11, 30));
    const field = new CrawlerField();

    field.reset(weekly);
    const seeded = transcribe(field, 60, DARK);

    field.reset(weekly);
    assert.equal(transcribe(field, 60, DARK), seeded, 'the same week replays');

    field.reset(freePlayRun(seededUnitRandom(5)));
    assert.notEqual(transcribe(field, 60, DARK), seeded, 'and Free Play does not');
  });

  it('plays a weekly run at the week’s numbers, not the shipped ones', () => {
    // 2026-W52 is crowded-threshold x1.06 (§14.4): SPAWN_INTERVAL_START 3.2 ->
    // 3.392, so the opening is quieter. The curve has to move with it, or the
    // modifier is a label on a screen rather than a tuning value.
    const quiet = weeklyRunAt(Date.UTC(2026, 11, 23, 12, 0));

    assert.equal(quiet.week?.entry.id, 'crowded-threshold');
    assert.ok(Math.abs(quiet.config.SPAWN_INTERVAL_START - 3.392) < 1e-9);
    assert.ok(
      spawnInterval(0, quiet.config) > spawnInterval(0, SHIPPED_RUN_CONFIG),
      'they come later at first',
    );
    assert.equal(spawnInterval(0, quiet.config), quiet.config.SPAWN_INTERVAL_START);

    // The floor and the slope are not in the table, so the run still bottoms
    // out in the same place and at the same rate.
    assert.equal(spawnInterval(10_000, quiet.config), SHIPPED_RUN_CONFIG.SPAWN_INTERVAL_MIN);
    assert.equal(rampedSpeed(10_000, quiet.config), SHIPPED_RUN_CONFIG.CRAWLER_SPEED_MAX);
  });

  it('keeps the §5.4 shapes under every weekly config, which is what §14.9 B4 rests on', () => {
    // This task retunes nothing. Whatever a modifier does to the constants, the
    // interval still decays geometrically from its start to its floor and the
    // speed still ramps linearly to its cap.
    const weekly = weeklyRunAt(Date.UTC(2026, 10, 4, 11, 30)).config;

    assert.equal(spawnInterval(0, weekly), weekly.SPAWN_INTERVAL_START);
    assert.ok(spawnInterval(120, weekly) < spawnInterval(60, weekly));
    assert.equal(spawnInterval(10_000, weekly), weekly.SPAWN_INTERVAL_MIN);

    assert.equal(rampedSpeed(0, weekly), weekly.CRAWLER_SPEED_BASE);
    assert.ok(rampedSpeed(60, weekly) > rampedSpeed(0, weekly));
    assert.equal(rampedSpeed(10_000, weekly), weekly.CRAWLER_SPEED_MAX);
  });
});
