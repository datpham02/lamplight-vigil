// src/hud owns the on-screen readouts. This is the screen a player sees more
// often than any other, and the one `docs/vision.md` §6 criterion 6 is measured
// on: they must name what killed them within one second of it appearing.
//
// Three things serve that, and they are the reason this screen is laid out the
// way it is rather than as a centred panel:
//
//  1. `docs/design.md` §2.3 leaves the world frozen with the killer still
//     touching the lamp. The scrim is light and no text comes within
//     `GAME_OVER_CLEAR_RADIUS` of the lamp, so the evidence is never covered.
//  2. A ring is drawn where the crawler made contact, so the answer is pointed
//     at rather than searched for.
//  3. The figures sit above and below that clear disc, not over it.
//
// Nothing here animates, waits, or loads. The overlay is built once in the
// scene's create() and made visible on the frame the run ends, because pillar 3
// forbids anything at all between the lose state and the next playable frame.

import Phaser from 'phaser';

import {
  GAME_OVER_BEST_SIZE,
  GAME_OVER_BEST_Y,
  GAME_OVER_HEADING_SIZE,
  GAME_OVER_HEADING_TRACKING,
  GAME_OVER_HEADING_Y,
  GAME_OVER_MARK_ALPHA,
  GAME_OVER_MARK_COLOR,
  GAME_OVER_MARK_LINE_WIDTH,
  GAME_OVER_MARK_RADIUS,
  GAME_OVER_PROMPT_SIZE,
  GAME_OVER_PROMPT_Y,
  GAME_OVER_BOARD_HEADING_SIZE,
  GAME_OVER_BOARD_HEADING_X,
  GAME_OVER_BOARD_HEADING_Y,
  GAME_OVER_BOARD_ROWS_SIZE,
  GAME_OVER_BOARD_ROWS_X,
  GAME_OVER_BOARD_ROWS_Y,
  GAME_OVER_BOARD_STATE_SIZE,
  GAME_OVER_BOARD_STATE_X,
  GAME_OVER_BOARD_STATE_Y,
  GAME_OVER_SCORE_LABEL_Y,
  GAME_OVER_SCORE_SIZE,
  GAME_OVER_SCORE_VALUE_Y,
  GAME_OVER_SHARE_SIZE,
  GAME_OVER_SHARE_Y,
  GAME_OVER_SCRIM_ALPHA,
  GAME_OVER_STATS_SIZE,
  GAME_OVER_STATS_Y,
  GAME_OVER_WEEK_SIZE,
  GAME_OVER_WEEK_Y,
  HUD_LABEL_SIZE,
  HUD_LABEL_TRACKING,
  HUD_TEXT_DIM,
  HUD_TEXT_PRIMARY,
  OVERLAY_DEPTH,
  RENDER_WIDTH,
} from '../config/index';
import type {
  LeaderboardPayload,
  PointPayload,
  RunStatePayload,
  SharePayload,
} from '../scenes/events';
import { formatCount, formatRunTime } from './layout';
import { leaderboardReadout, weekReadout } from './readouts';
import { scrim } from './scrim';
import * as strings from './strings';
import { hudText, setTextIfChanged } from './text';

const CENTER_X = RENDER_WIDTH / 2;

export class GameOverOverlay {
  private readonly container: Phaser.GameObjects.Container;
  private readonly mark: Phaser.GameObjects.Graphics;

  private readonly score: Phaser.GameObjects.Text;
  private readonly stats: Phaser.GameObjects.Text;
  private readonly best: Phaser.GameObjects.Text;

  /**
   * `docs/design.md` §14.8 — the week this run was played under, in the same
   * words the title screen used before it, and empty in Free Play, which
   * resolves no week at all.
   */
  private readonly week: Phaser.GameObjects.Text;
  private readonly boardHeading: Phaser.GameObjects.Text;
  private readonly boardRows: Phaser.GameObjects.Text;
  private readonly boardState: Phaser.GameObjects.Text;
  private readonly share: Phaser.GameObjects.Text;

  public constructor(scene: Phaser.Scene, onShareRequested: () => void) {
    this.mark = scene.add.graphics();

    this.score = hudText(scene, {
      x: CENTER_X,
      y: GAME_OVER_SCORE_VALUE_Y,
      content: '',
      size: GAME_OVER_SCORE_SIZE,
      color: HUD_TEXT_PRIMARY,
      align: 'center',
      mono: true,
    });
    this.stats = hudText(scene, {
      x: CENTER_X,
      y: GAME_OVER_STATS_Y,
      content: '',
      size: GAME_OVER_STATS_SIZE,
      color: HUD_TEXT_DIM,
      align: 'center',
    });
    this.week = hudText(scene, {
      x: CENTER_X,
      y: GAME_OVER_WEEK_Y,
      content: '',
      size: GAME_OVER_WEEK_SIZE,
      color: HUD_TEXT_DIM,
      align: 'center',
    });
    this.best = hudText(scene, {
      x: CENTER_X,
      y: GAME_OVER_BEST_Y,
      content: '',
      size: GAME_OVER_BEST_SIZE,
      color: HUD_TEXT_DIM,
      align: 'center',
      mono: true,
    });
    this.boardHeading = hudText(scene, {
      x: GAME_OVER_BOARD_HEADING_X,
      y: GAME_OVER_BOARD_HEADING_Y,
      content: '',
      size: GAME_OVER_BOARD_HEADING_SIZE,
      color: HUD_TEXT_DIM,
      align: 'left',
    });
    this.boardRows = hudText(scene, {
      x: GAME_OVER_BOARD_ROWS_X,
      y: GAME_OVER_BOARD_ROWS_Y,
      content: '',
      size: GAME_OVER_BOARD_ROWS_SIZE,
      color: HUD_TEXT_PRIMARY,
      align: 'left',
      mono: true,
    });
    this.boardState = hudText(scene, {
      x: GAME_OVER_BOARD_STATE_X,
      y: GAME_OVER_BOARD_STATE_Y,
      content: '',
      size: GAME_OVER_BOARD_STATE_SIZE,
      color: HUD_TEXT_DIM,
      align: 'left',
    });
    this.share = hudText(scene, {
      x: GAME_OVER_BOARD_STATE_X,
      y: GAME_OVER_SHARE_Y,
      content: strings.GAME_OVER_SHARE,
      size: GAME_OVER_SHARE_SIZE,
      color: HUD_TEXT_DIM,
      align: 'left',
    });
    this.share.setInteractive({ useHandCursor: true });
    this.share.on(Phaser.Input.Events.POINTER_DOWN, onShareRequested);

    this.container = scene.add.container(0, 0, [
      scrim(scene, GAME_OVER_SCRIM_ALPHA),
      this.mark,

      hudText(scene, {
        x: CENTER_X,
        y: GAME_OVER_HEADING_Y,
        content: strings.GAME_OVER_HEADING,
        size: GAME_OVER_HEADING_SIZE,
        color: HUD_TEXT_PRIMARY,
        align: 'center',
        tracking: GAME_OVER_HEADING_TRACKING,
      }),
      hudText(scene, {
        x: CENTER_X,
        y: GAME_OVER_SCORE_LABEL_Y,
        content: strings.GAME_OVER_SCORE_LABEL,
        size: HUD_LABEL_SIZE,
        color: HUD_TEXT_DIM,
        align: 'center',
        tracking: HUD_LABEL_TRACKING,
      }),
      this.score,
      this.stats,
      this.week,
      this.best,
      this.boardHeading,
      this.boardRows,
      this.boardState,
      this.share,
      hudText(scene, {
        x: CENTER_X,
        y: GAME_OVER_PROMPT_Y,
        content: strings.GAME_OVER_PROMPT,
        size: GAME_OVER_PROMPT_SIZE,
        color: HUD_TEXT_PRIMARY,
        align: 'center',
      }),
    ]);
    this.container.setDepth(OVERLAY_DEPTH);
    this.container.setVisible(false);
  }

  /**
   * @param run The figures the scene finalised on entry to GAME_OVER.
   * @param beatPreviousBest Whether this run actually raised the stored best.
   *   Equalling it is not beating it, so the comparison is made against the
   *   best as it stood when the run started, not against the final best.
   * @param contact Where the crawler reached the lamp, if the scene reported it.
   */
  public show(
    run: RunStatePayload,
    beatPreviousBest: boolean,
    contact: PointPayload | null,
  ): void {
    setTextIfChanged(this.score, formatCount(run.score));
    setTextIfChanged(
      this.stats,
      strings.gameOverStatsLine(
        run.mode,
        formatRunTime(run.elapsedSeconds),
        formatCount(run.banished),
      ),
    );

    // §14.8 and criterion 27 — the week the run was played under, taken from
    // the payload rather than from the clock: §14.2 resolved it once at the
    // run's start, and a week that rolled over mid-run must not rename the run
    // that has just ended.
    setTextIfChanged(this.week, weekReadout(run.week));

    const best = formatCount(run.bestScore);
    setTextIfChanged(
      this.best,
      beatPreviousBest ? strings.newBestLine(best) : strings.bestScoreLine(best),
    );
    this.best.setColor(beatPreviousBest ? HUD_TEXT_PRIMARY : HUD_TEXT_DIM);

    this.drawMark(contact);
    this.container.setVisible(true);
  }

  public hide(): void {
    this.container.setVisible(false);
  }

  public showLeaderboard(payload: LeaderboardPayload): void {
    if (!payload.visible) {
      setTextIfChanged(this.boardHeading, '');
      setTextIfChanged(this.boardRows, '');
      setTextIfChanged(this.boardState, '');
      return;
    }

    setTextIfChanged(this.boardHeading, strings.leaderboardHeading(payload.scope));
    setTextIfChanged(this.boardRows, leaderboardReadout(payload));
    setTextIfChanged(
      this.boardState,
      strings.leaderboardStateLine(payload.status, payload.scope, payload.submissionState),
    );
  }

  public showShare(payload: SharePayload): void {
    setTextIfChanged(
      this.share,
      `${strings.GAME_OVER_SHARE}\n${payload.line}\n${strings.shareStatusLine(payload.status)}`,
    );
  }

  /** A thin ring around the point of contact. No tween, no fade, no delay. */
  private drawMark(contact: PointPayload | null): void {
    this.mark.clear();

    if (contact === null) {
      return;
    }

    this.mark.lineStyle(GAME_OVER_MARK_LINE_WIDTH, GAME_OVER_MARK_COLOR, GAME_OVER_MARK_ALPHA);
    this.mark.strokeCircle(contact.x, contact.y, GAME_OVER_MARK_RADIUS);
  }
}
