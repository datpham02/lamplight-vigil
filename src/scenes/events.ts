// src/scenes owns the Phaser scenes and their lifecycle wiring, including the
// scene event bus other modules talk over.
//
// Cross-module communication goes through these events (or the Phaser registry),
// never by reaching into another module's classes (AGENTS.md). Importing the
// names below is not "reaching in": it is the shared contract. Add an event here
// when a module needs to tell the rest of the game something.

export const VIGIL_EVENTS = {
  /** The beam's aim changed. Payload: BeamAimedPayload. */
  BEAM_AIMED: 'beam:aimed',
} as const;

/** Payload for VIGIL_EVENTS.BEAM_AIMED. */
export interface BeamAimedPayload {
  /** Angle from the lamp to the pointer, in radians, in render space. */
  readonly angleRad: number;
}
