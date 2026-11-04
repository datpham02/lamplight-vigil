// src/beam owns the player's light: aiming, width control and power drain.
//
// This file is RENDERING AND AIM ONLY. Narrowing to a focused beam, the power
// meter, freezing and burning all belong to the core-loop task.
import Phaser from 'phaser';

import {
  BEAM_COLOR,
  BEAM_CONE_LAYERS,
  BEAM_DEPTH,
  BEAM_LENGTH,
  BEAM_REST_ANGLE_DEG,
  BEAM_WIDE_ANGLE_DEG,
  LAMP_X,
  LAMP_Y,
} from '../config/index';
import { VIGIL_EVENTS, type BeamAimedPayload } from '../scenes/events';

/**
 * Draws the cone once, pointing along +x, with the pivot at the graphics
 * origin. Aiming is then a rotation, so no geometry is rebuilt per frame
 * (performance mitigation, docs/concept.md §9).
 */
function buildCone(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
  const cone = scene.add.graphics({ x: LAMP_X, y: LAMP_Y });
  const halfAngleRad = Phaser.Math.DegToRad(BEAM_WIDE_ANGLE_DEG) / 2;

  for (const layer of BEAM_CONE_LAYERS) {
    cone.fillStyle(BEAM_COLOR, layer.alpha);
    cone.slice(0, 0, BEAM_LENGTH * layer.lengthScale, -halfAngleRad, halfAngleRad, false);
    cone.fillPath();
  }

  return cone.setDepth(BEAM_DEPTH);
}

/**
 * The wide beam: a cone of light cast from the lamp towards the mouse.
 *
 * Other modules learn where the beam points by listening for
 * VIGIL_EVENTS.BEAM_AIMED on the scene's event emitter, not by holding a
 * reference to this class.
 */
export class Beam {
  private readonly scene: Phaser.Scene;
  private readonly cone: Phaser.GameObjects.Graphics;

  /** Current aim, radians, in render space. */
  private angleRad: number;

  /**
   * Phaser reports an active pointer at (0, 0) until the mouse first moves over
   * the canvas, which would snap the beam to the top-left corner on frame one.
   * Hold the rest angle until there is a real pointer position to read.
   */
  private pointerSeen = false;

  public constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.angleRad = Phaser.Math.DegToRad(BEAM_REST_ANGLE_DEG);
    this.cone = buildCone(scene);
    this.cone.setRotation(this.angleRad);

    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
  }

  /** Current aim, radians, in render space. */
  public get angle(): number {
    return this.angleRad;
  }

  /** Re-aims at the pointer. Safe to call every frame; it only rotates. */
  public update(): void {
    if (!this.pointerSeen) {
      return;
    }

    this.aimAt(this.scene.input.activePointer);
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    this.pointerSeen = true;
    this.aimAt(pointer);
  }

  private aimAt(pointer: Phaser.Input.Pointer): void {
    const next = Phaser.Math.Angle.Between(LAMP_X, LAMP_Y, pointer.worldX, pointer.worldY);
    if (next === this.angleRad) {
      return;
    }

    this.angleRad = next;
    this.cone.setRotation(next);

    const payload: BeamAimedPayload = { angleRad: next };
    this.scene.events.emit(VIGIL_EVENTS.BEAM_AIMED, payload);
  }
}
