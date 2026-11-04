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
  /** Score and its inputs, every frame of PLAYING. Payload: ScorePayload. */
  SCORE_CHANGED: 'score:changed',
  /** A crawler completed its burn dwell. Payload: PointPayload. */
  CRAWLER_BANISHED: 'crawler:banished',
  /** A crawler reached the lamp, ending the run. Payload: PointPayload. */
  LAMP_HIT: 'lamp:hit',
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

/** Payload for VIGIL_EVENTS.RUN_STATE_CHANGED. */
export interface RunStatePayload {
  readonly state: RunState;
  /** Final figures for the run just ended; zeroed on entry to PLAYING. */
  readonly score: number;
  readonly banished: number;
  readonly elapsedSeconds: number;
  readonly bestScore: number;
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

/** Payload for VIGIL_EVENTS.CRAWLER_BANISHED and VIGIL_EVENTS.LAMP_HIT. */
export interface PointPayload {
  readonly x: number;
  readonly y: number;
}
