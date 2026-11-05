// src/scenes owns the Phaser scenes and their lifecycle wiring, including the
// scene event bus other modules talk over.
//
// Cross-module communication goes through these events (or the Phaser registry),
// never by reaching into another module's classes (AGENTS.md). Importing the
// names below is not "reaching in": it is the shared contract. Add an event here
// when a module needs to tell the rest of the game something.
//
// The two state vocabularies below live here for the same reason. The run state
// is the scene's (`docs/design.md` §2); the beam state is `src/beam`'s (§3.1).
// Both are named here so the HUD can read them without importing either module's
// implementation.

import type { NameNotice } from './nameEdit';

/**
 * The name editor's vocabulary of complaints (`docs/design.md` §15.3), named
 * here for the same reason the two state vocabularies below are: the HUD turns
 * each one into a sentence and must be able to read the list without importing
 * the editor's implementation.
 */
export type { NameNotice } from './nameEdit';

// ---------------------------------------------------------------------------
// Run state — docs/design.md §2
// ---------------------------------------------------------------------------

export const RUN_STATE = {
  /** Boot state. No crawlers, no timer, no drain. Any key or click starts a run. */
  TITLE: 'title',
  /** The only state in which the world updates. */
  PLAYING: 'playing',
  /** A crawler reached the lamp. The world is frozen exactly where it was. */
  GAME_OVER: 'game-over',
} as const;

export type RunState = (typeof RUN_STATE)[keyof typeof RUN_STATE];

// ---------------------------------------------------------------------------
// Run mode — docs/design.md §14.8
// ---------------------------------------------------------------------------

/**
 * Which of the two modes a run is played in.
 *
 * Named here with the other two vocabularies because both screens have to read
 * it: the title screen offers the choice (GAM-16 condition C3.2 — there and
 * nowhere else), and the game-over screen names the mode the run was played in,
 * because one best score now spans two configurations and an unlabelled number
 * is state the screen is not showing (§14.8).
 */
export const RUN_MODE = {
  /** The week's entry and the week's dice, resolved once at the run's start. */
  WEEKLY: 'weekly',
  /** §14.8 — unseeded, unranked, and carrying no modifier. */
  FREE_PLAY: 'free-play',
} as const;

export type RunMode = (typeof RUN_MODE)[keyof typeof RUN_MODE];

// ---------------------------------------------------------------------------
// Beam state — docs/design.md §3.1
// ---------------------------------------------------------------------------

export const BEAM_STATE = {
  /** Fully wide. Power recharges. */
  WIDE: 'wide',
  /** Narrowing toward focused. Power drains from the instant the key goes down. */
  NARROWING: 'narrowing',
  /** Fully focused. Power drains, and burn dwell accrues only here. */
  FOCUSED: 'focused',
  /** Widening back out. Power recharges. */
  WIDENING: 'widening',
} as const;

export type BeamState = (typeof BEAM_STATE)[keyof typeof BEAM_STATE];

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const VIGIL_EVENTS = {
  /** The beam's aim changed. Payload: BeamAimedPayload. */
  BEAM_AIMED: 'beam:aimed',
  /** The beam entered a different state in §3.1. Payload: BeamStatePayload. */
  BEAM_STATE_CHANGED: 'beam:state-changed',
  /** Lamp power, every frame of PLAYING. Payload: PowerPayload. */
  POWER_CHANGED: 'power:changed',
  /** The run state machine moved. Payload: RunStatePayload. */
  RUN_STATE_CHANGED: 'run:state-changed',
  /**
   * A run was suspended, or taken off suspension (§2.5). Payload: PausePayload.
   *
   * Separate from RUN_STATE_CHANGED because a suspended run is still PLAYING:
   * nothing about the state machine moved, the frame it is on simply stopped
   * advancing. The HUD needs it because pillar 2 forbids a stopped run clock
   * the screen does not admit to.
   */
  PAUSE_CHANGED: 'run:pause-changed',
  /** Score and its inputs, every frame of PLAYING. Payload: ScorePayload. */
  SCORE_CHANGED: 'score:changed',
  /**
   * A crawler first entered the light. Payload: PointPayload.
   *
   * A transition, not a state: a crawler held in the beam fires this once, on
   * the frame it was caught. Added by the feel pass so the catch has a hook of
   * its own — the other two moments worth confirming already had one.
   */
  CRAWLER_FROZEN: 'crawler:frozen',
  /** A crawler completed its burn dwell. Payload: PointPayload. */
  CRAWLER_BANISHED: 'crawler:banished',
  /** A crawler reached the lamp, ending the run. Payload: PointPayload. */
  LAMP_HIT: 'lamp:hit',
  /**
   * The display name, or the editing session on it, changed (`docs/design.md`
   * §15). Payload: DisplayNamePayload.
   *
   * Fires on the title screen only, and on no frame of PLAYING or GAME_OVER:
   * the name is captured once, before a run, and nothing about it is on the
   * restart path.
   */
  DISPLAY_NAME_CHANGED: 'name:changed',
  /**
   * The week the title screen is naming, or the countdown inside it, moved
   * (`docs/design.md` §14.2, §14.8). Payload: WeekPayload.
   *
   * A title-screen event, like DISPLAY_NAME_CHANGED: it fires on entry to TITLE
   * and then only on a title frame where the countdown's minute changed, which
   * is also the frame a week rollover is noticed on. No frame of PLAYING emits
   * it, and the week a *run* was played under does not come this way — that
   * rides on RunStatePayload, resolved once at the run's start and held.
   */
  WEEK_CHANGED: 'week:changed',
  /** Weekly board and its state line for title/game-over. Payload: LeaderboardPayload. */
  LEADERBOARD_CHANGED: 'leaderboard:changed',
  /** Share line text and copy state for title/game-over. Payload: SharePayload. */
  SHARE_CHANGED: 'share:changed',
  /** HUD asks the scene to copy the share line (one click path). Payload: none. */
  SHARE_REQUESTED: 'share:requested',
} as const;

/** Payload for VIGIL_EVENTS.BEAM_AIMED. */
export interface BeamAimedPayload {
  /** Angle from the lamp to the pointer, in radians, in render space. */
  readonly angleRad: number;
}

/** Payload for VIGIL_EVENTS.BEAM_STATE_CHANGED. */
export interface BeamStatePayload {
  readonly state: BeamState;
  /** Width parameter: 0 is fully wide, 1 is fully focused (§3.1). */
  readonly width: number;
}

/** Payload for VIGIL_EVENTS.POWER_CHANGED. */
export interface PowerPayload {
  readonly power: number;
  readonly max: number;
  /**
   * The level focus arms again at after a blackout (§4.2). Pillar 2 requires the
   * mark to be on screen, so the HUD is given it rather than importing it.
   */
  readonly rearmAt: number;
  /** True while power has bottomed out and focus is being ignored (§4.2). */
  readonly focusLockedOut: boolean;
}

/**
 * One week, as a screen has to say it (`docs/design.md` §14.2, §14.5).
 *
 * The cell is carried as the pair that identifies it — the entry's `id` and the
 * index of the value it drew — rather than as the entry itself, because that
 * pair is what a submission records (§14.4) and is all the HUD needs in order to
 * find the week's words. `src/hud/strings.ts` owns those words; the table in
 * `src/config` owns the numbers; neither has to import the other.
 */
export interface WeekPayload {
  /** §14.2 — `2026-W45`. */
  readonly key: string;
  /** §14.5 — the entry's `id`, e.g. `restless-hollow`. */
  readonly entryId: string;
  /** Which of that entry's values this week drew. */
  readonly valueIndex: number;
  /**
   * Milliseconds left in this week, from `msRemainingInWeek()`.
   *
   * Carried as a duration and never as an instant, because the screen states a
   * countdown and never a clock time: §14.2 will not have an unqualified hour on
   * screen, and a qualified one would put a time zone on a title screen.
   */
  readonly msRemaining: number;
}

export const LEADERBOARD_SCOPE = {
  DEVICE: 'device',
  WEEKLY: 'weekly',
} as const;
export type LeaderboardScope = (typeof LEADERBOARD_SCOPE)[keyof typeof LEADERBOARD_SCOPE];

export const LEADERBOARD_STATUS = {
  LOADING: 'loading',
  SHOWN: 'shown',
  UNAVAILABLE: 'unavailable',
  LAST_KNOWN: 'last-known',
} as const;
export type LeaderboardStatus = (typeof LEADERBOARD_STATUS)[keyof typeof LEADERBOARD_STATUS];

export interface LeaderboardRowPayload {
  readonly rank: number;
  readonly displayName: string;
  readonly score: number;
  readonly isPlayer: boolean;
}

/** Payload for VIGIL_EVENTS.LEADERBOARD_CHANGED. */
export interface LeaderboardPayload {
  readonly visible: boolean;
  readonly weekKey: string | null;
  readonly scope: LeaderboardScope;
  readonly status: LeaderboardStatus;
  readonly rows: readonly LeaderboardRowPayload[];
  readonly playerRow: LeaderboardRowPayload | null;
}

export const SHARE_STATUS = {
  READY: 'ready',
  COPIED: 'copied',
  MANUAL: 'manual',
} as const;
export type ShareStatus = (typeof SHARE_STATUS)[keyof typeof SHARE_STATUS];

/** Payload for VIGIL_EVENTS.SHARE_CHANGED. */
export interface SharePayload {
  readonly line: string;
  readonly status: ShareStatus;
}

/** Payload for VIGIL_EVENTS.RUN_STATE_CHANGED. */
export interface RunStatePayload {
  readonly state: RunState;
  /** Final figures for the run just ended; zeroed on entry to PLAYING. */
  readonly score: number;
  readonly banished: number;
  readonly elapsedSeconds: number;
  readonly bestScore: number;
  /**
   * §14.8 — which mode this run is, or was, played in. On TITLE it is the mode
   * the prompt is offering, which is the weekly vigil: every key but
   * `INPUT_FREE_PLAY_KEY` begins one.
   */
  readonly mode: RunMode;
  /**
   * The week this run was played under, or null in Free Play and on TITLE.
   *
   * §14.2 resolves it once, at the transition to PLAYING, and holds it for the
   * whole run: a clock change, a rollover or a laptop waking from sleep mid-run
   * never retunes a run in progress, and never renames the week the game-over
   * screen is about to state. The HUD shows it on GAME_OVER only — C2.2 keeps
   * every frame of PLAYING clear of it.
   */
  readonly week: WeekPayload | null;
}

/** Payload for VIGIL_EVENTS.PAUSE_CHANGED. */
export interface PausePayload {
  /** True while the run is suspended: no time, no power, no score (§2.5). */
  readonly paused: boolean;
}

/** Payload for VIGIL_EVENTS.SCORE_CHANGED. */
export interface ScorePayload {
  readonly score: number;
  readonly banished: number;
  readonly elapsedSeconds: number;
  readonly bestScore: number;
  /**
   * Seconds until the next crawler spawns — the countdown `src/enemies` is
   * holding right now, not the §5.4 interval it was last reset to.
   *
   * Pillar 2 forbids a timer the game holds and the screen never shows, so the
   * spawner's own clock is carried here rather than being re-derived. The two
   * are different numbers: the interval is how long the gap *was*, the
   * countdown is how much of it is left.
   */
  readonly nextSpawnIn: number;
}

/**
 * Payload for VIGIL_EVENTS.CRAWLER_FROZEN, VIGIL_EVENTS.CRAWLER_BANISHED and
 * VIGIL_EVENTS.LAMP_HIT.
 */
export interface PointPayload {
  readonly x: number;
  readonly y: number;
}

/**
 * Payload for VIGIL_EVENTS.DISPLAY_NAME_CHANGED — the whole name block on the
 * title screen, in one reading (`docs/design.md` §15.2).
 *
 * The editing fields are carried here rather than kept by the HUD so that the
 * scene, which owns the keyboard, and the screen, which owns the words, cannot
 * disagree about whether a field is open.
 */
export interface DisplayNamePayload {
  /** The committed name. What a score submitted now would be filed under. */
  readonly name: string;
  /**
   * Whole days until this name may be changed again, 0 when it may be changed
   * now. Pillar 2: a cooldown the game holds is a cooldown the screen states.
   */
  readonly renameLockDays: number;
  /** Whether the name editor is open. True only ever in TITLE. */
  readonly editing: boolean;
  /** What is in the field, or null when the editor is closed. */
  readonly draft: string | null;
  /** The editor's complaint about the last keystroke, if it had one. */
  readonly notice: NameNotice | null;
}
