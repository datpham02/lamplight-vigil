// src/beam owns the player's light: aiming, width control and power drain.
//
// This file is the rendering and input half. The rules it renders — the §3.1
// state machine, the §3.2 geometry and the §4 power economy of docs/design.md —
// live in BeamModel.ts, which knows nothing about Phaser.
import Phaser from 'phaser';

import {
  BEAM_COLOR,
  BEAM_CONE_LAYERS,
  BEAM_DEPTH,
  LAMP_X,
  LAMP_Y,
} from '../config/index';
import { VIGIL_EVENTS, type BeamAimedPayload, type BeamStatePayload } from '../scenes/events';
import { BeamModel } from './BeamModel';

/**
 * The player's light: a cone cast from the lamp towards the mouse, narrowing to
 * a focused burn while a focus binding is held.
 *
 * Other modules learn what the beam is doing from the scene's event emitter, not
 * by holding a reference to this class. The one exception is `light`, which the
 * scene hands to the crawler field each frame so it can ask what is lit — a
 * read-only query, passed in by the scene rather than reached for.
 */
export class Beam {
  private readonly scene: Phaser.Scene;
  private readonly cone: Phaser.GameObjects.Graphics;
  private readonly model = new BeamModel();

  /**
   * Phaser reports an active pointer at (0, 0) until the mouse first moves over
   * the canvas, which would snap the beam to the top-left corner on frame one.
   * Hold the rest angle until there is a real pointer position to read.
   */
  private pointerSeen = false;

  /** Width the cone geometry was last built at; null forces the first build. */
  private renderedWidth: number | null = null;

  /** State the last BEAM_STATE_CHANGED was emitted for. */
  private renderedState = this.model.state;

  public constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.cone = scene.add.graphics({ x: LAMP_X, y: LAMP_Y }).setDepth(BEAM_DEPTH);
    this.cone.setRotation(this.model.angleRad);
    this.rebuildCone();

    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
  }

  /**
   * The beam as a light source: what it covers, and whether it is burning.
   * Handed to the crawler field by the scene each frame.
   */
  public get light(): BeamModel {
    return this.model;
  }

  public get power(): number {
    return this.model.power;
  }

  public get focusLockedOut(): boolean {
    return this.model.focusLockedOut;
  }

  /**
   * Where the pointer currently is, as a bearing from the lamp. Used by the
   * scene to seed the beam's aim on entry to PLAYING (§2.2).
   */
  public get pointerAngleRad(): number {
    if (!this.pointerSeen) {
      return this.model.angleRad;
    }

    const pointer = this.scene.input.activePointer;
    return Phaser.Math.Angle.Between(LAMP_X, LAMP_Y, pointer.worldX, pointer.worldY);
  }

  /** §2.2 — per-run reset. See BeamModel.reset. */
  public reset(focusHeldNow: boolean): void {
    this.model.reset(this.pointerAngleRad, focusHeldNow);
    this.syncAim();
    this.rebuildCone();
    this.renderedState = this.model.state;
  }

  /**
   * Re-aims at the pointer without advancing any rules. Used in TITLE and in
   * GAME_OVER, where the world is frozen but the beam should not lie about where
   * the mouse is on the next restart.
   */
  public updateAim(): void {
    this.syncAim();
  }

  /**
   * One frame of PLAYING.
   *
   * @param deltaSeconds Already clamped to DELTA_CLAMP_MS by the scene (§2.4).
   * @param focusHeld Whether either focus binding is down this frame.
   */
  public update(deltaSeconds: number, focusHeld: boolean): void {
    this.syncAim();
    this.model.update(deltaSeconds, focusHeld);

    if (this.model.width !== this.renderedWidth) {
      this.rebuildCone();
    }

    if (this.model.state !== this.renderedState) {
      this.renderedState = this.model.state;
      const payload: BeamStatePayload = { state: this.model.state, width: this.model.width };
      this.scene.events.emit(VIGIL_EVENTS.BEAM_STATE_CHANGED, payload);
    }
  }

  private onPointerMove(): void {
    this.pointerSeen = true;
    this.syncAim();
  }

  /**
   * Aiming is absolute: the beam points at the pointer, with no smoothing, lag or
   * turn-rate limit. Any of those would be the beam-rotation inertia that
   * docs/design.md §9.3 records as a contingency and puts out of scope.
   */
  private syncAim(): void {
    if (!this.pointerSeen) {
      return;
    }

    const next = this.pointerAngleRad;
    if (next === this.model.angleRad) {
      return;
    }

    this.model.aimAt(next);
    this.cone.setRotation(next);

    const payload: BeamAimedPayload = { angleRad: next };
    this.scene.events.emit(VIGIL_EVENTS.BEAM_AIMED, payload);
  }

  /**
   * Redraws the cone along +x with its apex at the graphics origin, so aiming
   * stays a rotation. Only called when the width parameter has actually moved —
   * at a settled width, and while the player is only re-aiming, nothing is
   * rebuilt (performance mitigation, docs/concept.md §9).
   */
  private rebuildCone(): void {
    const width = this.model.width;
    const halfAngle = this.model.halfAngleRad;
    const range = this.model.range;
    const alpha = this.model.alpha;

    this.cone.clear();
    for (const layer of BEAM_CONE_LAYERS) {
      this.cone.fillStyle(BEAM_COLOR, alpha * layer.alphaScale);
      this.cone.slice(0, 0, range * layer.lengthScale, -halfAngle, halfAngle, false);
      this.cone.fillPath();
    }

    this.renderedWidth = width;
  }
}
