// src/hud owns the on-screen readouts. This file makes one of them.
//
// Every HUD string goes through here so the palette, the font stacks and the
// ink shadow are applied in exactly one place. The shadow is not decoration:
// the beam sweeps under the readouts at up to BEAM_FOCUS_ALPHA, and unshadowed
// text over a lit cone is the `docs/concept.md` §9 readability risk happening
// to the HUD itself.

import Phaser from 'phaser';

import {
  HUD_FONT_FAMILY,
  HUD_FONT_FAMILY_MONO,
  HUD_TEXT_SHADOW_BLUR,
  HUD_TEXT_SHADOW_COLOR,
  HUD_TEXT_SHADOW_OFFSET,
} from '../config/index';

/** Horizontal anchoring. The vertical anchor is always the top of the line. */
export type HudAlign = 'left' | 'center' | 'right';

const ORIGIN_X: Readonly<Record<HudAlign, number>> = {
  left: 0,
  center: 0.5,
  right: 1,
};

/** The top of the line, so a readout's box is `y` to `y + lineHeight`. */
const ORIGIN_Y = 0;

export interface HudTextSpec {
  readonly x: number;
  readonly y: number;
  readonly content: string;
  readonly size: number;
  readonly color: string;
  readonly align: HudAlign;
  /** Figures use the mono stack so a changing digit cannot shift the line. */
  readonly mono?: boolean;
  readonly tracking?: number;
}

/** Adds one configured line of HUD text to the scene. */
export function hudText(scene: Phaser.Scene, spec: HudTextSpec): Phaser.GameObjects.Text {
  const text = scene.add.text(spec.x, spec.y, spec.content, {
    fontFamily: spec.mono === true ? HUD_FONT_FAMILY_MONO : HUD_FONT_FAMILY,
    fontSize: `${spec.size}px`,
    color: spec.color,
  });

  text.setOrigin(ORIGIN_X[spec.align], ORIGIN_Y);
  text.setShadow(
    HUD_TEXT_SHADOW_OFFSET,
    HUD_TEXT_SHADOW_OFFSET,
    HUD_TEXT_SHADOW_COLOR,
    HUD_TEXT_SHADOW_BLUR,
    false,
    true,
  );

  if (spec.tracking !== undefined) {
    text.setLetterSpacing(spec.tracking);
  }

  return text;
}

/**
 * Sets a string only when it actually changed.
 *
 * The power and score events fire on every frame of PLAYING, and each `setText`
 * re-renders the text's canvas texture. Most frames do not change most of the
 * readouts — the timer moves ten times a second, the banishment count a handful
 * of times a run — so this is the difference between four texture re-renders a
 * frame and nearly none (the §9 performance risk in `docs/concept.md`).
 */
export function setTextIfChanged(text: Phaser.GameObjects.Text, next: string): void {
  if (text.text !== next) {
    text.setText(next);
  }
}
