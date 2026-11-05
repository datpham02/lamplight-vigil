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
npm test          # node:test over src/ and tools/, through tsx
npm run sim       # deterministic throughput simulation; see docs/throughput-sim.md
npm run sim -- --modifiers   # the same, swept over every weekly modifier cell
```

`npm run sim` reads the shipped `src/config` and checks the difficulty curve
against `docs/design.md` §11.1 and its invariants. It exits non-zero when a retune
breaks one, and needs no browser. Run it after changing any value in §10.4–§10.7.

`npm run sim -- --modifiers` runs the same invariants over every cell of the
weekly modifier table (`docs/design.md` §14.5), so a week the game can generate
cannot break a pillar that the shipped config holds. Run it after changing any
value in §10.3–§10.7 **or** any entry of the table — a modifier is a multiplier on
a shipped constant, so retuning the constant moves every week built on it.

`npm ci`, `npm run typecheck` and `npm run build` must all pass before you open a
pull request, and their output belongs in the PR or the task comment.

Use `npm ci` rather than `npm install` unless you are intentionally changing a
dependency; if you do change one, commit the updated `package-lock.json` in the
same commit.

## Rendering model

The game renders at a fixed **960 x 540** and is scaled to fit **the element it
was mounted into** (`Phaser.Scale.FIT`, centred), which is not the window. Every
gameplay coordinate is in that render space. Never read
`window.innerWidth`/`innerHeight` in gameplay code, and never assume a layout
that depends on the browser window size — or on the game owning the page.

## The game is a widget

`mount()` in `src/host` puts the game into an element a host page owns, and
`destroy()` takes it back off. `src/main.ts` is one caller of it; so is anyone
embedding the game. `docs/design.md` §2.6 is the ruling, and it constrains every
module:

- No module-level state and nothing global. Two mounted games are two runs.
- Input is scoped to the container, never to `window`: keys only when the game
  has focus, pointer presses only when they land inside its box.
- Nothing audio-shaped exists before the first user gesture on the game.
- Every listener, timer and audio node a mount creates must come off on
  `destroy()`. If it cannot wait for Phaser's deferred teardown, register it
  with `HostContext.addDisposable`.
- Never focus, size, restyle or scroll anything outside the container.

`embed.html` is the harness for checking all of that by hand: two games on one
page, in differently-shaped boxes, beside an ordinary text field.

## Platform adapter boundary

- Gameplay and scenes may only talk to `src/platform`'s `Platform` interface.
- No module may import a backend/provider SDK directly.
- If no platform is injected at `mount()`, the game must run on `LocalPlatform`
  (localStorage only, no network) without losing local best-score behavior.
- Code may call optional platform features only when their capability is present
  in `platform.capabilities`.

## Folder ownership

```
src/config/    All tuning values. Owned jointly by game-designer and gameplay-programmer.
src/beam/      The player's light: aiming, width control, power drain.
src/enemies/   Creatures: spawning from the edges, movement, freeze and burn states.
src/hud/       On-screen readouts: lamp power, score, run state messaging.
src/weekly/    The week key, the seed, the §14.4 block schedule, and what a run is played under in each mode. Pure; no clock read, no storage, no network. The modifier table and the override layer it is applied through are data in src/config.
src/scenes/    Phaser scenes and their lifecycle wiring.
src/host/      The boundary with the host page: mount, destroy, pause, input scope, the Phaser config.
src/main.ts    One caller of src/host's mount(). Keep it thin.
tools/         Developer tooling, not gameplay and not bundled. Nothing in src/ may import it.
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
