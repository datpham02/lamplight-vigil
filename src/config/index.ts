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
export const LAMP_GLOW_DEPTH = 20;
export const LAMP_DEPTH = 30;
export const CRAWLER_DEPTH = 40;

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
 * arena. Tinted with `BEAM_COLOR` rather than a colour of its own.
 *
 * FINALISED by `ui-designer` in the HUD-and-screens task, and kept at the
 * seeded value. The wash lifts the unlit hollow from `#06070b` to about
 * `#1a1919`, which leaves an unlit crawler (`CRAWLER_COLOR`, `#8a93a8`) at a
 * contrast ratio of roughly 5.4:1 against it — above the 4.5:1 line, so a
 * crawler outside the cone is still a readable silhouette rather than a shape
 * the player only finds by sweeping the beam over it. Raising the floor makes
 * the hollow lighter and that ratio *worse*, which is why this is a floor and
 * not a brightness dial: 0.14, the top of the safe range, drops it to about
 * 3.6:1 and starts hiding the crawlers it was meant to reveal.
 *
 * The rest of the §9 mitigation is in `src/hud`: readouts sit in the four
 * corners, which is the only screen real estate crawlers walk away from rather
 * than into, and every HUD string carries an ink shadow so it survives the
 * beam sweeping under it.
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
// HUD — palette, typography and layout (`ui-designer`)
// ---------------------------------------------------------------------------
//
// No row of `docs/design.md` §10 covers the readouts, so this section is the
// tuning table for them: every colour, size, position and duration `src/hud`
// uses is named here, and `src/hud` holds no number of its own. User-facing
// copy is not a tuning value and lives in `src/hud/strings.ts`, composed from
// the §10.9 bindings above so a prompt can never disagree with the key it
// names.
//
// Coordinates are in the fixed 960x540 render space. The canvas is scaled to
// the window with `Phaser.Scale.FIT`, so the layout is identical at every
// window size and only ever letterboxes (`docs/vision.md` §6 criterion 7); it
// is `src/hud/layout.ts` and its test that keep every box inside the frame.

/** Phaser integer colours are `0xRRGGBB`; Phaser text styles want CSS strings. */
const cssColor = (value: number): string => `#${value.toString(16).padStart(6, '0')}`;

/**
 * The dark three-colour palette (`docs/concept.md` §8 row 4). The HUD does not
 * introduce a fourth hue: it aliases the colours the world is already drawn in,
 * so a readout means the same thing as the thing it describes.
 *
 * - INK — the hollow. The integer twin of `BACKGROUND_COLOR`.
 * - LAMPLIGHT — the player's light. Power you still have, and your score.
 * - EMBER — the burn. Power leaving the meter, and the word for what the
 *   focused beam is doing.
 * - HOLLOW — the crawlers. Labels, secondary figures, and anything cold.
 * - FROST — a frozen crawler. Used once, to mark what killed you.
 */
export const HUD_INK = 0x06070b;
export const HUD_LAMPLIGHT = BEAM_COLOR;
export const HUD_EMBER = CRAWLER_BURN_COLOR;
export const HUD_HOLLOW = CRAWLER_COLOR;
export const HUD_FROST = CRAWLER_FROZEN_COLOR;

export const HUD_TEXT_PRIMARY = cssColor(HUD_LAMPLIGHT);
export const HUD_TEXT_DIM = cssColor(HUD_HOLLOW);
export const HUD_TEXT_WARN = cssColor(HUD_EMBER);
export const HUD_TEXT_SHADOW_COLOR = cssColor(HUD_INK);

/**
 * System font stacks. Nothing is downloaded or bundled: naming families the
 * browser already has keeps the repository free of font files, which `AGENTS.md`
 * would otherwise require a licence record for.
 *
 * Figures use the mono stack because the timer reruns ten times a second and
 * the score changes every frame; proportional digits make a right-aligned
 * readout twitch sideways, which is the opposite of readable at a glance.
 */
export const HUD_FONT_FAMILY =
  'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const HUD_FONT_FAMILY_MONO =
  'ui-monospace, "Cascadia Mono", "Segoe UI Mono", Menlo, Consolas, monospace';

/** Type sizes, px in render space. At the 640x360 floor these scale by 2/3. */
export const HUD_LABEL_SIZE = 15;
export const HUD_VALUE_SIZE = 22;
export const HUD_SCORE_SIZE = 34;
export const HUD_STATUS_SIZE = 15;
export const HUD_NOTE_SIZE = 14;

/** Labels are tracked out so a small uppercase word still reads as a label. */
export const HUD_LABEL_TRACKING = 1.6;

/**
 * Height of one line of text as a multiple of its size. Phaser measures the
 * real thing at runtime; this is the budget `src/hud/layout.ts` reserves when
 * it proves nothing clips or overlaps, and it is deliberately generous.
 */
export const HUD_LINE_HEIGHT_RATIO = 1.35;

/**
 * Every HUD string carries an ink shadow. The beam sweeps under the readouts
 * and a 0.34-alpha cone behind unshadowed text is the readability failure in
 * `docs/concept.md` §9 happening to the HUD itself.
 */
export const HUD_TEXT_SHADOW_OFFSET = 2;
export const HUD_TEXT_SHADOW_BLUR = 6;

/**
 * Draw order, above every world depth in §10.1. An overlay sits above the play
 * readouts because its scrim covers them; within one overlay, order is the
 * order its container holds its children in.
 */
export const HUD_DEPTH = 100;
export const OVERLAY_DEPTH = 110;

/**
 * The frame the readouts live inside. Nothing is drawn outside it, which is
 * what makes the layout safe at every window size once FIT has scaled it.
 */
export const HUD_MARGIN_X = 26;
export const HUD_MARGIN_Y = 22;
export const HUD_LEFT_X = HUD_MARGIN_X;
export const HUD_RIGHT_X = RENDER_WIDTH - HUD_MARGIN_X;
export const HUD_TOP_Y = HUD_MARGIN_Y;

/**
 * Width budget for one corner cluster. `src/hud/layout.ts` proves the four
 * clusters fit inside the margins without overlapping at this width, and
 * `PlayHud` warns in dev if a string it builds ever exceeds it.
 */
export const HUD_CLUSTER_MAX_WIDTH = 300;

/** Separator every three digits, so a five-figure score stays countable. */
export const HUD_DIGIT_GROUP_SEPARATOR = ' ';

// --- Top-left cluster: the power meter -------------------------------------

export const HUD_POWER_LABEL_Y = HUD_TOP_Y;
export const HUD_POWER_METER_Y = 48;
export const HUD_POWER_STATUS_Y = 68;

export const HUD_POWER_METER_WIDTH = 236;
export const HUD_POWER_METER_HEIGHT = 14;
export const HUD_POWER_METER_CORNER_RADIUS = 3;

export const HUD_POWER_TRACK_ALPHA = 0.22;
export const HUD_POWER_BORDER_ALPHA = 0.55;
export const HUD_POWER_BORDER_WIDTH = 1;

/**
 * Fill colour by what the power is doing, so the meter answers "can I burn?"
 * before the player has read a digit: lamplight while it is banked, ember while
 * it is being spent, hollow while §4.2 has focus locked out.
 */
export const HUD_POWER_FILL_COLOR = HUD_LAMPLIGHT;
export const HUD_POWER_DRAIN_COLOR = HUD_EMBER;
export const HUD_POWER_LOCKED_COLOR = HUD_HOLLOW;

/**
 * §4.2 requires the rearm threshold itself to be on screen, not just the power
 * level. It is a tick across the track at `POWER_FOCUS_REARM`, overhanging top
 * and bottom so it still reads when the fill has passed it.
 */
export const HUD_POWER_REARM_TICK_WIDTH = 2;
export const HUD_POWER_REARM_TICK_OVERHANG = 4;
export const HUD_POWER_REARM_TICK_COLOR = HUD_FROST;
export const HUD_POWER_REARM_TICK_ALPHA = 0.85;

// --- Top-right cluster: score and best -------------------------------------

export const HUD_SCORE_LABEL_Y = HUD_TOP_Y;
export const HUD_SCORE_VALUE_Y = 44;
export const HUD_BEST_Y = 94;

// --- Bottom-left cluster: time survived ------------------------------------

/**
 * The two bottom clusters share these rows so their labels and figures sit on
 * the same baselines across the foot of the frame.
 */
export const HUD_TIME_LABEL_Y = 424;
export const HUD_TIME_VALUE_Y = 446;

// --- Bottom-right cluster: banishments, and the spawn clock ----------------

export const HUD_BANISHED_LABEL_Y = 424;
export const HUD_BANISHED_VALUE_Y = 446;

/**
 * The spawn clock, in two lines under the banishment count.
 *
 * `HUD_NEXT_SPAWN_Y` is the countdown `src/enemies` is actually holding — the
 * timer pillar 2 forbids hiding, and the one the player acts on, because it is
 * what says whether there is time to hold a burn. `HUD_SURGE_Y` is the §5.4
 * interval that countdown is reset to, which is the difficulty ramp rather than
 * a clock. Both are state the game holds, so both are printed; they are
 * separate rows because they answer different questions.
 */
export const HUD_NEXT_SPAWN_Y = 478;
export const HUD_NEXT_SPAWN_DECIMALS = 1;
export const HUD_SURGE_Y = 498;
export const HUD_SURGE_DECIMALS = 1;

// --- Title screen -----------------------------------------------------------

/**
 * Heavier than the game-over scrim: there is nothing behind the title worth
 * reading except the lamp, and the control summary has to win (`docs/vision.md`
 * §6 criterion 5 is decided on this screen).
 */
export const TITLE_SCRIM_ALPHA = 0.72;

export const TITLE_HEADING_Y = 62;
export const TITLE_HEADING_SIZE = 52;
export const TITLE_HEADING_TRACKING = 4;
export const TITLE_TAGLINE_Y = 140;
export const TITLE_TAGLINE_SIZE = 18;

/** The control summary is a two-column table: keys right, what they do left. */
export const TITLE_CONTROLS_TOP_Y = 182;
export const TITLE_CONTROLS_ROW_GAP = 32;
export const TITLE_CONTROLS_SIZE = 17;
export const TITLE_CONTROLS_KEY_RIGHT_X = 462;
export const TITLE_CONTROLS_TEXT_LEFT_X = 498;

export const TITLE_BEST_Y = 348;
export const TITLE_BEST_SIZE = 22;
export const TITLE_PROMPT_Y = 402;
export const TITLE_PROMPT_SIZE = 24;
export const TITLE_FOOTNOTE_Y = 466;
export const TITLE_FOOTNOTE_SIZE = 14;

// --- Game-over overlay ------------------------------------------------------

/**
 * Light enough that the frozen hollow still reads through it. `docs/design.md`
 * §2.3 keeps the crawler that killed the player rendered exactly where it was,
 * and `docs/vision.md` §6 criterion 6 is decided by whether they can see it.
 */
export const GAME_OVER_SCRIM_ALPHA = 0.45;

/**
 * No overlay text comes within this of the lamp centre. The killer is touching
 * the lamp, inside `LAMP_RADIUS + CRAWLER_RADIUS` of it, so the figures sit
 * above and below a clear disc rather than over the evidence.
 */
export const GAME_OVER_CLEAR_RADIUS = 120;

export const GAME_OVER_HEADING_Y = 26;
export const GAME_OVER_HEADING_SIZE = 26;
export const GAME_OVER_HEADING_TRACKING = 3;
export const GAME_OVER_SCORE_LABEL_Y = 64;
export const GAME_OVER_SCORE_VALUE_Y = 86;
export const GAME_OVER_SCORE_SIZE = 46;
export const GAME_OVER_STATS_Y = 396;
export const GAME_OVER_STATS_SIZE = 18;
export const GAME_OVER_BEST_Y = 430;
export const GAME_OVER_BEST_SIZE = 20;
export const GAME_OVER_PROMPT_Y = 476;
export const GAME_OVER_PROMPT_SIZE = 22;

/**
 * A thin ring left where the crawler reached the lamp. It is drawn on the frame
 * the run ends, with no tween and no animation — `docs/vision.md` pillar 3
 * forbids anything between the lose state and the next playable frame, and this
 * is a mark, not a death animation. It exists so the answer to "what killed me"
 * is pointed at rather than searched for.
 */
export const GAME_OVER_MARK_RADIUS = 26;
export const GAME_OVER_MARK_LINE_WIDTH = 2;
export const GAME_OVER_MARK_COLOR = HUD_FROST;
export const GAME_OVER_MARK_ALPHA = 0.9;
