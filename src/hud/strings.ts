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
  INPUT_FREE_PLAY_KEY,
  INPUT_RENAME_KEY,
  INPUT_RESTART_KEY,
  INPUT_SHARE_KEY,
  POWER_FOCUS_REARM,
} from '../config/index';
import {
  LEADERBOARD_SCOPE,
  LEADERBOARD_STATUS,
  RUN_MODE,
  SHARE_STATUS,
  type LeaderboardScope,
  type LeaderboardStatus,
  type NameNotice,
  type RunMode,
  type ShareStatus,
} from '../scenes/events';
import { SUBMISSION_STATE, type SubmissionState } from '../platform/index';
import type { ResetCountdown } from './layout';

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
// The two modes — docs/design.md §14.8
// ---------------------------------------------------------------------------
//
// One name per mode, used on every screen that names one, so the mode a player
// chose on the title screen is the mode they read back on game over in exactly
// the same words.

export const MODE_WEEKLY = 'THE WEEKLY VIGIL';
export const MODE_FREE_PLAY = 'FREE PLAY';

/** What to call the mode a run is, or was, played in. */
export const modeName = (mode: RunMode): string =>
  mode === RUN_MODE.FREE_PLAY ? MODE_FREE_PLAY : MODE_WEEKLY;

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

/**
 * §7 and §14.8 — any key *or any click* begins a run, and the prompt names
 * which run that is.
 *
 * Two things are stated rather than assumed. "Any other key" is true because
 * `INPUT_FREE_PLAY_KEY` begins the other mode and `INPUT_RENAME_KEY` opens the
 * name editor; both are named on the rows above this one, so the exceptions are
 * on screen rather than in this document. And the mode is named, because a
 * prompt that says only "to begin" on a screen offering two modes is the mode
 * choice hidden in the one place C3.2 says it must be visible.
 */
export const TITLE_PROMPT = `PRESS ANY OTHER KEY OR CLICK TO BEGIN ${MODE_WEEKLY}`;

/**
 * §14.8 — the other mode, and what it is, on the row under the week it is the
 * alternative to.
 *
 * It says what Free Play *is* rather than what it lacks a rank in: there is no
 * rank on any screen in this build (D4 is pending), and naming one here would
 * be the game describing something the player cannot see. "No week, no twist"
 * is the whole of §14.8's "unseeded and unmodified" in words a first-timer
 * reads once.
 */
export const TITLE_FREE_PLAY = `PRESS ${INPUT_FREE_PLAY_KEY} FOR ${MODE_FREE_PLAY} · NO WEEK, NO TWIST, THE HOLLOW AS IT SHIPS`;
export const TITLE_SHARE = `PRESS ${INPUT_SHARE_KEY} TO COPY A SHARE LINE`;

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
// The week — docs/design.md §14.2, §14.5, §14.8
// ---------------------------------------------------------------------------
//
// Criterion 27 is what this block is written against: *a player who has never
// read the design document can say what is different this week.* So the week is
// never an id, a multiplier or a cell label — `clinging-dark x1.30` is how the
// sweep names a cell, not how a screen does — and it is never a number the
// player has to interpret.
//
// Every sentence below is transcribed from the "On screen" column of the §14.5
// table, which is the brief for them. Where that column carries a slash — "the
// crawl is quicker / slower", "sooner / later" — the two readings are split
// across the entry's two values, in the table's own value order, and
// `readouts.test.ts` holds each one to the direction its multiplier actually
// moves. Where the column carries one sentence for a row, both of that row's
// values say it: `clinging-dark` at x1.15 and at x1.30 are the same sentence
// because the brief writes one, and inventing a louder one for the harder cell
// would be this file deciding a design question.

/** One cell's copy: what the week is called, and what it does. */
export interface WeeklyCellCopy {
  /** `A restless hollow.` — the name, as a player would say it. */
  readonly name: string;
  /** `The crawl is quicker this week.` — the effect, in plain words. */
  readonly effect: string;
}

/**
 * The §14.5 "On screen" column, keyed by entry `id`, one entry per value in
 * that entry's declared order.
 *
 * Keyed by `id` rather than built from the table so that `src/hud` does not
 * import `src/config`'s table and `src/config` holds no copy (§14.1 rule 4 —
 * the table is data). The two are held together by a test that walks every cell
 * the table declares and fails if this map has nothing to say about one.
 */
export const WEEKLY_CELL_COPY: Readonly<Record<string, readonly WeeklyCellCopy[]>> = {
  plain: [{ name: 'A plain vigil.', effect: 'The hollow as it is.' }],
  'restless-hollow': [
    { name: 'A restless hollow.', effect: 'The crawl is slower this week.' },
    { name: 'A restless hollow.', effect: 'The crawl is quicker this week.' },
  ],
  'clinging-dark': [
    { name: 'The dark clings.', effect: 'Burning one takes longer.' },
    { name: 'The dark clings.', effect: 'Burning one takes longer.' },
  ],
  'thin-wick': [
    { name: 'A thin wick.', effect: 'The lamp recovers slowly.' },
    { name: 'A thin wick.', effect: 'The lamp recovers slowly.' },
  ],
  'hungry-flame': [
    { name: 'A hungry flame.', effect: 'Focusing costs more.' },
    { name: 'A hungry flame.', effect: 'Focusing costs more.' },
  ],
  'crowded-threshold': [
    { name: 'A crowded threshold.', effect: 'They come sooner at first.' },
    { name: 'A quiet threshold.', effect: 'They come later at first.' },
  ],
  'narrow-lantern': [
    { name: 'A narrow lantern.', effect: 'The wide beam holds less of the field.' },
    { name: 'A broad lantern.', effect: 'The wide beam holds more of the field.' },
  ],
  'one-axis': [
    { name: 'The long dark.', effect: 'They come from the sides.' },
    { name: 'Over the top.', effect: 'They come from above and below.' },
  ],
};

/**
 * What this week is called and what it does, as one sentence pair.
 *
 * A cell with no copy falls back to its own `id`, so a table edited ahead of
 * this file still *names* the week rather than leaving the row blank — pillar 2
 * would rather the screen said `restless-hollow` than nothing at all. The test
 * that walks the table is what keeps that path unreachable in a shipped build.
 */
export const weeklyCellLine = (entryId: string, valueIndex: number): string => {
  const copy = WEEKLY_CELL_COPY[entryId]?.[valueIndex];

  return copy === undefined ? entryId : `${copy.name} ${copy.effect}`;
};

/**
 * §14.2 — how long is left of this week, as a countdown and never as a clock
 * time: an unqualified hour is hidden state in a friendlier font, and a
 * qualified one would put a time zone on the title screen.
 *
 * Two units at most, largest first, so the figure is read at a glance rather
 * than parsed. The last minute of a week says so in words instead of counting
 * down to a zero the player would be left staring at.
 */
export const weekResetLine = (left: ResetCountdown): string => {
  if (left.days > 0) {
    return `Resets in ${left.days}d ${left.hours}h`;
  }

  if (left.hours > 0) {
    return `Resets in ${left.hours}h ${left.minutes}m`;
  }

  if (left.minutes > 0) {
    return `Resets in ${left.minutes}m`;
  }

  return 'Resets within the minute';
};

/**
 * The whole week, on one row: which week it is, what it does, and when it ends.
 *
 * The same row on the title screen and on the game-over screen, composed once
 * here, because criterion 27 asks for the modifier "in plain words, with the
 * week key" on both — and a player who read it before the run should recognise
 * it after, not have to match two differently-worded lines to each other.
 */
export const weekLine = (key: string, cell: string, reset: string): string =>
  `${key} · ${cell} · ${reset}`;

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
export const GAME_OVER_SHARE = `PRESS ${INPUT_SHARE_KEY} TO COPY THIS RUN`;

/**
 * The mode, the time survived and the crawlers banished, on one line under the
 * frozen hollow.
 *
 * §14.8 requires the mode to be named here: both modes keep the same local best
 * score, so one figure now spans two configurations and an unlabelled number is
 * state the screen is not showing. It leads the row rather than trailing it —
 * it is the thing that says what the two figures beside it are worth.
 */
export const gameOverStatsLine = (mode: RunMode, time: string, banished: string): string =>
  `${modeName(mode)} · ${LABEL_TIME} ${time} · ${LABEL_BANISHED} ${banished}`;

/** Said only when this run actually beat the stored best, never on equalling it. */
export const newBestLine = (best: string): string => `NEW BEST ${best}`;

// ---------------------------------------------------------------------------
// Weekly board + share line
// ---------------------------------------------------------------------------

export const leaderboardHeading = (scope: LeaderboardScope): string =>
  scope === LEADERBOARD_SCOPE.DEVICE ? "THIS DEVICE'S WEEKLY BOARD" : 'WEEKLY BOARD';

export const leaderboardStateLine = (
  status: LeaderboardStatus,
  scope: LeaderboardScope,
  submissionState: SubmissionState,
): string => {
  const board =
    scope === LEADERBOARD_SCOPE.DEVICE ? "this device's board" : 'the weekly board';

  if (submissionState === SUBMISSION_STATE.QUEUED) {
    return 'Score queued offline. It will submit when the game reconnects.';
  }

  if (submissionState === SUBMISSION_STATE.FAILED) {
    return 'Score submit failed.';
  }

  switch (status) {
    case LEADERBOARD_STATUS.LOADING:
      return `Loading ${board}.`;
    case LEADERBOARD_STATUS.SHOWN:
      return `Showing ${board}.`;
    case LEADERBOARD_STATUS.UNAVAILABLE:
      return `The board is unavailable right now.`;
    case LEADERBOARD_STATUS.LAST_KNOWN:
      return `Showing the last known ${board}.`;
  }
};

export const shareReadyLine = (line: string): string => line;

export const shareStatusLine = (status: ShareStatus): string => {
  switch (status) {
    case SHARE_STATUS.READY:
      return `Press ${INPUT_SHARE_KEY} to copy.`;
    case SHARE_STATUS.COPIED:
      return 'Copied.';
    case SHARE_STATUS.MANUAL:
      return 'Clipboard unavailable. Copy the line above.';
  }
};
