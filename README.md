# Lamplight Vigil

You are the last lamp in a dark hollow, and the only thing you can move is your light. Creatures crawl in from every edge and freeze while your beam touches them. A wide beam only holds them still; a narrowed beam burns them away and drains your power.

- Genre: single-screen 2D arcade survival, score attack
- Platform: desktop web browser
- Engine: Phaser 3 + TypeScript (Vite, npm)

## Setup

Requires Node.js 20 or newer.

```bash
npm ci
npm run dev
```

The dev server prints a local URL; open it in a desktop browser.

## Other commands

```bash
npm run typecheck   # tsc --noEmit, strict
npm run test        # unit tests for the core-loop rules (node:test, no browser)
npm run build       # typecheck + production bundle into dist/
npm run preview     # serve the built dist/ locally
```

The tests cover the parts of the game that are pure rules — the beam state
machine and power economy, crawler freeze/burn resolution, spawn placement and
the ramps, and scoring. Those modules import no Phaser, so they can be stepped at
a fixed delta instead of being played by hand.

## Layout

```
src/config/    All tuning values (speeds, radii, colours, rates)
src/beam/      The player's light: the lamp and the cone it casts
src/enemies/   Creatures and their freeze/burn states
src/hud/       On-screen readouts
src/scenes/    Phaser scenes, and the scene event contract (events.ts)
src/main.ts    Game boot
```

The game renders at a fixed 960x540 and is scaled to fit the window
(`Phaser.Scale.FIT`, centred), so it letterboxes rather than re-laying out. No
gameplay code reads the browser window size.

Modules talk to each other over the scene event bus — see
[`src/scenes/events.ts`](./src/scenes/events.ts) — not by holding references to
each other's classes.

## How to play

Aim with the mouse. Hold **Shift** or the **left mouse button** to narrow the
beam into a focused burn; release to widen it. A wide beam freezes every crawler
it touches but kills none; a focused beam burns one away after a short dwell and
drains your power. Power recharges while the beam is wide. Running out of power
does not end the run — it only stops you burning until the meter recovers.

A crawler reaching the lamp ends the run. Press **R** to go again.

## What is implemented so far

The whole core loop: beam aiming and focus, the power meter, crawler spawning and
movement, freeze/burn resolution, the run state machine, game over and scoring,
with every tuning value read from `src/config` per `docs/design.md` §10.

Still to come in the "Playable Vigil" milestone: the HUD readouts and the title
and game-over overlays, and the game-feel pass (glow, shake, sound hooks). Until
the HUD lands, power, score and best score are emitted on the scene event bus but
are not drawn — the loop is playable, but it does not yet tell you your numbers.

## For agents

See [AGENTS.md](./AGENTS.md) for engine versions, folder ownership, branch/PR
rules, and the rule that all tuning values live in `src/config`.

## Assets

Assets are original or CC0 only; provenance is listed here as assets are added.
An asset with no entry in this table is a blocker, not a detail to fix later.

| Asset | Kind | Provenance | Licence |
| ----- | ---- | ---------- | ------- |
| `lamp-glow` | Radial-gradient halo, generated in code at boot ([`src/beam/Lamp.ts`](./src/beam/Lamp.ts)) | Original, written for this game | Same as the repository |
| Lamp core, beam cone | Phaser shape primitives drawn in code | Original, written for this game | Same as the repository |
| Crawlers, ambient wash | Phaser shape primitives drawn in code | Original, written for this game | Same as the repository |

No binary or third-party art, audio or font files are in the repository. All
placeholder programmer art is generated from code once at boot.
