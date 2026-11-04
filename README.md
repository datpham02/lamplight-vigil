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
the ramps, scoring, the restart budget, and the sound cues as waveforms. Those
modules import no Phaser, so they can be stepped at a fixed delta instead of
being played by hand.

The HUD's placement is in there too. The game renders at a fixed 960x540 that
Phaser letterboxes to the window, so the layout is one set of numbers at every
window size, and [`src/hud/layout.test.ts`](./src/hud/layout.test.ts) checks that
no readout leaves the frame, that no two are written over each other, and that
the game-over text never covers the lamp and the crawler frozen against it.

## Layout

```
src/config/    All tuning values (speeds, radii, colours, rates)
src/beam/      The player's light: the lamp and the cone it casts
src/enemies/   Creatures and their freeze/burn states
src/hud/       On-screen readouts
src/scenes/    Phaser scenes, and the scene event contract (events.ts)
src/host/      The boundary with the host page: mount(), destroy(), pause, input scope
src/main.ts    One caller of mount()
```

The game renders at a fixed 960x540 and is scaled to fit the element it was
mounted into (`Phaser.Scale.FIT`, centred), so it letterboxes rather than
re-laying out. No gameplay code reads the browser window size.

Modules talk to each other over the scene event bus — see
[`src/scenes/events.ts`](./src/scenes/events.ts) — not by holding references to
each other's classes.

## Putting the game on a page

The game is a widget, not a page. `mount()` puts one into an element you own and
hands back a `destroy()` that takes it off again.

```ts
import { mount } from './src/host/index';

const game = mount({ parent: 'my-container' }); // or an HTMLElement
game.focus();   // optional: give it the keyboard. mount() never takes it
game.destroy(); // every listener, timer and audio node comes back off
```

The container needs a size of its own; the game never sets one, and never
expands the host's `<body>` to make room. Within it:

- it letterboxes inside the box and never paints outside it;
- the keyboard is scoped to the container, so a key typed into a field beside
  the game does not reach it and the game's keys do not reach the field, and a
  pointer press has to land inside the game's box to count;
- no AudioContext exists until the first click or keypress on the game;
- it pauses when the window loses focus or the tab is hidden, and resumes on
  any key or click — a pause stops the run clock, so it can neither earn score
  nor cost it (`docs/design.md` §2.5);
- two mounts on one page are two independent runs, and destroying one leaves
  the other running.

[`embed.html`](./embed.html) is the harness for checking all of that: two games
in differently-shaped boxes, next to an ordinary text field, with mount, destroy
and a mount/destroy stress button. Open `/embed.html` under `npm run dev` or
`npm run preview`.

## How to play

Aim with the mouse. Hold **Shift** or the **left mouse button** to narrow the
beam into a focused burn; release to widen it. A wide beam freezes every crawler
it touches but kills none; a focused beam burns one away after a short dwell and
drains your power. Power recharges while the beam is wide. Running out of power
does not end the run — it only stops you burning until the meter recovers.

A crawler reaching the lamp ends the run. Press **R** to go again.

### What is on screen

Readouts sit in the four corners, which is the part of the frame crawlers walk
away from rather than into.

| Corner | Reads |
| ------ | ----- |
| Top left | Lamp power, as a bar and a figure, plus a line naming what the beam is doing for it. The tick across the track is the level focus comes back at after the meter bottoms out |
| Top right | This run's score, and the best score it is chasing |
| Bottom left | Time survived |
| Bottom right | Crawlers banished, how long until the next one arrives, and how far apart they are arriving now |

The power bar is lamplight while the power is banked, ember while a focused beam
is spending it, and grey while focus is locked out and recharging to the tick.

## What is implemented so far

The whole core loop — beam aiming and focus, the power economy, crawler spawning
and movement, freeze/burn resolution, the run state machine, game over and
scoring — and the HUD and screens: the power meter, run timer, banishment count,
best score, and the title and game-over overlays. Every tuning value is read from
`src/config` per `docs/design.md` §10, including every HUD colour, size and
position.

The game-feel pass on top of it: a glow on the beam that tightens and brightens
as you focus, a ring and a flash on a crawler the moment the light catches it, an
arc that fills as a burn accumulates, a burst when one is banished, a screen
shake and a low thump when one reaches the lamp, and three short sound effects —
the freeze, the burn and the lamp hit. Every sound confirms something already on
screen, so the game loses no information with the tab muted.

And the host layer above it: `mount()` and `destroy()`, auto-pause when the
window loses focus or the tab is hidden, input scoped to the game's own
container, no audio device before the player's first gesture, and the render
space fitted to that container rather than to the window. See
[Putting the game on a page](#putting-the-game-on-a-page).

Still to come in the "Playable Vigil" milestone: the test pass.

## For agents

See [AGENTS.md](./AGENTS.md) for engine versions, folder ownership, branch/PR
rules, and the rule that all tuning values live in `src/config`.

## Assets

Assets are original or CC0 only; provenance is listed here as assets are added.
An asset with no entry in this table is a blocker, not a detail to fix later.

| Asset | Kind | Provenance | Licence |
| ----- | ---- | ---------- | ------- |
| `lamp-glow` | Radial-gradient halo, generated in code at boot ([`src/beam/glowTexture.ts`](./src/beam/glowTexture.ts)) | Original, written for this game | Same as the repository |
| `beam-glow` | Radial-gradient bloom at the beam's mouth, generated in code at boot (same helper) | Original, written for this game | Same as the repository |
| Lamp core, beam cone and halo | Phaser shape primitives drawn in code | Original, written for this game | Same as the repository |
| Crawlers, frost rings, burn arcs, bursts, ambient wash | Phaser shape primitives drawn in code | Original, written for this game | Same as the repository |
| Freeze, banish and lamp-hit sound effects | Waveforms synthesised from the `ToneSpec` values in [`src/config`](./src/config/index.ts) at boot ([`src/scenes/soundSynth.ts`](./src/scenes/soundSynth.ts)) | Original, written for this game | Same as the repository |
| HUD power meter, overlay scrims, game-over mark | Phaser shape primitives drawn in code ([`src/hud/`](./src/hud/)) | Original, written for this game | Same as the repository |
| HUD and overlay copy | Written for this game ([`src/hud/strings.ts`](./src/hud/strings.ts)) | Original | Same as the repository |
| Pause overlay scrim and text | Phaser shape primitives and copy written for this game ([`src/hud/PauseOverlay.ts`](./src/hud/PauseOverlay.ts)) | Original | Same as the repository |
| HUD typefaces | None bundled. `HUD_FONT_FAMILY` and `HUD_FONT_FAMILY_MONO` in `src/config` name system font stacks (`system-ui`, `Segoe UI`, `ui-monospace`, …) that the browser already has | No font file is downloaded, bundled or committed | n/a |

No binary or third-party art, audio or font files are in the repository, and
nothing is fetched at runtime. All placeholder programmer art is generated from
code once at boot, and so is every sound: the three cues are synthesised into
audio buffers from named constants rather than loaded from files, so there is no
third-party asset to license and nothing to go missing from a clean clone.
