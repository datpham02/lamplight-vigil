// src/hud owns the on-screen readouts. This file is the step between a payload
// `src/scenes` emits and the exact string that ends up on screen.
//
// It exists so that "the HUD shows X" is a claim a test can settle. `PlayHud`
// needs Phaser to construct, so nothing inside it can be asserted at a node
// prompt; the decision of *what text to show* is pulled out to here, where it
// can. `PlayHud` then does nothing but set these strings on its Text objects.
//
// No Phaser import, and no number of its own: formatting comes from layout.ts,
// places come from `src/config`, words come from strings.ts.

import { HUD_NEXT_SPAWN_DECIMALS, HUD_SURGE_DECIMALS } from '../config/index';
// Past `src/enemies/index.ts` deliberately. The barrel also re-exports
// CrawlerRenderer, which imports Phaser, and Phaser cannot be loaded at a node
// prompt — importing the barrel here would take this module's test down with
// it. `spawnInterval` is that module's own pure export and is the only thing
// taken; `src/enemies/CrawlerField.test.ts` reaches for it the same way.
import { spawnInterval } from '../enemies/CrawlerField';
import type { ScorePayload } from '../scenes/events';
import { formatCount, formatRunTime, formatSeconds } from './layout';
import * as strings from './strings';

/** Every string the play HUD shows for a given score payload. */
export interface ScoreReadouts {
  readonly score: string;
  readonly best: string;
  readonly time: string;
  readonly banished: string;
  /** The countdown the spawner is holding (`docs/vision.md` pillar 2). */
  readonly nextSpawn: string;
  /** The §5.4 interval that countdown is reset to. */
  readonly surge: string;
}

/**
 * Pillar 2 forbids state the screen never shows. Two separate pieces of spawn
 * state qualify, and this is where they stop being confused for each other:
 *
 * - `payload.nextSpawnIn` is the live countdown `CrawlerField` holds. It is
 *   carried on the payload rather than re-derived, because it cannot be
 *   derived — it depends on when the last crawler actually arrived.
 * - `spawnInterval(elapsed)` is the ramp. It is called here rather than carried
 *   because it is a pure function of run time, so a readout taken from the
 *   spawner's own export cannot drift from the spawner.
 */
export function scoreReadouts(payload: ScorePayload): ScoreReadouts {
  return {
    score: formatCount(payload.score),
    best: strings.bestScoreLine(formatCount(payload.bestScore)),
    time: formatRunTime(payload.elapsedSeconds),
    banished: formatCount(payload.banished),
    nextSpawn: strings.nextSpawnLine(
      formatSeconds(payload.nextSpawnIn, HUD_NEXT_SPAWN_DECIMALS),
    ),
    surge: strings.surgeLine(
      formatSeconds(spawnInterval(payload.elapsedSeconds), HUD_SURGE_DECIMALS),
    ),
  };
}
