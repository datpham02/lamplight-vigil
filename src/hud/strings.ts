// src/hud owns the on-screen readouts. This file owns every word of them.
//
// Copy is not a tuning value, so it lives here rather than in `src/config` —
// but the *key names* inside the copy are not copy. They are composed from the
// §10.9 bindings in `src/config`, because `docs/design.md` §7 requires the
// on-screen prompt and the input handler to read the same source: a prompt that
// names a key the game does not listen to is hidden state under pillar 2.

import {
  INPUT_FOCUS_KEY,
  INPUT_FOCUS_POINTER,
  INPUT_RESTART_KEY,
  POWER_FOCUS_REARM,
} from '../config/index';

/** One row of the title screen's control table: the key, and what it does. */
export interface ControlRow {
  readonly key: string;
  readonly effect: string;
}

/**
 * Both focus bindings in one label. `docs/design.md` §7: the left mouse button
 * is an additional binding for the same action, and the title screen states
 * both. If `INPUT_FOCUS_POINTER` is ever turned off, the prompt follows it.
 */
const FOCUS_BINDING_LABEL = INPUT_FOCUS_POINTER
  ? `HOLD ${INPUT_FOCUS_KEY} OR LEFT MOUSE`
  : `HOLD ${INPUT_FOCUS_KEY}`;

// ---------------------------------------------------------------------------
// Play HUD
// ---------------------------------------------------------------------------

export const LABEL_POWER = 'LAMP POWER';
export const LABEL_SCORE = 'SCORE';
export const LABEL_TIME = 'TIME';
export const LABEL_BANISHED = 'BANISHED';

/** Prefixes the best score wherever it appears, so it reads the same on all three screens. */
export const bestScoreLine = (best: string): string => `BEST ${best}`;

/** The spawn ramp, printed. `seconds` is already formatted. */
export const surgeLine = (seconds: string): string => `A CRAWLER EVERY ${seconds} S`;

/**
 * The status line under the power meter. These three strings are where a
 * first-time player reads the trade-off (`docs/vision.md` §6 criterion 5): the
 * meter shows the cost happening, and the line names what it is buying.
 */
export const STATUS_WIDE = 'WIDE · HOLDS THEM STILL · RECHARGING';
export const STATUS_FOCUSED = 'FOCUSED · BURNS THEM AWAY · DRAINING';
export const STATUS_LOCKED_OUT = `NO POWER · FOCUS RETURNS AT ${POWER_FOCUS_REARM}`;

// ---------------------------------------------------------------------------
// Title screen
// ---------------------------------------------------------------------------

export const TITLE_HEADING = 'LAMPLIGHT VIGIL';
export const TITLE_TAGLINE = 'You are the last lamp in a dark hollow.';

export const TITLE_CONTROLS: readonly ControlRow[] = [
  { key: 'MOVE THE MOUSE', effect: 'aims the beam' },
  { key: FOCUS_BINDING_LABEL, effect: 'narrows the beam: it burns, and it drains power' },
  { key: 'RELEASE', effect: 'wide beam holds them still, power recharges' },
  { key: INPUT_RESTART_KEY, effect: 'restarts, once a crawler reaches the lamp' },
];

export const TITLE_NO_BEST = 'NO BEST SCORE YET';
/** §7: any key *or any click* starts the run. The prompt says both. */
export const TITLE_PROMPT = 'PRESS ANY KEY OR CLICK TO BEGIN';
export const TITLE_FOOTNOTE = 'Running out of power never ends the run. It only stops the burning.';

// ---------------------------------------------------------------------------
// Game-over overlay
// ---------------------------------------------------------------------------

export const GAME_OVER_HEADING = 'A CRAWLER REACHED THE LAMP';
export const GAME_OVER_SCORE_LABEL = 'SCORE';
export const GAME_OVER_PROMPT = `PRESS ${INPUT_RESTART_KEY} TO LIGHT IT AGAIN`;

/** Time survived and crawlers banished, on one line under the frozen hollow. */
export const gameOverStatsLine = (time: string, banished: string): string =>
  `${LABEL_TIME} ${time} · ${LABEL_BANISHED} ${banished}`;

/** Said only when this run actually beat the stored best, never on equalling it. */
export const newBestLine = (best: string): string => `NEW BEST ${best}`;
