// src/hud owns the on-screen readouts. This is the only one the player types
// into, and it is `docs/design.md` §15.3.
//
// It is a panel over the title screen, not a screen of its own, and it exists
// in exactly one place in the game for a pillar-3 reason: a name step anywhere
// between dying and playing again is the classic arcade failure condition C3.2
// names (`docs/vision.md` §3). The scene can only open it from TITLE, and the
// HUD takes it down on any state that is not TITLE — two locks on a door that
// the restart path never walks past.
//
// Everything on it is built once, in the scene's create(). Opening it sets
// strings and a visibility flag; nothing is loaded, measured or tweened into
// existence at the moment the player presses the key.
//
// The four rows, and the job of each:
//
//  1. **Heading** — what this panel is.
//  2. **The field** — a bounded box with the draft in it and a caret just past
//     the last character, so "where does the name end" is never a question.
//  3. **The rules, then the notice** — what a name may be, stated before it can
//     be broken, and under it either the standing weekly limit or the one
//     complaint the last keystroke earned.
//  4. **The prompt** — both ways out, and the name ESC goes back to.

import Phaser from 'phaser';

import {
  HUD_INK,
  HUD_LAMPLIGHT,
  HUD_TEXT_DIM,
  HUD_TEXT_PRIMARY,
  HUD_TEXT_WARN,
  NAME_EDITOR_CARET_DIM_ALPHA,
  NAME_EDITOR_CARET_GAP,
  NAME_EDITOR_CARET_PULSE_MS,
  NAME_EDITOR_CARET_WIDTH,
  NAME_EDITOR_FIELD_FILL_ALPHA,
  NAME_EDITOR_FIELD_HEIGHT,
  NAME_EDITOR_FIELD_SIZE,
  NAME_EDITOR_FIELD_STROKE_ALPHA,
  NAME_EDITOR_FIELD_STROKE_WIDTH,
  NAME_EDITOR_FIELD_TEXT_Y,
  NAME_EDITOR_FIELD_WIDTH,
  NAME_EDITOR_FIELD_Y,
  NAME_EDITOR_HEADING_SIZE,
  NAME_EDITOR_HEADING_TRACKING,
  NAME_EDITOR_HEADING_Y,
  NAME_EDITOR_NOTICE_SIZE,
  NAME_EDITOR_NOTICE_Y,
  NAME_EDITOR_PROMPT_SIZE,
  NAME_EDITOR_PROMPT_Y,
  NAME_EDITOR_RULE_SIZE,
  NAME_EDITOR_RULE_Y,
  NAME_EDITOR_SCRIM_ALPHA,
  OVERLAY_DEPTH,
  RENDER_WIDTH,
} from '../config/index';
import type { DisplayNamePayload } from '../scenes/events';
import { scrim } from './scrim';
import * as strings from './strings';
import { hudText, setTextIfChanged } from './text';

const CENTER_X = RENDER_WIDTH / 2;

export class NameEditorOverlay {
  private readonly container: Phaser.GameObjects.Container;
  private readonly draft: Phaser.GameObjects.Text;
  private readonly caret: Phaser.GameObjects.Rectangle;
  private readonly notice: Phaser.GameObjects.Text;
  private readonly prompt: Phaser.GameObjects.Text;

  public constructor(scene: Phaser.Scene) {
    const field = scene.add
      .rectangle(
        CENTER_X,
        NAME_EDITOR_FIELD_Y,
        NAME_EDITOR_FIELD_WIDTH,
        NAME_EDITOR_FIELD_HEIGHT,
        HUD_INK,
        NAME_EDITOR_FIELD_FILL_ALPHA,
      )
      .setOrigin(0.5, 0)
      .setStrokeStyle(
        NAME_EDITOR_FIELD_STROKE_WIDTH,
        HUD_LAMPLIGHT,
        NAME_EDITOR_FIELD_STROKE_ALPHA,
      );

    // Mono, so that the box the field needs is arithmetic rather than a guess
    // (`layout.ts`, `nameDraftWidth`), and so a 12-character name cannot be
    // wider than the box drawn for it.
    this.draft = hudText(scene, {
      x: CENTER_X,
      y: NAME_EDITOR_FIELD_TEXT_Y,
      content: '',
      size: NAME_EDITOR_FIELD_SIZE,
      color: HUD_TEXT_PRIMARY,
      align: 'center',
      mono: true,
    });

    this.caret = scene.add
      .rectangle(
        CENTER_X,
        NAME_EDITOR_FIELD_TEXT_Y,
        NAME_EDITOR_CARET_WIDTH,
        NAME_EDITOR_FIELD_SIZE,
        HUD_LAMPLIGHT,
      )
      .setOrigin(0, 0);

    // A pulse rather than a blink: it fades to a quarter and back at well under
    // three flashes a second, which is the accessibility bound, and a caret
    // that never fully leaves is easier to keep your eye on (§15.6).
    scene.tweens.add({
      targets: this.caret,
      alpha: { from: 1, to: NAME_EDITOR_CARET_DIM_ALPHA },
      duration: NAME_EDITOR_CARET_PULSE_MS,
      yoyo: true,
      repeat: -1,
    });

    this.notice = hudText(scene, {
      x: CENTER_X,
      y: NAME_EDITOR_NOTICE_Y,
      content: strings.NAME_EDITOR_WEEKLY,
      size: NAME_EDITOR_NOTICE_SIZE,
      color: HUD_TEXT_DIM,
      align: 'center',
    });

    this.prompt = hudText(scene, {
      x: CENTER_X,
      y: NAME_EDITOR_PROMPT_Y,
      content: '',
      size: NAME_EDITOR_PROMPT_SIZE,
      color: HUD_TEXT_PRIMARY,
      align: 'center',
    });

    this.container = scene.add.container(0, 0, [
      scrim(scene, NAME_EDITOR_SCRIM_ALPHA),

      hudText(scene, {
        x: CENTER_X,
        y: NAME_EDITOR_HEADING_Y,
        content: strings.NAME_EDITOR_HEADING,
        size: NAME_EDITOR_HEADING_SIZE,
        color: HUD_TEXT_PRIMARY,
        align: 'center',
        tracking: NAME_EDITOR_HEADING_TRACKING,
      }),

      field,
      this.draft,
      this.caret,

      hudText(scene, {
        x: CENTER_X,
        y: NAME_EDITOR_RULE_Y,
        content: strings.NAME_EDITOR_RULE,
        size: NAME_EDITOR_RULE_SIZE,
        color: HUD_TEXT_DIM,
        align: 'center',
      }),

      this.notice,
      this.prompt,
    ]);

    // Above the title screen it covers, and above the pause overlay's depth tie
    // it can never contend with: TITLE does not suspend (§2.5).
    this.container.setDepth(OVERLAY_DEPTH);
    this.container.setVisible(false);
  }

  /**
   * Puts the editor up, or takes it down, from one reading of the name block.
   *
   * The complaint and the standing weekly rule share a row. A complaint is in
   * ember *and* says what the rule is, because colour alone is not a message
   * (§15.6): a player who cannot tell the two colours apart still reads a
   * different sentence.
   */
  public show(payload: DisplayNamePayload): void {
    if (!payload.editing || payload.draft === null) {
      this.hide();
      return;
    }

    setTextIfChanged(this.draft, payload.draft);
    this.positionCaret();

    if (payload.notice === null) {
      setTextIfChanged(this.notice, strings.NAME_EDITOR_WEEKLY);
      this.notice.setColor(HUD_TEXT_DIM);
    } else {
      setTextIfChanged(this.notice, strings.nameNoticeLine(payload.notice));
      this.notice.setColor(HUD_TEXT_WARN);
    }

    setTextIfChanged(this.prompt, strings.nameEditorPrompt(payload.name));
    this.container.setVisible(true);
  }

  public hide(): void {
    this.container.setVisible(false);
  }

  /**
   * The caret follows the end of the draft. The draft is centred, so its right
   * edge moves by half a character per keystroke — which is why the caret is a
   * separate object placed from the measured text rather than a character on
   * the end of the string: a `_` in the string would be centred *with* it and
   * would shift the name itself sideways as it pulsed.
   */
  private positionCaret(): void {
    this.caret.setX(CENTER_X + this.draft.width / 2 + NAME_EDITOR_CARET_GAP);
  }
}
