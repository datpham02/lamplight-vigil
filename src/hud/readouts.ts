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
import type { ScorePayload, WeekPayload } from '../scenes/events';
import { formatCount, formatRunTime, formatSeconds, resetCountdownParts } from './layout';
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

/**
 * The week row, on the title screen before a run and on the game-over screen
 * after it (`docs/design.md` §14.2, §14.5, criterion 27).
 *
 * One composer for both screens, for the same reason `scoreReadouts` exists:
 * "the screen names the week and its modifier" is then a claim settled at a
 * node prompt, over the real table and a real `msRemainingInWeek()` reading,
 * rather than by looking at a browser and believing it.
 *
 * Free Play has no week, so it has no row: §14.8 resolves no entry there at
 * all, and a mode that never reads the clock must not print one.
 */
export function weekReadout(week: WeekPayload | null): string {
  if (week === null) {
    return '';
  }

  return strings.weekLine(
    week.key,
    strings.weeklyCellLine(week.entryId, week.valueIndex),
    strings.weekResetLine(resetCountdownParts(week.msRemaining)),
  );
}
