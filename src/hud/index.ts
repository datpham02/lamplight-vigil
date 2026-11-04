// src/hud owns the on-screen readouts: lamp power, score, the run timer, the
// banishment count, the best score, and the title and game-over screens.
//
// `Hud` is the whole public surface. The scene constructs one and the HUD wires
// itself to the event contract in `src/scenes/events.ts`; nothing outside this
// folder needs any other name from it.
export { Hud } from './Hud';
