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
src/beam/      The player's light
src/enemies/   Creatures and their freeze/burn states
src/hud/       On-screen readouts
src/scenes/    Phaser scenes
src/main.ts    Game boot
```

The game renders at a fixed 960x540 and is scaled to fit the window.

## For agents

See [AGENTS.md](./AGENTS.md) for engine versions, folder ownership, branch/PR
rules, and the rule that all tuning values live in `src/config`.

## Assets

Assets are original or CC0 only; provenance is listed here as assets are added.

_No assets yet._
