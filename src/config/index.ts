// src/config owns every tuning value in the game; no magic numbers elsewhere.
//
// Every row of `docs/design.md` §10 appears below as a named export, with the
// same name and the same initial value. That table is the contract for
// `docs/vision.md` §6 criterion 9 and `docs/design.md` §12 criterion 1: a
// designer retunes this file and touches no gameplay code. The section headings
// here mirror §10's subsections so the two can be diffed row by row.
//
// A handful of exports have no row in §10 — draw-order depths, texture keys, the
// lamp's cosmetic pulse, the beam's falloff layers, the pre-pointer rest angle.
// Those are rendering details seeded by the skeleton task or added here for the
// same reason: they are numbers a designer or `ui-designer` might want to change,
// so they live here rather than in the modules that read them.

// ---------------------------------------------------------------------------
// Units — not tunables
// ---------------------------------------------------------------------------

/**
 * Phaser hands `update()` a delta in milliseconds, while every duration and rate
 * in `docs/design.md` is expressed per second. This is the only conversion in the
 * game, and it is named so no gameplay module has to write a bare `1000`.
 */
export const MS_PER_SECOND = 1000;

/** Degrees in half a turn. Used only by the radian conversions below. */
const DEGREES_PER_HALF_TURN = 180;

/**
 * A whole turn in radians. Named so the burn arc in `src/enemies` can sweep a
 * full circle without writing a bare `Math.PI * 2`.
 */
export const FULL_TURN_RAD = Math.PI * 2;

/**
 * `docs/design.md` states cone angles and bearings in degrees because that is how
 * a designer thinks about them; the maths needs radians. Converting here keeps
 * both the degree values from §10 and the radians gameplay reads inside
 * `src/config`, so no other module ever needs a conversion constant.
 */
const degToRad = (degrees: number): number => (degrees * Math.PI) / DEGREES_PER_HALF_TURN;

// ---------------------------------------------------------------------------
// §10.1 Render and run
// ---------------------------------------------------------------------------

/** Fixed render size. The canvas is scaled to the window, never re-laid out. */
export const RENDER_WIDTH = 960;
export const RENDER_HEIGHT = 540;

/**
 * `docs/design.md` §2.4 frame-stall clamp. Every delta is clamped to this before
 * any movement, timer, power or score integration uses it, so a backgrounded tab
 * or a GC pause costs the player a slice of time instead of the run.
 */
export const DELTA_CLAMP_MS = 50;

/** §6.1 — grace, in seconds, before the first crawler of a run spawns. */
export const SPAWN_FIRST_DELAY = 1.2;

/**
 * §2.3 — seconds after death during which `INPUT_RESTART_KEY` is not acted on.
 * A press inside it is buffered and fires when it expires; it is never dropped.
 */
export const GAME_OVER_INPUT_LOCKOUT = 0.25;

/**
 * Draw order. Low numbers sit behind high ones. Named so no module has to guess
 * what another module put on the display list.
 */
export const AMBIENT_DEPTH = 5;
export const BEAM_DEPTH = 10;
/** The beam's bloom sits over the cone it brightens and under the lamp's halo. */
export const BEAM_GLOW_DEPTH = 15;
export const LAMP_GLOW_DEPTH = 20;
export const LAMP_DEPTH = 30;
export const CRAWLER_DEPTH = 40;
/** Banish and lamp-hit bursts read over the crawlers they are about. */
export const FEEDBACK_DEPTH = 45;

// ---------------------------------------------------------------------------
// §10.2 Lamp and arena
// ---------------------------------------------------------------------------

/** The dark hollow the lamp stands in. */
export const BACKGROUND_COLOR = '#06070b';

/** The lamp never moves; it is the origin of every beam calculation. */
export const LAMP_X = RENDER_WIDTH / 2;
export const LAMP_Y = RENDER_HEIGHT / 2;

/** §5.1 — half of the contact distance that ends a run. */
export const LAMP_RADIUS = 18;
export const LAMP_COLOR = 0xffd9a0;

/** Soft halo baked into a texture once at boot (see src/beam/Lamp.ts). */
export const LAMP_GLOW_TEXTURE_KEY = 'lamp-glow';
export const LAMP_GLOW_RADIUS = 64;
export const LAMP_GLOW_COLOR = 0xffb347;
export const LAMP_GLOW_ALPHA = 0.18;

/** Mid gradient stop, so the halo falls off softly instead of linearly. */
export const LAMP_GLOW_MID_STOP = 0.45;
export const LAMP_GLOW_MID_ALPHA_SCALE = 0.35;

/** Cosmetic breathing of the halo. Purely visual; drives no gameplay state. */
export const LAMP_PULSE_PERIOD_MS = 2600;
export const LAMP_PULSE_ALPHA_SWING = 0.12;

/**
 * §10.2 — the minimum ambient floor, against the readability risk in
 * `docs/concept.md` §9. A hollow that is literally black hides crawlers the
 * player is entitled to see, so a faint wash of lamplight covers the whole
 * arena. Tinted with `BEAM_COLOR` rather than a colour of its own; `ui-designer`
 * finalises the treatment in the HUD-and-screens task.
 */
export const AMBIENT_LIGHT_ALPHA = 0.08;

// ---------------------------------------------------------------------------
// §10.3 Beam
// ---------------------------------------------------------------------------

/** §3.2 — full cone angle when wide. Spike parameter (§9.2). */
export const BEAM_WIDE_ANGLE_DEG = 70;

/**
 * §3.2 — reach from the lamp centre when wide. Must stay under 480 or the wide
 * beam reaches the side edges and §3.2 fact 1 breaks: a crawler that has just
 * spawned on the left or right edge must not be freezable.
 */
export const BEAM_WIDE_RANGE = 420;

/** §3.2 — full cone angle when focused. Must stay well under the wide angle. */
export const BEAM_FOCUS_ANGLE_DEG = 16;

/**
 * §3.2 — reach from the lamp centre when focused. Must stay above 551, the
 * arena half-diagonal, or the corners become unreachable.
 */
export const BEAM_FOCUS_RANGE = 560;

/** §3.1 — seconds for the width parameter to cross its whole range. */
export const BEAM_TRANSITION_TIME = 0.12;

/** §3.2 — fill alpha. Focused must stay brighter than wide: it is how a player
 * learns in one run that the narrow beam is the expensive, lethal one. */
export const BEAM_WIDE_ALPHA = 0.16;
export const BEAM_FOCUS_ALPHA = 0.34;

export const BEAM_COLOR = 0xffe6b8;

/** Half-angles in radians, derived from the §10.3 degree values above. */
export const BEAM_WIDE_HALF_ANGLE_RAD = degToRad(BEAM_WIDE_ANGLE_DEG) / 2;
export const BEAM_FOCUS_HALF_ANGLE_RAD = degToRad(BEAM_FOCUS_ANGLE_DEG) / 2;

/**
 * Where the beam points before the player has moved the mouse (up-screen).
 * Phaser reports an active pointer at (0, 0) until the mouse first moves over
 * the canvas, which would otherwise snap the beam to the top-left corner.
 */
export const BEAM_REST_ANGLE_DEG = -90;
export const BEAM_REST_ANGLE_RAD = degToRad(BEAM_REST_ANGLE_DEG);

/** One layer of the cone's falloff. */
export interface BeamConeLayer {
  /** Fraction of the beam's current reach this layer covers. */
  readonly lengthScale: number;
  /**
   * Share of the beam's current fill alpha this layer contributes. Layers stack,
   * so near the lamp is brightest and the tip is faintest, while the beam as a
   * whole still reads at the §3.2 alpha for its current width.
   */
  readonly alphaScale: number;
}

/**
 * Nested slices, longest first, approximating distance falloff with alpha only
 * (`docs/concept.md` §7 rules out shaders and the Light2D pipeline). Geometry is
 * rebuilt only when the width parameter changes — never per frame at a settled
 * width, and never to re-aim, which is a rotation.
 */
export const BEAM_CONE_LAYERS: readonly BeamConeLayer[] = [
  { lengthScale: 1, alphaScale: 0.34 },
  { lengthScale: 0.72, alphaScale: 0.26 },
  { lengthScale: 0.42, alphaScale: 0.22 },
  { lengthScale: 0.18, alphaScale: 0.18 },
];

// ---------------------------------------------------------------------------
// §10.4 Power
// ---------------------------------------------------------------------------

/** §4.1 — power runs from 0 to this. */
export const POWER_MAX = 100;

/** §2.2 — power a run starts with. */
export const POWER_START = 100;

/** §4.1 — power per second spent in NARROWING and FOCUSED. Spike parameter. */
export const POWER_DRAIN_RATE = 26;

/** §4.1 — power per second regained in WIDENING and WIDE. Spike parameter. */
export const POWER_RECHARGE_RATE = 17;

/**
 * §4.2 — after power hits zero, focus is ignored until power recovers to here.
 * Without the threshold a player holding focus at zero gets one frame of focus
 * per frame of recharge: a flickering beam that burns nothing and looks broken.
 */
export const POWER_FOCUS_REARM = 20;

// ---------------------------------------------------------------------------
// §10.5 Crawler
// ---------------------------------------------------------------------------

/** §5.1 — draw and contact radius. */
export const CRAWLER_RADIUS = 9;

/** §5.4 — speed before the run-time ramp and the per-crawler jitter. */
export const CRAWLER_SPEED_BASE = 52;

/**
 * §5.4 — ceiling on the ramped speed, applied before the §6.3 jitter.
 *
 * JOINT BOUND with `CRAWLER_SPEED_JITTER` (§10.5, derived in §11.2):
 *
 *     CRAWLER_SPEED_MAX * (1 + CRAWLER_SPEED_JITTER) <= 156 px/s
 *
 * 156 = 234 / 1.5, where 234 px is the shortest possible approach and 1.5 s is
 * the readability floor in `docs/vision.md` §6 criterion 4. The two values are
 * each individually safe inside their own ranges but jointly reachable past the
 * bound, so check the product, not the rows. At these values: 88 * 1.12 = 98.6.
 */
export const CRAWLER_SPEED_MAX = 88;

/** §5.4 — linear ramp, as a fraction of base speed added per second survived. */
export const CRAWLER_SPEED_RAMP_PER_SECOND = 0.0035;

/** §6.3 — per-crawler speed multiplier is drawn uniformly from 1 +/- this. */
export const CRAWLER_SPEED_JITTER = 0.12;

export const CRAWLER_COLOR = 0x8a93a8;
/** §5.2 — the frozen tell. */
export const CRAWLER_FROZEN_COLOR = 0x9fd4ff;
/** §5.2 — the burn-progress tell; a crawler shifts toward it as dwell builds. */
export const CRAWLER_BURN_COLOR = 0xffb066;

// ---------------------------------------------------------------------------
// §10.6 Freeze and burn
// ---------------------------------------------------------------------------

/** §5.2 — seconds in the focused cone needed to banish a crawler. Spike parameter. */
export const BURN_DWELL_TIME = 0.45;

/**
 * §5.2 — dwell lost per second when a crawler is not being burned, as a multiple
 * of the rate it is gained at. Above 1.0 a wobble off-target costs more than it
 * gained, so sloppy aim is still punished without a single jittery frame erasing
 * four-tenths of a second of correct play.
 */
export const BURN_DECAY_MULTIPLIER = 1.5;

// ---------------------------------------------------------------------------
// §10.7 Spawning
// ---------------------------------------------------------------------------

/** §5.4 — seconds between spawns at t = 0. */
export const SPAWN_INTERVAL_START = 4.0;

/** §5.4 — floor on the spawn interval. A safety stop, not a balance value. */
export const SPAWN_INTERVAL_MIN = 0.85;

/**
 * §5.4 — the spawn interval is multiplied by this per second survived. The most
 * sensitive value in the table: it sets both difficulty crossings at once, and
 * §11.1's run-length table must be re-derived before it is changed.
 */
export const SPAWN_INTERVAL_DECAY_PER_SECOND = 0.996;

/** The four edges a crawler can enter from. */
export type SpawnEdge = 'top' | 'bottom' | 'left' | 'right';

/** Iteration order for the weighted draw in §6.2. */
export const SPAWN_EDGES: readonly SpawnEdge[] = ['top', 'bottom', 'left', 'right'];

/**
 * §6.2 — must sum to 1. Deliberately not uniform by perimeter: the long axis
 * carries more weight because it is the axis the wide beam cannot reach at
 * spawn, so it is the approach that forces the width decision.
 */
export const SPAWN_EDGE_WEIGHTS: Readonly<Record<SpawnEdge, number>> = {
  top: 0.2,
  bottom: 0.2,
  left: 0.3,
  right: 0.3,
};

/** §6.3 — px excluded at each end of an edge. Corner spawns are unreadable. */
export const SPAWN_CORNER_INSET = 40;

/** §6.3 — anti-clustering: minimum bearing separation from a living crawler. */
export const SPAWN_MIN_SEPARATION_DEG = 25;
export const SPAWN_MIN_SEPARATION_RAD = degToRad(SPAWN_MIN_SEPARATION_DEG);

/** §6.3 — re-roll budget before a clustered candidate is accepted anyway. */
export const SPAWN_PLACEMENT_ATTEMPTS = 6;

/**
 * §5.3 — hard cap on concurrent crawlers. A spawn at the cap is dropped, not
 * queued. This is a performance rail, not a balance lever (§11.4).
 */
export const MAX_CRAWLERS = 16;

// ---------------------------------------------------------------------------
// §10.8 Score
// ---------------------------------------------------------------------------

/**
 * §8 — `score(t) = floor(t * SCORE_PER_SECOND_SURVIVED) + banished * SCORE_PER_BANISH`.
 *
 * Retune the two only against each other, and re-derive the crossover: the ratio
 * puts patience ahead of aggression until the spawn rate reaches
 * `SCORE_PER_SECOND_SURVIVED / SCORE_PER_BANISH` spawns per second, which §11.1
 * places at about t = 120 s.
 */
export const SCORE_PER_SECOND_SURVIVED = 10;
export const SCORE_PER_BANISH = 25;

/** §8 — changing this orphans every existing best score. */
export const SCORE_STORAGE_KEY = 'lamplight-vigil.best-score';

// ---------------------------------------------------------------------------
// §10.9 Input
// ---------------------------------------------------------------------------
//
// Bindings live here so that the input handler and the on-screen prompt read the
// same source. A prompt that disagrees with the binding is hidden state under
// pillar 2.

/** §7 — hold to narrow the beam. Phaser key name. */
export const INPUT_FOCUS_KEY = 'SHIFT';

/** §7 — whether the left mouse button is an alternate focus binding. */
export const INPUT_FOCUS_POINTER = true;

/** §7 — restarts from GAME_OVER. Phaser key name. */
export const INPUT_RESTART_KEY = 'R';

// ---------------------------------------------------------------------------
// Game feel — GAM-12
// ---------------------------------------------------------------------------
//
// `docs/design.md` §10 has no subsection for these yet: the feel pass is concept
// §8 row 5 and it post-dates the tuning table, which §13 leaves open on the audio
// set. They live here under the same rule as every other number in this file —
// `docs/vision.md` §6 criterion 9 — so a designer can retune glow, shake,
// duration and volume without opening a gameplay module. Proposing a §10.10 row
// for each is `game-designer`'s call, not this task's.
//
// Nothing below changes a rule. Every value here is feedback on a mechanic that
// already exists: no value in this section may alter what the beam freezes, what
// it burns, when a run ends or what anything scores.

// --- Beam glow -------------------------------------------------------------

/**
 * The cone's outer halo: slices wider and shorter or longer than the beam
 * itself, drawn beneath the cone layers in the same Graphics so the glow costs
 * no extra draw object and is rebuilt only when the width parameter moves.
 *
 * HARD CONSTRAINT: every `alphaScale` here must stay well below the smallest
 * `alphaScale` in `BEAM_CONE_LAYERS`. The halo bleeds outside the cone, and the
 * cone edge is exactly where freezing starts and stops (§3.2). A halo bright
 * enough to be mistaken for the beam would be a pillar 2 failure — it would show
 * the player light that holds nothing.
 */
export interface BeamHaloLayer {
  /** Multiplier on the beam's current half-angle. Above 1 by definition. */
  readonly angleScale: number;
  /** Fraction of the beam's current reach this layer covers. */
  readonly lengthScale: number;
  /** Share of the beam's current fill alpha this layer contributes. */
  readonly alphaScale: number;
}

export const BEAM_HALO_LAYERS: readonly BeamHaloLayer[] = [
  { angleScale: 1.4, lengthScale: 0.86, alphaScale: 0.09 },
  { angleScale: 1.16, lengthScale: 1.06, alphaScale: 0.13 },
];

/**
 * The bloom at the beam's mouth: one radial-gradient texture, baked once at boot
 * exactly like the lamp halo, whose alpha and scale interpolate on the width
 * parameter. Focusing pulls the light into a smaller, brighter source; widening
 * spreads it back out. Masks and alpha only — no shader, no Light2D
 * (`docs/concept.md` §7).
 */
export const BEAM_GLOW_TEXTURE_KEY = 'beam-glow';
export const BEAM_GLOW_TEXTURE_RADIUS = 110;
export const BEAM_GLOW_COLOR = 0xffe6b8;
export const BEAM_GLOW_MID_STOP = 0.3;
export const BEAM_GLOW_MID_ALPHA_SCALE = 0.4;

/** Alpha of the bloom when fully wide and when fully focused. */
export const BEAM_GLOW_ALPHA_WIDE = 0.2;
export const BEAM_GLOW_ALPHA_FOCUS = 0.46;

/** Scale of the baked bloom when fully wide and when fully focused. */
export const BEAM_GLOW_SCALE_WIDE = 1.0;
export const BEAM_GLOW_SCALE_FOCUS = 0.6;

// --- Freeze feedback -------------------------------------------------------

/**
 * A ring around a crawler for as long as the light holds it. Colour and
 * body-tint already say "frozen"; the ring is the silhouette change that makes
 * it unmistakable at a glance, and it appears and vanishes on exactly the frames
 * the freeze does (§5.2 — no grace, no easing).
 */
export const CRAWLER_FROST_RING_SCALE = 1.55;
export const CRAWLER_FROST_RING_WIDTH = 2;
export const CRAWLER_FROST_RING_ALPHA = 0.85;

/**
 * The catch: a ring that snaps out and fades on the frame a crawler first
 * becomes lit. Seconds. Purely cosmetic — it decays on its own clock and never
 * gates, delays or extends the freeze itself.
 */
export const FREEZE_FLASH_TIME = 0.18;
export const FREEZE_FLASH_SCALE_START = 1.6;
export const FREEZE_FLASH_SCALE_END = 3.2;
export const FREEZE_FLASH_WIDTH = 2;
export const FREEZE_FLASH_ALPHA = 0.75;

// --- Burn feedback ---------------------------------------------------------

/**
 * Burn dwell as an arc sweeping a full turn around the crawler. §5.2 requires
 * partial dwell to be visible; the body tint shows that it is burning and the
 * arc shows how far along it is, which is the part a player times a commitment
 * against.
 */
export const BURN_ARC_RADIUS_SCALE = 1.9;
export const BURN_ARC_WIDTH = 3;
export const BURN_ARC_ALPHA = 0.9;
/** Twelve o'clock, so a part-filled arc is read the same way every time. */
export const BURN_ARC_START_DEG = -90;
export const BURN_ARC_START_RAD = degToRad(BURN_ARC_START_DEG);

/** The banish confirmation: a ring that expands off the crawler and fades. */
export const BANISH_BURST_TIME = 0.3;
export const BANISH_BURST_SCALE_START = 1.0;
export const BANISH_BURST_SCALE_END = 4.2;
export const BANISH_BURST_WIDTH = 3;
export const BANISH_BURST_ALPHA = 0.9;
export const BANISH_BURST_COLOR = 0xffb066;

/** The lamp-hit confirmation, at the point of contact. */
export const LAMP_HIT_BURST_TIME = 0.55;
export const LAMP_HIT_BURST_SCALE_START = 1.0;
export const LAMP_HIT_BURST_SCALE_END = 6.0;
export const LAMP_HIT_BURST_WIDTH = 4;
export const LAMP_HIT_BURST_ALPHA = 1.0;
export const LAMP_HIT_BURST_COLOR = 0xff8c5a;

/**
 * Live bursts at once. A rail, not a balance lever: a burst past the cap is
 * dropped rather than queued, for the same reason a spawn at `MAX_CRAWLERS` is
 * (§5.3). Two per crawler at the cap is already far more than can co-exist.
 */
export const FEEDBACK_BURST_MAX = 32;

// --- Screen shake ----------------------------------------------------------

/**
 * One shake, on a lamp hit, and nothing else. Phaser's intensity is a fraction
 * of the viewport, so 0.012 is about 11 px of travel at 960 wide.
 *
 * It runs during GAME_OVER on purpose. §2.3 freezes the *world* — no crawler
 * moves, no time accrues — and the camera is not the world: every crawler stays
 * exactly where it died, which is what criterion 6 needs. The shake is also
 * cancelled outright on restart, so a run never opens mid-shake.
 */
export const SHAKE_LAMP_HIT_DURATION_MS = 280;
export const SHAKE_LAMP_HIT_INTENSITY = 0.012;

// --- Sound -----------------------------------------------------------------
//
// Three cues, and they are the three `docs/design.md` §13 names as worth
// confirming: the freeze, the burn, the lamp hit. Every one of them confirms
// something already on screen — the frost ring, the banish burst, the game-over
// state — so muting the tab hides nothing a player needs in order to act
// (`docs/vision.md` pillar 2). No cue carries information of its own, and none
// is the only evidence of anything.
//
// The waveforms are synthesised from these numbers at boot (src/scenes/
// soundSynth.ts). There is no audio file in the repository.

/** Scales every cue. Set to 0 to mute the game without touching gameplay. */
export const AUDIO_MASTER_VOLUME = 0.5;

/** One cue's waveform: a glide from start to end frequency under a decay. */
export interface ToneSpec {
  readonly durationSeconds: number;
  readonly startFrequency: number;
  readonly endFrequency: number;
  /** 0 is a pure tone, 1 is pure noise. */
  readonly noiseMix: number;
  /** Seconds of fade-in. Non-zero, or the cue starts on a click. */
  readonly attackSeconds: number;
  /** Peak sample amplitude, before the cue's volume. */
  readonly peakAmplitude: number;
  /** Decay exponent. Higher is snappier. */
  readonly decayExponent: number;
}

/** A crawler was caught by the light. Short, bright, rising. */
export const SOUND_FREEZE: ToneSpec = {
  durationSeconds: 0.09,
  startFrequency: 1320,
  endFrequency: 1760,
  noiseMix: 0.12,
  attackSeconds: 0.004,
  peakAmplitude: 0.5,
  decayExponent: 3.2,
};
export const SOUND_FREEZE_VOLUME = 0.35;

/**
 * A wide sweep can catch a dozen crawlers on one frame. Without a floor on the
 * gap between freeze cues that is a dozen simultaneous blips, which reads as a
 * glitch rather than a confirmation. Seconds.
 */
export const SOUND_FREEZE_MIN_INTERVAL = 0.07;

/** A crawler finished its dwell and was banished. Falling, with a little body. */
export const SOUND_BANISH: ToneSpec = {
  durationSeconds: 0.26,
  startFrequency: 620,
  endFrequency: 160,
  noiseMix: 0.35,
  attackSeconds: 0.006,
  peakAmplitude: 0.6,
  decayExponent: 2.0,
};
export const SOUND_BANISH_VOLUME = 0.55;

/** A crawler reached the lamp. Low and final. */
export const SOUND_LAMP_HIT: ToneSpec = {
  durationSeconds: 0.45,
  startFrequency: 180,
  endFrequency: 55,
  noiseMix: 0.22,
  attackSeconds: 0.004,
  peakAmplitude: 0.9,
  decayExponent: 1.5,
};
export const SOUND_LAMP_HIT_VOLUME = 0.8;

// --- Restart ---------------------------------------------------------------

/**
 * `docs/vision.md` §6 criterion 1 and `docs/design.md` §12 criterion 8: one
 * keypress from the game-over screen to the first playable frame, in at most
 * this many seconds, measured from the moment of death.
 *
 * This is the budget the game is held to, not a tunable: it is here so that
 * `restartClock.ts` and its test read the same number as the criterion, and so
 * that raising `GAME_OVER_INPUT_LOCKOUT` past what the budget allows fails a
 * test instead of shipping.
 */
export const RESTART_BUDGET_SECONDS = 1.0;

/**
 * Frames the restart path is allowed to spend after the lockout expires: one to
 * notice the buffered press, one to present the rebuilt world. Used only by the
 * worst-case arithmetic in `restartClock.ts`.
 */
export const RESTART_BUDGET_FRAMES = 2;
