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
npm run build       # typecheck + production bundle into dist/
npm run preview     # serve the built dist/ locally
```

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

## What is implemented so far

The lamp and the wide beam, rendering and aim only: the lamp sits at the centre
and the cone follows the mouse. Focusing, the power meter, crawlers, scoring and
the HUD are later tasks in the "Playable Vigil" milestone.

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

No binary or third-party art, audio or font files are in the repository. All
placeholder programmer art is generated from code once at boot.
