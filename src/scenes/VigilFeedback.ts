// src/scenes owns the scenes and their wiring. This file is the feel pass's
// wiring: the three moments worth confirming, and what each one does.
//
//   crawler froze    -> catch cue                       (ring is drawn by the crawler renderer)
//   crawler banished -> burst at the point + burn cue
//   lamp hit         -> burst at the point + screen shake + hit cue
//
// It listens on the scene event bus rather than being called by the scene, for
// the reason AGENTS.md gives: feedback is a subscriber to what the game did, not
// a step in doing it. Delete this class and the game still plays correctly, with
// every rule intact and every state still legible — which is the test that it
// has added feedback and not a mechanic.
import Phaser from 'phaser';

import {
  BANISH_BURST_ALPHA,
  BANISH_BURST_COLOR,
  BANISH_BURST_SCALE_END,
  BANISH_BURST_SCALE_START,
  BANISH_BURST_TIME,
  BANISH_BURST_WIDTH,
  CRAWLER_RADIUS,
  FEEDBACK_BURST_MAX,
  FEEDBACK_DEPTH,
  LAMP_HIT_BURST_ALPHA,
  LAMP_HIT_BURST_COLOR,
  LAMP_HIT_BURST_SCALE_END,
  LAMP_HIT_BURST_SCALE_START,
  LAMP_HIT_BURST_TIME,
  LAMP_HIT_BURST_WIDTH,
  LAMP_RADIUS,
  SHAKE_LAMP_HIT_DURATION_MS,
  SHAKE_LAMP_HIT_INTENSITY,
} from '../config/index';
import type { HostContext } from '../host/hostContext';
import { VIGIL_EVENTS, type PointPayload } from './events';
import { VigilAudio } from './VigilAudio';

/** The shape of one expanding ring. Both kinds differ only in these numbers. */
interface BurstStyle {
  readonly duration: number;
  readonly baseRadius: number;
  readonly scaleStart: number;
  readonly scaleEnd: number;
  readonly width: number;
  readonly alpha: number;
  readonly color: number;
}

const BANISH_BURST: BurstStyle = {
  duration: BANISH_BURST_TIME,
  baseRadius: CRAWLER_RADIUS,
  scaleStart: BANISH_BURST_SCALE_START,
  scaleEnd: BANISH_BURST_SCALE_END,
  width: BANISH_BURST_WIDTH,
  alpha: BANISH_BURST_ALPHA,
  color: BANISH_BURST_COLOR,
};

const LAMP_HIT_BURST: BurstStyle = {
  duration: LAMP_HIT_BURST_TIME,
  baseRadius: LAMP_RADIUS,
  scaleStart: LAMP_HIT_BURST_SCALE_START,
  scaleEnd: LAMP_HIT_BURST_SCALE_END,
  width: LAMP_HIT_BURST_WIDTH,
  alpha: LAMP_HIT_BURST_ALPHA,
  color: LAMP_HIT_BURST_COLOR,
};

/** One live ring. Pooled: `left <= 0` is a free slot. */
interface Burst {
  x: number;
  y: number;
  left: number;
  style: BurstStyle;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export class VigilFeedback {
  private readonly scene: Phaser.Scene;
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly audio: VigilAudio;

  /**
   * Fixed-size pool, allocated once. A burst past the cap is dropped rather than
   * queued, for the same reason a spawn at MAX_CRAWLERS is (§5.3): a confirmation
   * that arrives after the thing it confirms is worse than no confirmation.
   */
  private readonly bursts: Burst[] = [];

  /**
   * @param host The mount, passed through to the audio layer: it is the mount
   * that knows when the player first touched the game, which is the only moment
   * an AudioContext may be created.
   */
  public constructor(scene: Phaser.Scene, host: HostContext | null) {
    this.scene = scene;
    this.graphics = scene.add.graphics().setDepth(FEEDBACK_DEPTH);
    this.audio = new VigilAudio(host);

    for (let i = 0; i < FEEDBACK_BURST_MAX; i += 1) {
      this.bursts.push({ x: 0, y: 0, left: 0, style: BANISH_BURST });
    }

    scene.events.on(VIGIL_EVENTS.CRAWLER_FROZEN, this.onCrawlerFrozen, this);
    scene.events.on(VIGIL_EVENTS.CRAWLER_BANISHED, this.onCrawlerBanished, this);
    scene.events.on(VIGIL_EVENTS.LAMP_HIT, this.onLampHit, this);
  }

  /**
   * Runs in every run state, on its own clock.
   *
   * In GAME_OVER that is deliberate and is not a breach of §2.3's freeze: §2.3
   * freezes the *world* so the player can see what killed them, and a ring
   * fading over the crawler that is still sitting on the lamp moves nothing,
   * hides nothing and advances no rule. No crawler steps, no spawn fires, no
   * power moves and no time accrues.
   *
   * @param deltaSeconds Already clamped to DELTA_CLAMP_MS by the scene (§2.4).
   */
  public update(deltaSeconds: number): void {
    this.audio.update(deltaSeconds);

    this.graphics.clear();

    for (const burst of this.bursts) {
      if (burst.left <= 0) {
        continue;
      }

      burst.left = Math.max(0, burst.left - deltaSeconds);
      this.drawBurst(burst);
    }
  }

  /**
   * §2.2 — per-run reset. Kills every live burst and cancels a running shake, so
   * a restart never opens mid-camera-shake or with the last death still fading
   * over the new run's first frame.
   */
  public reset(): void {
    for (const burst of this.bursts) {
      burst.left = 0;
    }

    this.graphics.clear();
    this.audio.reset();
    this.scene.cameras.main.resetFX();
  }

  private onCrawlerFrozen(): void {
    this.audio.freeze();
  }

  private onCrawlerBanished(at: PointPayload): void {
    this.spawnBurst(at, BANISH_BURST);
    this.audio.banish();
  }

  private onLampHit(at: PointPayload): void {
    this.spawnBurst(at, LAMP_HIT_BURST);
    this.audio.lampHit();
    this.scene.cameras.main.shake(SHAKE_LAMP_HIT_DURATION_MS, SHAKE_LAMP_HIT_INTENSITY);
  }

  private spawnBurst(at: PointPayload, style: BurstStyle): void {
    const slot = this.bursts.find((burst) => burst.left <= 0);
    if (slot === undefined) {
      return;
    }

    slot.x = at.x;
    slot.y = at.y;
    slot.left = style.duration;
    slot.style = style;
  }

  private drawBurst(burst: Burst): void {
    const { style } = burst;

    // left falls duration -> 0, so progress runs 0 -> 1 as the ring expands.
    const progress = 1 - burst.left / style.duration;
    const radius = style.baseRadius * lerp(style.scaleStart, style.scaleEnd, progress);

    this.graphics.lineStyle(style.width, style.color, style.alpha * (1 - progress));
    this.graphics.strokeCircle(burst.x, burst.y, radius);
  }
}
