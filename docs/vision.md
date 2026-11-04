# Lamplight Vigil — Vision and Pillars

Owner: `game-designer`. Approval: `game-director`. Pillar changes escalate to the
Game Director; scope changes escalate to the `producer`.

**Source of truth:** [`docs/concept.md`](./concept.md) is the Board-approved GAM-1
concept, verbatim. Sections 3, 4 and 5 below are that concept, restated for
implementers. Where this document adds anything the concept does not say, it is
marked **[PROPOSAL]** and is not approved scope.

**Amendments.** The Board can change scope without changing the concept. Such a
change is recorded here as a dated, numbered amendment section, and the lines it
supersedes in §5 are annotated in place rather than deleted, so the earlier
boundary stays readable as what it was. One amendment is in force:

| Amendment | Decision | Date | Status |
|---|---|---|---|
| [§5b — "Online Vigil"](#5b-milestone-boundary--online-vigil) | GAM-16 | 2026-11-04 | Approved scope, except D4 (provider and hosting), which is pending |

An amendment section is approved scope and is **not** marked **[PROPOSAL]**.

## 1. Vision statement

Lamplight Vigil is a single-screen arcade survival game about the discipline of
aiming a light. You are the last lamp in a dark hollow. You cannot move, run, or
strike — the only thing you control is your beam. Crawlers come in from every
edge and freeze while your light touches them, so a wide beam buys you time
across the whole field but kills nothing, while a focused beam burns a crawler
away and drains the power keeping you alive. Every second is the same small,
sharp decision made under pressure: hold the line, or spend to clear it. A run is
over in a minute or two, the failure is always legible, and the restart is one
keypress.

**Target player.** Someone on a desktop browser with five spare minutes who likes
pure, readable arcade score-attack — the audience for Missile Command, Geometry
Wars, or Vampire Survivors' first ten minutes. They want depth from one mechanic,
not a tutorial. They will play six runs in a sitting and want to beat their own
number.

## 2. How to read the pillars

A pillar is a veto. If a proposed feature fails a pillar, it does not ship
without Game Director approval to change the pillar itself. The three pillar
names below are GAM-1's and are canonical; the "what it means", do/don't
examples and QA checks are this document's elaboration, and each QA check is
runnable without reading gameplay code.

## 3. The three pillars

### Pillar 1 — Light is the only verb

> Every mechanic is a way of aiming or shaping the beam. No walking, no weapons,
> no inventory, no upgrade shop. If a feature cannot be expressed as something
> you do with light, it does not belong in this game. *(GAM-1)*

**What it means.** The lamp is fixed at the centre. One hundred percent of player
agency flows through aiming the beam and shaping it. We never solve a design
problem by giving the player a second verb.

- **Do:** make a threat answerable by *where* and *when* you point, not by a
  button the player does not have.
- **Do:** express difficulty as a geometry problem — two crawlers on opposite
  edges, one beam.
- **Don't:** add a dash, a bomb, a shield, a turret, or lamp movement.
- **Don't:** add a passive effect that clears crawlers without the beam touching
  them.

**QA check.** Exercise every input the build accepts. Confirm each one only aims
the beam or switches it between wide and focused, and that no input removes,
damages, or repels a crawler the beam is not touching. Any third effect is a
pillar failure.

### Pillar 2 — Readable at a glance

> The whole threat picture fits on one unscrolling screen. A player who dies must
> know why within a second: no off-screen deaths, no hidden state. *(GAM-1)*

**What it means.** The hollow is dark, but the game never cheats with that
darkness. One screen, no camera, no off-screen spawns, no death the player could
not have seen coming. Darkness is tension, never a withheld fact.

- **Do:** give every crawler a visible tell at the screen edge before it is a
  threat.
- **Do:** keep power, score, and run state readable at a glance while the
  player's eyes are on the beam.
- **Don't:** spawn a crawler already inside the play field, or scroll/zoom the
  camera.
- **Don't:** rely on an audio cue alone for information the player needs to act
  on, and don't hold state (power, a burn timer, a spawn warning) that the screen
  never shows.

**QA check.** Record a run. For every crawler that reaches the lamp, step back
through the footage and confirm it entered from an edge and was visible on screen
for at least 1.5 seconds before contact. Then, in a live run, have the tester name
what killed them within one second of the game-over screen appearing. Any crawler
or any death failing those tests is a pillar failure.

### Pillar 3 — One more sweep

> Runs target 45 to 120 seconds, restart is one keypress and under a second, and
> your best score is always on screen. *(GAM-1)*

**What it means.** The game's retention comes from cycle speed, not from
progression. The gap between dying and playing again must be too short to think
in, and the number to beat must already be in front of the player when they die.

- **Do:** tune spawn pressure so an average run lands inside the 45–120 s window.
- **Do:** show best score on the title screen, during play, and on game over.
- **Don't:** add a death animation, confirmation prompt, menu step, or asset load
  between the lose state and the next playable frame.
- **Don't:** add meta-progression or unlocks to manufacture a reason to replay.

**QA check.** From the game-over screen, press R and time to the first playable
frame: one keypress, under 1.0 s, no intermediate screen. Then confirm the best
score is visible on the title, play and game-over screens, and that it survives a
page reload (`localStorage`). Play ten runs as a first-time player and confirm the
median lands in 45–120 s. Any of the three failing is a pillar failure.

### Considered and not adopted — "Width is the whole economy"

**Ruling: not adopted as a pillar.** Decided by `game-director` in the review of
`docs/design.md` (GAM-8). This is settled and is no longer an open Game Director
decision. There are three pillars, and the three above are all of them.

**What was proposed.** Wide holds, focused burns, focusing costs power, releasing
recharges it — and that single trade-off is the game's entire resource system.
Everything the player wants is paid for in beam width and power, never in a
separate currency. As a pillar it would have forbidden ammo, cooldowns, charges,
pickups and upgrade currencies outright, rather than leaving them to be argued
case by case under pillar 1.

**Why it was not adopted.**

1. **Procedural.** `docs/concept.md` §5 says "Three design pillars" and is
   Board-approved. A fourth pillar is a change to the concept, and therefore the
   Board's call — not the Game Director's to make alone.
2. **Substantive.** It is redundant. Pillar 1 already forbids ammo, cooldowns,
   charges and pickups, because none of them can be expressed as aiming or
   shaping the beam. `docs/design.md` ran the full length of the MVP and never
   needed a fourth veto.

**Its QA check survives, carrying no veto.** Keep it as an ordinary correctness
test of the core loop in §4 below — not as a pillar check. Hold a wide beam on a
crawler for 30 seconds: it must stay frozen, must not die, and power must not fall
from freezing alone. Then focus onto that same crawler: it must die after the
dwell, and the power readout must visibly drop during the burn, then recover on
release. A failure here is a core-loop bug to be filed against the build. It is
not a pillar failure, and nothing about it carries pillar authority.

## 4. Core loop

From `docs/concept.md` §6.

1. The lamp sits fixed at the centre of a dark arena. The player aims a cone of
   light with the mouse.
2. Crawlers spawn at the screen edges and move steadily toward the lamp.
3. A crawler touched by the **wide beam** freezes while lit and resumes the moment
   the light leaves it. Wide light holds many, kills none.
4. Holding a key narrows the beam into a **focused** beam: far less coverage, but
   it burns a crawler away after a short dwell. Focusing drains the power meter;
   releasing recharges it.
5. The loop is constant triage: sweep wide to buy time, or commit to a narrow burn
   and accept that everything else keeps walking.
6. A crawler reaching the lamp ends the run. Score is time survived plus crawlers
   banished. Press R and go again.

## 5. MVP boundary — milestone "Playable Vigil"

From `docs/concept.md` §7. A build a stranger can clone, run, play, lose and
restart. **This milestone has shipped** (`v0.1.0`). The section is kept as the
record of what Playable Vigil was; it is not the current scope boundary. For the
next milestone see [§5b](#5b-milestone-boundary--online-vigil) — three lines of
the out-list below are annotated in place where GAM-16 moved them in.

**In**

- One scene, fixed 960x540 render target, scaled to the window.
- Centre lamp, mouse-aimed beam, hold-to-focus with a power meter (drains focused,
  recharges wide).
- One enemy type (crawler): edge spawn on a wave timer, straight seek to centre,
  frozen while lit, burned after a dwell in focused light.
- Lose on a crawler touching the lamp. Score plus best score in `localStorage`.
- Title, play, game-over, instant restart.
- Placeholder programmer art: simple shapes and generated textures, three-colour
  dark palette, a few short sound effects.
- Vite, TypeScript, Phaser 3, strict tsconfig, `npm ci` / `npm run dev` /
  `npm run build`, README that gets a stranger running in two commands.
- All tuning values in one config module so design and QA can rebalance without
  touching gameplay code.

**Explicitly out** (candidates for later milestones)

- More enemy types, bosses, enemy variety of any kind.
- Upgrades, meta-progression, unlocks, currencies, roguelite structure.
- ~~Any backend, account, leaderboard, telemetry or analytics.~~ →
  **Backend, anonymous account and leaderboard moved in by GAM-16 (Board,
  2026-11-04); see §5b. Telemetry and analytics stay out.**
- Mobile, touch and gamepad support.
- Music, narrative, cutscenes, dialogue.
- Multiple levels, a level editor, procedural generation beyond spawn
  randomisation.
- Advanced lighting (Light2D pipeline, custom shaders). Masks and alpha only.
- ~~CI, deployment, itch.io or Steam publishing.~~ →
  **Public static hosting and deploy moved in by GAM-16; see §5b. Store
  publishing stays out.**
- ~~Save data beyond one best score.~~ →
  **Weekly best and a display name moved in by GAM-16; see §5b.**

## 5b. Milestone boundary — "Online Vigil"

**Status: approved scope.** Planned in GAM-16; approved by the Board on
**2026-11-04**. This section, not §5, is the current scope boundary. It is
recorded here rather than in `docs/concept.md` because that file is the verbatim
GAM-1 concept and its §7 is the record of a milestone that has now shipped;
rewriting it would make the project's history unreadable. The concept's §4
sentence *"no backend, no accounts, no online features"* carries a dated
annotation pointing here.

> **One decision is still open.** **D4 — provider and hosting — is pending with
> the Board.** No provider, vendor, SDK or service name appears in this section,
> and nothing built against it may name or assume one. Until D4 lands, the
> backend is reachable only as the abstract capability described in item 5
> below. Any task that needs a concrete provider is blocked on D4, not on this
> document.

### 5b.1 In

1. **Weekly seeded run.** A weekly seed derived from the week key gives every
   player the same crawler pattern for that week. **Free Play keeps an unseeded
   run and is unranked.**
2. **Weekly modifier** — *conditional*. In scope **if and only if** it survives
   the bounds set for it in GAM-16. If it does not, it is out and this line is
   struck, not renegotiated.
3. **Online leaderboard** — the weekly board, shown on the **title and
   game-over screens only**, plus each player's personal all-time best.
4. **An online player identity** — anonymous on creation, optionally linked to a
   real account later. **Display name only.**
5. **A hosted backend-as-a-service** — no self-run server. Reached *only*
   through the platform adapter defined in GAM-16 (see item 9). Provider is D4
   and is pending.
6. **Public static hosting** of the build, and the deploy step that puts it
   there. The hosting target is part of D4 and is pending.
7. **Offline-first as a requirement, not a nicety.** The game stays fully
   playable with the network off or the backend down. This is **new scope that
   must be built and tested**, not an assumed property of the existing build.
8. **Share line** — a copyable text result. Stays, as the Board asked.
9. **Website-readiness contract** — the platform adapter, `mount()` /
   `destroy()`, a game manifest, and host-friendly behaviour, as specified in
   GAM-16.
10. **CI, bounded.** CI moves in **only** as far as build-and-deploy on merge to
    `main`, **gated on `npm run build` and `npm test` passing** — the existing
    commands, nothing new. Public hosting forces deployment in, and without that
    gate the first broken merge is live to strangers. Anything beyond that gate
    (matrix builds, new test runners, release automation, status bots) is out of
    this milestone.

### 5b.2 Out — reaffirmed

Reaffirmed by the Board as out for "Online Vigil". These are vetoes, not
backlog.

- Telemetry and analytics inside the game.
- **Ads inside the game, at any point — including the title and game-over
  screens.** Board decision; untouched by anything above.
- Payments and in-game purchases.
- Chat, friends, any social graph.
- Personal data beyond a display name. Email only if the player chooses to link
  an account.
- Replay recording and replay verification.
- Server-authoritative gameplay.
- Mobile, touch and gamepad.
- Music.
- More enemy types.
- Meta-progression, unlocks and currencies.
- Store publishing (itch.io, Steam).

### 5b.3 Boundary acceptance criteria

These test the **boundary**, not the features. Feature-level criteria belong to
the design document for each item and are written per task. QA can run every
check below against a build plus the repository, without reading gameplay code.
A failure here is a scope breach and is filed against the milestone.

| # | Criterion | How QA tests it |
|---|---|---|
| B1 | No provider is named while D4 is pending | Search the repository (`src/`, `tools/`, `docs/`, config, CI files, `package.json`) for any backend or hosting vendor, SDK or service name. Zero hits outside a document that explicitly records D4 as pending. Any hit is a breach of the D4 gate. |
| B2 | Backend access is adapter-only | Every network call in `src/` originates inside the platform adapter module. No `fetch`, `XMLHttpRequest`, WebSocket or vendor SDK call appears in `src/beam`, `src/enemies`, `src/hud`, `src/scenes` or `src/main.ts`. |
| B3 | Offline-first holds | With the network disabled in devtools, and again with the backend unreachable: title → play → lose → restart completes, best score still persists, and no error dialog, hang, or wait longer than the configured timeout blocks play. Repeat with the network restored mid-run; the run must not be disturbed. |
| B4 | Free Play is unseeded and unranked | Two Free Play runs started in the same week produce different crawler patterns, and neither submits a score to the weekly board. |
| B5 | Weekly seed is shared | Two clients starting a weekly run in the same week key produce the identical crawler pattern for at least the first 60 s. Across a week boundary, the pattern changes. |
| B6 | Leaderboard placement | The weekly board appears on the title and game-over screens and **nowhere else** — it is not on screen during play, and no HUD element shows it. |
| B7 | Identity is display-name-only | Creating an identity requires no input beyond an optional display name, collects no email, and the stored player record contains no personal field other than the display name. Linking a real account is optional and never a precondition for playing or for appearing on the board. |
| B8 | No ads anywhere | Inspect the title, play, game-over and share flows, plus the built `dist/` output and the hosted page. Zero ad units, ad SDKs, ad network scripts or sponsored placements. Any hit is a pillar-level breach. |
| B9 | No telemetry | With the network enabled, record all outbound requests across a full session (title → three runs → share). Every request is to the leaderboard or identity capability. No analytics, event, or session-tracking request exists. |
| B10 | CI stays bounded | The CI configuration runs `npm run build` and `npm test`, deploys only on merge to `main`, and deploys nothing when either command fails. Confirm by merging a deliberately failing branch to a test branch target: no deploy occurs. |
| B11 | Share line is copyable text | The share action yields plain text the tester can paste into a text editor unchanged. It is text, not an image, and it opens no third-party dialog. |
| B12 | Website-readiness contract | The game mounts into a host-supplied element via `mount()`, releases every timer, listener and audio handle on `destroy()`, and can be mounted again afterwards in the same page without error. A game manifest is present and parses. |
| B13 | Pillars still hold | §3's three pillar QA checks still pass on the Online Vigil build. The weekly seed, the board and the identity add no input that aims, shapes, or substitutes for the beam. |

**Note on B1.** This check expires when the Board decides D4. It is a gate on
the pending decision, not a permanent rule.

**Note on 5b.1 item 2.** Until the weekly modifier clears its GAM-16 bounds, QA
has nothing to test for it and should not write criteria against it. It has no
boundary check above by design.

## 6. Success criteria — "Playable Vigil"

QA can test each of these directly.

| # | Criterion | Measure |
|---|---|---|
| 1 | Restart is instant | One keypress (R) from game over to the first playable frame, in ≤ 1.0 s, with no intermediate screen |
| 2 | Run length | Median first-time run 45–120 s; a practised player can exceed 3 minutes |
| 3 | Frame rate | Sustained 60 fps at 960x540 in current desktop Chrome, Firefox and Edge on mid-range hardware, measured with the configured maximum concurrent crawler count on screen; no frame under 30 fps |
| 4 | Readability | Every crawler is on screen ≥ 1.5 s before it can reach the lamp, and enters from an edge (pillar 2 check) |
| 5 | Mechanic legibility | Every playtester in the cohort correctly describes the wide-holds / focused-burns-and-costs trade-off after one run, unprompted |
| 6 | Failure legibility | Every playtester in the cohort correctly names what killed them within one second of the game-over screen |
| 7 | No scaling bugs | Fully playable and correctly letterboxed at window sizes from 640x360 up to 2560x1440 |
| 8 | Best score persists | Best score is visible on title, play and game-over screens and survives a page reload |
| 9 | Tuning rule holds | Every speed, radius, rate, duration, colour and score value is a named export in `src/config` (per `AGENTS.md`) |

**Notes on measurement.**

- Criterion 3 is only reproducible once the crawler cap is a named constant in
  `src/config`. The design spec (concept §8 task 1) sets it; QA stress-tests at
  that number.
- Criteria 5 and 6 need a cohort. `producer` to name one before "Playable Vigil"
  is scheduled, or to approve a proxy — the workable one is three people who have
  not seen the game, drawn from outside the project. A gate with no cohort cannot
  pass and would stall the milestone.

## 7. Resolved by the concept

Recorded so they are not reopened. All three are settled in `docs/concept.md`:

- **Power regeneration.** Focusing drains, releasing recharges (§6.4). Rates are a
  tuning question for `docs/design.md`, not an open design question.
- **Run-end condition.** A crawler reaching the lamp, and only that (§6.6). Power
  reaching zero does not end the run; it ends the ability to burn.
- **Input device.** Mouse aim, hold-a-key to focus (§6.1, §6.4, §7). This also
  settles the Game Director's open question from the GAM-5 review in favour of
  mouse aim.

## 8. Open design questions (later milestones)

1. **Difficulty curve.** The wave timer exists in MVP scope, but its shape is
   open: continuous ramp, or discrete waves with lulls? Pillar 1 says pressure
   comes from the cost of the width choice, not from new systems.
   **Still open after GAM-17.** That rebalance retuned the continuous ramp's
   *values* — a busier opening, a shallower slope, and a floor that bounds how
   hard the game ever gets (`docs/design.md` §5.4 and §11.1) — and deliberately
   did not touch the ramp-versus-waves question.
2. **Score formula weighting.** Score is time survived plus crawlers banished
   (§6.6); the relative weight is unset, as is whether a burn completed at the
   last moment before contact should pay a precision bonus.
3. **Crawler variety.** Pillar 1 permits enemies that *re-pose the geometry
   problem* (faster, splitting, freeze-resistant). Explicitly out of MVP. Which,
   if any, earn their complexity afterwards?
4. **Audio beyond confirmation.** MVP ships a few short sound effects; music is
   out. Pillar 2 forbids audio-only information, so what is the minimum useful set
   of confirmations (the burn, the freeze, the lamp hit)?
5. **The passivity risk.** Concept §9 names the pre-agreed pivot if the loop feels
   flat after tuning: beam-rotation inertia, so aiming has weight. The playtest
   gate at the end of task 3 decides whether we take it.
6. **[PROPOSAL] Auto-pause on window blur.** A browser game loses focus
   constantly. Proposed for the milestone after Playable Vigil; it touches nothing
   in the MVP scope above. Sequencing is `producer`'s call.
