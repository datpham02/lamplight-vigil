// src/hud owns the on-screen readouts. This is the first screen of the game.
//
// `docs/vision.md` §6 criterion 5 is decided here and nowhere else: every
// playtester must describe the wide-holds / focused-burns-and-costs trade-off
// after *one* run, unprompted. A trade-off they never discovered cannot be
// described, so the control table does not say "hold SHIFT to focus" — it says
// what focusing buys and what it costs, and what releasing gives back. The
// power meter then shows that same sentence happening while they play.
//
// The key names come from `src/config` via `strings.ts`, never from a literal
// here, so the prompt cannot name a key the game does not listen to
// (`docs/design.md` §7).

import Phaser from 'phaser';

import {
  HUD_TEXT_DIM,
  HUD_TEXT_PRIMARY,
  OVERLAY_DEPTH,
  RENDER_WIDTH,
  TITLE_BEST_SIZE,
  TITLE_BEST_Y,
  TITLE_CONTROLS_KEY_RIGHT_X,
  TITLE_CONTROLS_ROW_GAP,
  TITLE_CONTROLS_SIZE,
  TITLE_CONTROLS_TEXT_LEFT_X,
  TITLE_CONTROLS_TOP_Y,
  TITLE_FOOTNOTE_SIZE,
  TITLE_FOOTNOTE_Y,
  TITLE_HEADING_SIZE,
  TITLE_HEADING_TRACKING,
  TITLE_HEADING_Y,
  TITLE_NAME_SIZE,
  TITLE_NAME_Y,
  TITLE_PROMPT_SIZE,
  TITLE_PROMPT_Y,
  TITLE_SCRIM_ALPHA,
  TITLE_TAGLINE_SIZE,
  TITLE_TAGLINE_Y,
} from '../config/index';
import type { DisplayNamePayload } from '../scenes/events';
import { formatCount } from './layout';
import { scrim } from './scrim';
import * as strings from './strings';
import { hudText, setTextIfChanged } from './text';

const CENTER_X = RENDER_WIDTH / 2;

export class TitleOverlay {
  private readonly container: Phaser.GameObjects.Container;
  private readonly best: Phaser.GameObjects.Text;

  /**
   * §15.2 — the name a score from this device would be filed under, and the
   * state of the weekly rename. Set from the name event rather than from
   * `show()`, because it changes while the title screen is already up.
   */
  private readonly name: Phaser.GameObjects.Text;

  /**
   * §15.4 — the prompt, which has two readings. While the rename key is being
   * offered it is the one key that does not start a run, and the prompt says
   * "any other key" for exactly as long as that is true.
   */
  private readonly prompt: Phaser.GameObjects.Text;

  public constructor(scene: Phaser.Scene) {
    const children: Phaser.GameObjects.GameObject[] = [scrim(scene, TITLE_SCRIM_ALPHA)];

    children.push(
      hudText(scene, {
        x: CENTER_X,
        y: TITLE_HEADING_Y,
        content: strings.TITLE_HEADING,
        size: TITLE_HEADING_SIZE,
        color: HUD_TEXT_PRIMARY,
        align: 'center',
        tracking: TITLE_HEADING_TRACKING,
      }),
      hudText(scene, {
        x: CENTER_X,
        y: TITLE_TAGLINE_Y,
        content: strings.TITLE_TAGLINE,
        size: TITLE_TAGLINE_SIZE,
        color: HUD_TEXT_DIM,
        align: 'center',
      }),
    );

    // The control table: keys in lamplight on the right of the gutter, what
    // they do in hollow on the left of it, so the eye can read either column.
    strings.TITLE_CONTROLS.forEach((row, index) => {
      const y = TITLE_CONTROLS_TOP_Y + TITLE_CONTROLS_ROW_GAP * index;

      children.push(
        hudText(scene, {
          x: TITLE_CONTROLS_KEY_RIGHT_X,
          y,
          content: row.key,
          size: TITLE_CONTROLS_SIZE,
          color: HUD_TEXT_PRIMARY,
          align: 'right',
        }),
        hudText(scene, {
          x: TITLE_CONTROLS_TEXT_LEFT_X,
          y,
          content: row.effect,
          size: TITLE_CONTROLS_SIZE,
          color: HUD_TEXT_DIM,
          align: 'left',
        }),
      );
    });

    // Mono, like every other figure on this screen: the name is a label on a
    // board, and a proportional one would shift the row's centre every time a
    // character is typed into it.
    this.name = hudText(scene, {
      x: CENTER_X,
      y: TITLE_NAME_Y,
      content: '',
      size: TITLE_NAME_SIZE,
      color: HUD_TEXT_DIM,
      align: 'center',
      mono: true,
    });

    this.best = hudText(scene, {
      x: CENTER_X,
      y: TITLE_BEST_Y,
      content: strings.TITLE_NO_BEST,
      size: TITLE_BEST_SIZE,
      color: HUD_TEXT_PRIMARY,
      align: 'center',
      mono: true,
    });

    this.prompt = hudText(scene, {
      x: CENTER_X,
      y: TITLE_PROMPT_Y,
      content: strings.TITLE_PROMPT,
      size: TITLE_PROMPT_SIZE,
      color: HUD_TEXT_PRIMARY,
      align: 'center',
    });

    children.push(
      this.name,
      this.best,
      this.prompt,
      hudText(scene, {
        x: CENTER_X,
        y: TITLE_FOOTNOTE_Y,
        content: strings.TITLE_FOOTNOTE,
        size: TITLE_FOOTNOTE_SIZE,
        color: HUD_TEXT_DIM,
        align: 'center',
      }),
    );

    this.container = scene.add.container(0, 0, children);
    this.container.setDepth(OVERLAY_DEPTH);
    this.container.setVisible(false);
  }

  /**
   * Pillar 3 — the best score is on the title screen as well as during play and
   * on game over. A player who has never finished a run is told so rather than
   * being shown a zero they might read as a score.
   */
  public show(bestScore: number): void {
    setTextIfChanged(
      this.best,
      bestScore > 0 ? strings.bestScoreLine(formatCount(bestScore)) : strings.TITLE_NO_BEST,
    );
    this.container.setVisible(true);
  }

  /**
   * §15.2 — the name row, and the prompt that depends on it.
   *
   * Called whether or not the title screen is up: the row is written when the
   * name changes, so that the screen is already right on the frame it is shown
   * rather than a frame later.
   */
  public showDisplayName(payload: DisplayNamePayload): void {
    setTextIfChanged(this.name, strings.displayNameRow(payload.name, payload.renameLockDays));
    setTextIfChanged(
      this.prompt,
      payload.renameLockDays > 0 ? strings.TITLE_PROMPT : strings.TITLE_PROMPT_WITH_RENAME,
    );
  }

  public hide(): void {
    this.container.setVisible(false);
  }
}
