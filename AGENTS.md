# AGENTS.md — lamplight-vigil

Instructions for AI agents working in this repository. Read this before changing
any file here.

## What the game is

**Lamplight Vigil** is a single-screen 2D arcade survival / score-attack game for
desktop web browsers. You are the last lamp in a dark hollow, and the only thing
you can move is your light. Creatures crawl in from every edge and freeze while
your beam touches them. A wide beam only holds them still; a narrowed beam burns
them away and drains your power.

The full concept lives in issue **GAM-1**. If a design question is not answered
here or in a task's acceptance criteria, ask the `game-designer` — do not invent
mechanics.

## Engine and versions

| Thing       | Declared range | Locked version |
| ----------- | -------------- | -------------- |
| Engine      | `phaser` ^3.90.0 | 3.90.0       |
| Language    | `typescript` ^5.9.3 (strict) | 5.9.3 |
| Bundler     | `vite` ^7.3.7  | 7.3.7          |
| Package mgr | npm — `package-lock.json` is committed | |
| Runtime     | Node.js 20+ for tooling; the game itself runs in the browser | |

Phaser 3 is deliberate — do not upgrade to Phaser 4 or swap the bundler without a
task that asks for it.

## Commands

Run everything from the repository root.

```bash
npm ci            # install exactly what package-lock.json pins
npm run dev       # Vite dev server with hot reload
npm run typecheck # tsc --noEmit, strict; must pass
npm run build     # typecheck + production bundle into dist/
npm run preview   # serve the built dist/ locally
```

`npm ci`, `npm run typecheck` and `npm run build` must all pass before you open a
pull request, and their output belongs in the PR or the task comment.

Use `npm ci` rather than `npm install` unless you are intentionally changing a
dependency; if you do change one, commit the updated `package-lock.json` in the
same commit.

## Rendering model

The game renders at a fixed **960 x 540** and is scaled to fit the window
(`Phaser.Scale.FIT`, centred). Every gameplay coordinate is in that render space.
Never read `window.innerWidth`/`innerHeight` in gameplay code, and never assume a
layout that depends on the browser window size.

## Folder ownership

```
src/config/    All tuning values. Owned jointly by game-designer and gameplay-programmer.
src/beam/      The player's light: aiming, width control, power drain.
src/enemies/   Creatures: spawning from the edges, movement, freeze and burn states.
src/hud/       On-screen readouts: lamp power, score, run state messaging.
src/scenes/    Phaser scenes and their lifecycle wiring.
src/main.ts    Game boot and Phaser config only. Keep it thin.
```

Keep a change inside the folders its task names. Touching another module's
internals, or refactoring beyond the task, needs a follow-up task — raise it with
the `project-manager` instead of widening the diff.

Cross-module communication goes through scene events or the Phaser registry, not
through reaching into another module's classes.

## All tuning values live in `src/config`

Any number a designer might want to change — speeds, radii, spawn rates, power
drain, colours, score values, durations — is a named exported constant in
`src/config` and is imported where it is used. No magic numbers in `src/beam`,
`src/enemies`, `src/hud` or `src/scenes`.

This exists so `game-designer` can retune the game without reading gameplay code.
A pull request that hardcodes a tunable will be sent back.

## Branch and PR rules

- Work only on the task branch Paperclip created for the task. **Never commit to,
  or push, `main`.** Never force-push.
- One task per branch; keep pull requests small and reviewable.
- Open the PR against `main` with `gh pr create`, and link it from the task.
- Do not merge your own PR. Board review gates every change.
- Never disable, skip or delete a failing test or typecheck to make a build pass.

## Assets and licensing

Every asset in this repository must be **original work made for this game, or
CC0**. No other licence — not CC-BY, not "free for personal use", not
asset-store bundles, not AI-generated art with unclear terms.

Record the provenance of each asset (source URL and licence, or "original") in
`README.md` as it is added. An asset without recorded provenance is a blocker,
not a detail to fix later.

## Code conventions

- TypeScript strict mode is on, including `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. Do not relax `tsconfig.json` to make code compile.
- No `any`, and no `// @ts-ignore`, without a comment explaining why it is
  unavoidable.
- Reset per-run scene state in `init()`, not in the constructor — Phaser reuses
  scene instances across restarts.
- Movement and timers are delta-time based (`update(time, delta)`), never
  per-frame constants.
