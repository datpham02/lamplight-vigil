// src/hud owns the on-screen readouts. This file owns every word of them.
//
// Copy is not a tuning value, so it lives here rather than in `src/config` —
// but the *key names* inside the copy are not copy. They are composed from the
// §10.9 bindings in `src/config`, because `docs/design.md` §7 requires the
// on-screen prompt and the input handler to read the same source: a prompt that
// names a key the game does not listen to is hidden state under pillar 2.

import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  INPUT_FOCUS_KEY,
  INPUT_FOCUS_POINTER,
  INPUT_RENAME_KEY,
  INPUT_RESTART_KEY,
  POWER_FOCUS_REARM,
} from '../config/index';
import type { NameNotice } from '../scenes/events';

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

/**
 * The countdown the spawner is holding, printed. `seconds` is already formatted.
 *
 * Worded as time remaining, not as a bare figure, because this row sits
 * directly above `surgeLine` and the two numbers are in the same unit: without
 * the words, `2.4` over `3.1` is a puzzle rather than a readout.
 */
export const nextSpawnLine = (seconds: string): string => `NEXT CRAWLER IN ${seconds} S`;

/** The spawn ramp, printed. `seconds` is already formatted. */
export const surgeLine = (seconds: string): string => `ARRIVING EVERY ${seconds} S`;

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
/**
 * §15.4 — the same prompt while `INPUT_RENAME_KEY` is being offered, which is
 * the only time any key does *not* start a run.
 *
 * The exception is a word, not a footnote, and it is only on screen while it is
 * true: once a rename is on cooldown the key is not offered, every key starts a
 * run again, and the prompt above goes back up. Pillar 2 is the whole reason
 * this is two strings rather than one with a qualifier.
 */
export const TITLE_PROMPT_WITH_RENAME = 'PRESS ANY OTHER KEY OR CLICK TO BEGIN';
export const TITLE_FOOTNOTE = 'Running out of power never ends the run. It only stops the burning.';

/**
 * §15.2 — the name row: who this lamp is kept by, and what can be done about
 * it. One row in two readings, because the second half of it is the state of
 * the weekly rename and pillar 2 does not let that be hidden.
 */
export const displayNameRow = (name: string, renameLockDays: number): string => {
  if (renameLockDays <= 0) {
    return `PLAYING AS ${name} · PRESS ${INPUT_RENAME_KEY} TO RENAME`;
  }

  const days = renameLockDays === 1 ? 'DAY' : 'DAYS';
  return `PLAYING AS ${name} · RENAME AGAIN IN ${renameLockDays} ${days}`;
};

// ---------------------------------------------------------------------------
// Name editor
// ---------------------------------------------------------------------------
//
// `docs/design.md` §15.3. The one screen in the game that takes text, and the
// one place a player can be *refused*. Every refusal below says what the rule
// is rather than that a rule was broken — "LETTERS, NUMBERS AND SPACES ONLY"
// tells the player what to type next; "INVALID NAME" tells them to guess.

export const NAME_EDITOR_HEADING = 'THE NAME ON YOUR LAMP';

/** The rules, stated before they can be broken rather than after. */
export const NAME_EDITOR_RULE =
  `${DISPLAY_NAME_MIN_LENGTH}–${DISPLAY_NAME_MAX_LENGTH} CHARACTERS · ` +
  'LETTERS, NUMBERS AND SINGLE SPACES';

/**
 * What the notice row says when the editor has no complaint. The weekly limit
 * is on screen the whole time the field is open, because finding out about it
 * after committing is finding out too late.
 */
export const NAME_EDITOR_WEEKLY = 'A NAME CAN BE CHANGED ONCE A WEEK';

/** Both ways out, and what ESC goes back to, so neither is a guess. */
export const nameEditorPrompt = (committed: string): string =>
  `ENTER SAVES · ESC KEEPS ${committed}`;

/** The editor's complaints (§15.3), in the words the player reads them in. */
export const nameNoticeLine = (notice: NameNotice): string => {
  switch (notice) {
    case 'too-short':
      return `A NAME NEEDS AT LEAST ${DISPLAY_NAME_MIN_LENGTH} CHARACTERS`;
    case 'too-long':
    case 'full':
      return `A NAME STOPS AT ${DISPLAY_NAME_MAX_LENGTH} CHARACTERS`;
    case 'bad-character':
      return 'LETTERS, NUMBERS AND SPACES ONLY';
    case 'double-space':
      return 'ONE SPACE AT A TIME';
    case 'no-leading-space':
      return 'A NAME CANNOT START WITH A SPACE';
  }
};

// ---------------------------------------------------------------------------
// Pause overlay
// ---------------------------------------------------------------------------
//
// `docs/design.md` §2.5. The note is not reassurance, it is the readout:
// pillar 2 forbids the game holding a stopped run clock that the screen never
// mentions, so the screen says in plain words what the pause is doing to the
// run. "No key starts it by accident" is not promised, because any key does —
// which is also why the prompt is worded the same way the title screen's is.

export const PAUSE_HEADING = 'PAUSED';
export const PAUSE_NOTE = 'The window lost focus. No time is passing and no score is being earned.';
export const PAUSE_PROMPT = 'PRESS ANY KEY OR CLICK TO RESUME';

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
