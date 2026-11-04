// src/hud owns the on-screen readouts. This file is the part of them that is
// arithmetic rather than Phaser: where each readout sits, how wide the power
// fill is, and how a number is written out.
//
// It imports no Phaser, so `layout.test.ts` can check the whole layout at a
// node prompt. That is how `docs/vision.md` §6 criterion 7 is held: the game
// renders at a fixed 960x540 and `Phaser.Scale.FIT` letterboxes it, so a layout
// proved to fit inside 960x540 fits at 640x360 and at 2560x1440 by the same
// proof. The failure mode criterion 7 is really about — a readout placed off
// the edge of the render target, or two clusters written over each other — is
// the thing these boxes exist to rule out.
//
// Every number used here comes from `src/config`.

import {
  GAME_OVER_BEST_SIZE,
  GAME_OVER_BEST_Y,
  GAME_OVER_CLEAR_RADIUS,
  GAME_OVER_HEADING_SIZE,
  GAME_OVER_HEADING_Y,
  GAME_OVER_PROMPT_SIZE,
  GAME_OVER_PROMPT_Y,
  GAME_OVER_SCORE_LABEL_Y,
  GAME_OVER_SCORE_SIZE,
  GAME_OVER_SCORE_VALUE_Y,
  GAME_OVER_STATS_SIZE,
  GAME_OVER_STATS_Y,
  HUD_BANISHED_LABEL_Y,
  HUD_BANISHED_VALUE_Y,
  HUD_BEST_Y,
  HUD_CLUSTER_MAX_WIDTH,
  HUD_DIGIT_GROUP_SEPARATOR,
  HUD_LABEL_SIZE,
  HUD_LEFT_X,
  HUD_LINE_HEIGHT_RATIO,
  HUD_NOTE_SIZE,
  HUD_POWER_LABEL_Y,
  HUD_POWER_METER_HEIGHT,
  HUD_POWER_METER_WIDTH,
  HUD_POWER_METER_Y,
  HUD_POWER_REARM_TICK_OVERHANG,
  HUD_POWER_STATUS_Y,
  HUD_RIGHT_X,
  HUD_SCORE_LABEL_Y,
  HUD_SCORE_SIZE,
  HUD_SCORE_VALUE_Y,
  HUD_STATUS_SIZE,
  HUD_SURGE_Y,
  HUD_TIME_LABEL_Y,
  HUD_TIME_VALUE_Y,
  HUD_VALUE_SIZE,
  LAMP_Y,
  TITLE_BEST_SIZE,
  TITLE_BEST_Y,
  TITLE_CONTROLS_ROW_GAP,
  TITLE_CONTROLS_SIZE,
  TITLE_CONTROLS_TOP_Y,
  TITLE_FOOTNOTE_SIZE,
  TITLE_FOOTNOTE_Y,
  TITLE_HEADING_SIZE,
  TITLE_HEADING_Y,
  TITLE_PROMPT_SIZE,
  TITLE_PROMPT_Y,
  TITLE_TAGLINE_SIZE,
  TITLE_TAGLINE_Y,
} from '../config/index';

// ---------------------------------------------------------------------------
// Units — not tunables
// ---------------------------------------------------------------------------

/** The run timer is shown to a tenth. */
const TENTHS_PER_SECOND = 10;
const SECONDS_PER_MINUTE = 60;
const TENTHS_PER_MINUTE = TENTHS_PER_SECOND * SECONDS_PER_MINUTE;

/** Digits per group in a written-out figure. */
const DIGITS_PER_GROUP = 3;

/** Width of the seconds field in the run timer, so `0:07.4` does not shuffle. */
const SECONDS_FIELD_WIDTH = 2;

// ---------------------------------------------------------------------------
// Writing numbers out
// ---------------------------------------------------------------------------

/**
 * `m:ss.t`. Minutes are not padded, so a run reads `0:42.8` and then `1:03.1`
 * and the figure only ever grows.
 *
 * Truncates rather than rounds: a timer that shows `1:00.0` while the run is
 * still at 59.97 s has told the player something the game does not think.
 */
export function formatRunTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const totalTenths = Math.floor(safe * TENTHS_PER_SECOND);

  const minutes = Math.floor(totalTenths / TENTHS_PER_MINUTE);
  const wholeSeconds = Math.floor(totalTenths / TENTHS_PER_SECOND) % SECONDS_PER_MINUTE;
  const tenths = totalTenths % TENTHS_PER_SECOND;

  return `${minutes}:${String(wholeSeconds).padStart(SECONDS_FIELD_WIDTH, '0')}.${tenths}`;
}

/**
 * A whole number, grouped every three digits. A five-figure score is the one a
 * player most wants to read at a glance and the one `12345` serves worst.
 */
export function formatCount(value: number): string {
  const safe = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  const digits = String(safe);

  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % DIGITS_PER_GROUP === 0) {
      out += HUD_DIGIT_GROUP_SEPARATOR;
    }
    out += digits.charAt(i);
  }

  return out;
}

/** Seconds to a fixed number of places, for the spawn-ramp readout. */
export function formatSeconds(seconds: number, places: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return safe.toFixed(places);
}

// ---------------------------------------------------------------------------
// The power meter
// ---------------------------------------------------------------------------

/**
 * Width of the filled part of the track, in px.
 *
 * Clamped at both ends: power is integrated from frame deltas, so it can land
 * a hair outside 0..max, and a fill wider than its track or narrower than zero
 * is a rendering bug rather than a reading the player should ever see.
 */
export function powerFillWidth(power: number, max: number): number {
  if (!Number.isFinite(power) || !Number.isFinite(max) || max <= 0) {
    return 0;
  }

  const fraction = Math.min(1, Math.max(0, power / max));
  return HUD_POWER_METER_WIDTH * fraction;
}

/**
 * Where a marked level sits along the track, in px from the screen's left edge.
 * Used for the §4.2 rearm tick, which pillar 2 requires on screen.
 */
export function powerMarkX(level: number, max: number): number {
  return HUD_LEFT_X + powerFillWidth(level, max);
}

// ---------------------------------------------------------------------------
// The box model the layout is proved against
// ---------------------------------------------------------------------------

/** An axis-aligned area of the 960x540 render space, with a name for the test. */
export interface HudBox {
  readonly name: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Which corner a play-HUD cluster hangs off. */
export type HudCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const lineHeight = (fontSize: number): number => fontSize * HUD_LINE_HEIGHT_RATIO;

/**
 * A line of text anchored to a corner. Horizontally it is budgeted at the full
 * cluster width whichever way it is aligned, because the budget is what the
 * non-overlap proof is about and what `PlayHud` checks its strings against.
 */
function cornerLine(name: string, corner: HudCorner, top: number, fontSize: number): HudBox {
  const onLeft = corner === 'top-left' || corner === 'bottom-left';
  const left = onLeft ? HUD_LEFT_X : HUD_RIGHT_X - HUD_CLUSTER_MAX_WIDTH;

  return {
    name,
    left,
    top,
    right: left + HUD_CLUSTER_MAX_WIDTH,
    bottom: top + lineHeight(fontSize),
  };
}

/** A full-width centred row on one of the overlays. */
function overlayRow(name: string, top: number, fontSize: number): HudBox {
  return { name, left: HUD_LEFT_X, top, right: HUD_RIGHT_X, bottom: top + lineHeight(fontSize) };
}

/** Which corner each play-HUD box belongs to, for the non-overlap proof. */
export interface CornerBox {
  readonly corner: HudCorner;
  readonly box: HudBox;
}

/**
 * Every readout drawn during PLAYING. The power meter contributes the track
 * itself rather than a line of text, grown by the rearm tick's overhang.
 */
export const PLAY_HUD_BOXES: readonly CornerBox[] = [
  { corner: 'top-left', box: cornerLine('power label', 'top-left', HUD_POWER_LABEL_Y, HUD_LABEL_SIZE) },
  {
    corner: 'top-left',
    box: {
      name: 'power meter',
      left: HUD_LEFT_X,
      top: HUD_POWER_METER_Y - HUD_POWER_REARM_TICK_OVERHANG,
      right: HUD_LEFT_X + HUD_POWER_METER_WIDTH,
      bottom: HUD_POWER_METER_Y + HUD_POWER_METER_HEIGHT + HUD_POWER_REARM_TICK_OVERHANG,
    },
  },
  { corner: 'top-left', box: cornerLine('power status', 'top-left', HUD_POWER_STATUS_Y, HUD_STATUS_SIZE) },

  { corner: 'top-right', box: cornerLine('score label', 'top-right', HUD_SCORE_LABEL_Y, HUD_LABEL_SIZE) },
  { corner: 'top-right', box: cornerLine('score value', 'top-right', HUD_SCORE_VALUE_Y, HUD_SCORE_SIZE) },
  { corner: 'top-right', box: cornerLine('best score', 'top-right', HUD_BEST_Y, HUD_LABEL_SIZE) },

  { corner: 'bottom-left', box: cornerLine('time label', 'bottom-left', HUD_TIME_LABEL_Y, HUD_LABEL_SIZE) },
  { corner: 'bottom-left', box: cornerLine('time value', 'bottom-left', HUD_TIME_VALUE_Y, HUD_VALUE_SIZE) },

  {
    corner: 'bottom-right',
    box: cornerLine('banished label', 'bottom-right', HUD_BANISHED_LABEL_Y, HUD_LABEL_SIZE),
  },
  {
    corner: 'bottom-right',
    box: cornerLine('banished value', 'bottom-right', HUD_BANISHED_VALUE_Y, HUD_VALUE_SIZE),
  },
  { corner: 'bottom-right', box: cornerLine('spawn ramp', 'bottom-right', HUD_SURGE_Y, HUD_NOTE_SIZE) },
];

/** Every row of the title screen, top to bottom. */
export const TITLE_BOXES: readonly HudBox[] = [
  overlayRow('title heading', TITLE_HEADING_Y, TITLE_HEADING_SIZE),
  overlayRow('title tagline', TITLE_TAGLINE_Y, TITLE_TAGLINE_SIZE),
  overlayRow('control row 1', TITLE_CONTROLS_TOP_Y, TITLE_CONTROLS_SIZE),
  overlayRow('control row 2', TITLE_CONTROLS_TOP_Y + TITLE_CONTROLS_ROW_GAP, TITLE_CONTROLS_SIZE),
  overlayRow('control row 3', TITLE_CONTROLS_TOP_Y + TITLE_CONTROLS_ROW_GAP * 2, TITLE_CONTROLS_SIZE),
  overlayRow('control row 4', TITLE_CONTROLS_TOP_Y + TITLE_CONTROLS_ROW_GAP * 3, TITLE_CONTROLS_SIZE),
  overlayRow('title best score', TITLE_BEST_Y, TITLE_BEST_SIZE),
  overlayRow('title prompt', TITLE_PROMPT_Y, TITLE_PROMPT_SIZE),
  overlayRow('title footnote', TITLE_FOOTNOTE_Y, TITLE_FOOTNOTE_SIZE),
];

/** Every row of the game-over overlay, top to bottom. */
export const GAME_OVER_BOXES: readonly HudBox[] = [
  overlayRow('game-over heading', GAME_OVER_HEADING_Y, GAME_OVER_HEADING_SIZE),
  overlayRow('game-over score label', GAME_OVER_SCORE_LABEL_Y, HUD_LABEL_SIZE),
  overlayRow('game-over score', GAME_OVER_SCORE_VALUE_Y, GAME_OVER_SCORE_SIZE),
  overlayRow('game-over stats', GAME_OVER_STATS_Y, GAME_OVER_STATS_SIZE),
  overlayRow('game-over best', GAME_OVER_BEST_Y, GAME_OVER_BEST_SIZE),
  overlayRow('game-over prompt', GAME_OVER_PROMPT_Y, GAME_OVER_PROMPT_SIZE),
];

/**
 * The band around the lamp that game-over text must stay out of, so the crawler
 * still touching the lamp is visible (`docs/vision.md` §6 criterion 6). Overlay
 * rows span the full width, so the nearest they ever come to the lamp centre is
 * directly above or below it, and a vertical band is the exact test.
 */
export const GAME_OVER_CLEAR_BAND = {
  top: LAMP_Y - GAME_OVER_CLEAR_RADIUS,
  bottom: LAMP_Y + GAME_OVER_CLEAR_RADIUS,
} as const;

/** Whether two boxes share any area. Touching edges do not count as overlap. */
export function overlaps(a: HudBox, b: HudBox): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}
