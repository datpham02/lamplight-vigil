# Changelog

All notable changes to Lamplight Vigil are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Weekly board panels on title and game-over screens, sourced through the
  platform adapter and labelled with explicit board state (`loading`, `shown`,
  `unavailable`, `last known`). The local fallback is labelled as this device's
  board, and no board appears in PLAYING or Free Play game-over.
- Share-line support on title and game-over: one key press (and one click on
  game-over) copies plain text with mode, week, score and display name only; if
  clipboard write is unavailable, the same screen keeps a selectable manual-copy
  line with no dialog.
- Weekly-board controller tests covering hanging and rejecting leaderboard
  promises, plus cached-last-known behaviour and out-of-top own-rank display.
  

## [0.1.0] - 2026-11-04

First release. The "Playable Vigil" milestone: a build a stranger can clone, run,
play, lose and restart.

### Added

#### Core loop

- A fixed centre lamp casting a mouse-aimed cone of light into a dark arena, at a
  fixed 960x540 render target letterboxed to the window. [#4]
- Hold-to-focus: Shift or the left mouse button narrows the beam, release widens
  it. A wide beam freezes every crawler it touches and kills none; a focused beam
  burns one away after a short dwell. [#5]
- The power economy: focusing drains the meter, going wide recharges it. Running
  out of power does not end the run, it only locks out focus until the meter
  recovers to a rearm threshold. [#5]
- Crawlers: edge spawning on a ramping wave timer, straight seek toward the lamp,
  frozen while lit, banished after a dwell in focused light. [#5]
- Run state machine: title, play, game over on a crawler reaching the lamp,
  restart on R. Score is time survived plus crawlers banished; the best score
  persists in localStorage. [#5]
- A scene event bus as the contract between modules, so beam, enemies, HUD and
  scene code hold no references to each other. [#4][#5]

#### HUD and screens

- Four-corner readouts: lamp power as a bar and a figure with a line naming what
  the beam is doing to it, this run's score against the best, time survived, and
  crawlers banished. [#7]
- The power bar reads lamplight while power is banked, ember while a focused beam
  spends it, grey while focus is locked out and recharging to the tick. [#7]
- Title and game-over overlays with the restart prompt, and the best score on all
  three screens. [#7]
- The spawn countdown and current spawn interval are displayed, so no pressure
  the game is holding is hidden from the player. [#7]

#### Game feel

- A glow on the beam that tightens and brightens as you focus: a halo along the
  cone, a bloom at its mouth. [#6]
- A ring and a flash the moment the light catches a crawler, an arc that fills as
  a burn accumulates, a burst when one is banished. [#6]
- Screen shake and a low thump when a crawler reaches the lamp. [#6]
- Three short sound cues, freeze, banish and lamp hit, synthesised at boot from
  named constants. Each confirms something already on screen, so the game loses
  no information with the tab muted. [#6]
- A measured sub-second restart from game over to the first playable frame. [#6]

#### Balance

- The difficulty curve: a busier opening, a shallower slope, and a floor that
  bounds how hard the game ever gets, replacing the late-game wall. Five tuning
  values moved and no gameplay formula did. [#9] design, [#10] values.

#### Tooling and project

- Vite, TypeScript and Phaser 3 with a strict tsconfig, the agreed module split
  (config, beam, enemies, hud, scenes), and npm ci / dev / build / preview.
  [#1][#4]
- Every speed, radius, rate, duration, colour and score value is a named export
  in src/config, so design and QA can rebalance without touching gameplay code.
  [#5]
- A node:test suite over the pure rules: beam state machine and power economy,
  freeze and burn resolution, spawn placement and the ramps, scoring, the restart
  budget, HUD layout invariants, and the sound cues as waveforms. None of it
  imports Phaser. [#5][#6][#7]
- npm run sim: a deterministic throughput simulation that integrates the shipped
  spawn and speed curves against a three-tier model of a player and asserts the
  acceptance numbers and invariants in docs/throughput-sim.md section 7. No RNG,
  no clock, byte-identical across runs, non-zero exit on any failure. [#10]
- A QA charter and checklist carrying the milestone's automated evidence. [#8]

#### Design record

- docs/concept.md, the Board-approved GAM-1 concept verbatim, and docs/vision.md
  with the vision, the three pillars and the success criteria. [#2]
- docs/design.md, the design spec and tuning table, with the Game Director's
  amendments A1-A4, and the ruling that there is no fourth pillar. [#3]

### Notes

- All placeholder art and all three sound effects are generated in code at boot.
  No binary, third-party or fetched asset is in the repository; provenance is in
  the README.
- No backend, account, leaderboard, telemetry or analytics, per concept section 7.

[#1]: https://github.com/datpham02/lamplight-vigil/pull/1
[#2]: https://github.com/datpham02/lamplight-vigil/pull/2
[#3]: https://github.com/datpham02/lamplight-vigil/pull/3
[#4]: https://github.com/datpham02/lamplight-vigil/pull/4
[#5]: https://github.com/datpham02/lamplight-vigil/pull/5
[#6]: https://github.com/datpham02/lamplight-vigil/pull/6
[#7]: https://github.com/datpham02/lamplight-vigil/pull/7
[#8]: https://github.com/datpham02/lamplight-vigil/pull/8
[#9]: https://github.com/datpham02/lamplight-vigil/pull/9
[#10]: https://github.com/datpham02/lamplight-vigil/pull/10
[unreleased]: https://github.com/datpham02/lamplight-vigil/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/datpham02/lamplight-vigil/releases/tag/v0.1.0
