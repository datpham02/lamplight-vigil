<!--
Source of truth. This file is the approved GAM-1 game concept, copied verbatim
from the Board's approval comment on GAM-5. Do not edit it to record new
decisions: later decisions belong in docs/vision.md, docs/design.md or a new
issue. Changing this file means the Board changed the concept.

One exception, and only this one: where a later Board decision makes a sentence
here false on its face, a dated ANNOTATION block may be added immediately after
it, pointing at the document that now holds the boundary. An annotation never
edits, deletes or restates the GAM-1 text it follows, and it is always visibly
marked as not part of that text. Adding one requires a Board decision to cite.
Current annotations: section 4 (GAM-16, 2026-11-04).
-->

## Game Concept for Board approval

Per project-initialization step 1. No projects, repositories, agents or issues were created.

### 1. Working title
**Lamplight Vigil**

### 2. Project ID
`lamplight-vigil` (15 chars, kebab-case, valid as `datpham02/lamplight-vigil`)

### 3. Pitch
You are the last lamp in a dark hollow, and the only thing you can move is your light. Creatures crawl in from every edge and freeze the instant your beam touches them, but a wide beam only holds them still, while a narrowed beam burns them away and drains your power. Every run is a ninety-second argument with yourself about where to point the light.

### 4. Genre and target platform
Single-screen 2D arcade survival, top-down, score-attack. Desktop web browser (Chrome, Firefox, Edge), mouse and keyboard. Phaser 3 with TypeScript, built with Vite and npm. Static output, no backend, no accounts, no online features.

> **ANNOTATION — 2026-11-04. Not part of the GAM-1 text above.**
> The sentence *"Static output, no backend, no accounts, no online features"* no
> longer describes the project's scope. The Board approved the "Online Vigil"
> amendment (GAM-16) on 2026-11-04, moving a hosted backend, an anonymous
> online identity, a weekly leaderboard and public static hosting **in**. The
> GAM-1 sentence is left intact as the record of what the concept said; the
> current boundary is `docs/vision.md` **§5b — Milestone boundary, "Online
> Vigil"**. Telemetry, analytics, ads, payments and store publishing remain out.
> One decision from that amendment, **D4 — provider and hosting — is still
> pending with the Board**, so no provider is named anywhere.

### 5. Three design pillars
1. **Light is the only verb.** Every mechanic is a way of aiming or shaping the beam. No walking, no weapons, no inventory, no upgrade shop. If a feature cannot be expressed as something you do with light, it does not belong in this game.
2. **Readable at a glance.** The whole threat picture fits on one unscrolling screen. A player who dies must know why within a second: no off-screen deaths, no hidden state.
3. **One more sweep.** Runs target 45 to 120 seconds, restart is one keypress and under a second, and your best score is always on screen.

### 6. Core gameplay loop
1. Your lamp sits fixed at the centre of a dark arena. You aim a cone of light with the mouse.
2. Crawlers spawn at the screen edges and move steadily toward the lamp.
3. A crawler touched by the **wide beam** freezes while lit and resumes the moment the light leaves it. Wide light holds many, kills none.
4. Holding a key narrows the beam into a **focused** beam: far less coverage, but it burns a crawler away after a short dwell. Focusing drains your power meter, releasing recharges it.
5. The loop is constant triage: sweep wide to buy time, or commit to a narrow burn and accept that everything else keeps walking.
6. A crawler reaching the lamp ends the run. Score is time survived plus crawlers banished. Press R and go again.

### 7. MVP scope
**In**
- One scene, fixed 960x540 render target, scaled to the window.
- Centre lamp, mouse-aimed beam, hold-to-focus with a power meter (drains focused, recharges wide).
- One enemy type (crawler): edge spawn on a wave timer, straight seek to centre, frozen while lit, burned after a dwell in focused light.
- Lose on a crawler touching the lamp. Score plus best score in `localStorage`.
- Title, play, game-over, instant restart.
- Placeholder programmer art: simple shapes and generated textures, three-colour dark palette, a few short sound effects.
- Vite, TypeScript, Phaser 3, strict tsconfig, `npm ci` / `npm run dev` / `npm run build`, README that gets a stranger running in two commands.
- All tuning values in one config module so design and QA can rebalance without touching gameplay code.

**Explicitly out** (candidates for later milestones)
- More enemy types, bosses, enemy variety of any kind.
- Upgrades, meta-progression, unlocks, currencies, roguelite structure.
- Any backend, account, leaderboard, telemetry or analytics.
- Mobile, touch and gamepad support.
- Music, narrative, cutscenes, dialogue.
- Multiple levels, a level editor, procedural generation beyond spawn randomisation.
- Advanced lighting (Light2D pipeline, custom shaders). Masks and alpha only.
- CI, deployment, itch.io or Steam publishing.
- Save data beyond one best score.

### 8. First milestone: "Playable Vigil"
A build a stranger can clone, run, play, lose and restart.

| # | Task | Role |
|---|---|---|
| 1 | **Design spec and tuning table** in `docs/design.md`: state machine, wide vs focused beam angles, crawler speed and spawn curve, drain and recharge rates, burn dwell, scoring formula. Produces the constants task 3 consumes. | `game-designer` |
| 2 | **Project skeleton.** Vite, TypeScript, Phaser 3, npm scripts, strict tsconfig, agreed module split (`config`, `beam`, `enemies`, `hud`, `scenes`), scaled canvas, lamp and beam rendering, README. | `gameplay-programmer` |
| 3 | **Core loop.** Beam aiming, focus toggle, power meter, crawler spawner and movement, lit/frozen/burn resolution, lamp collision to game over, scoring. Values read from the task 1 config module. | `gameplay-programmer` |
| 4 | **HUD and screens.** Power meter, timer, banishment count, title and game-over overlays, restart prompt, best score. Dark three-colour palette, legible at 960x540 and scaled up. | `ui-designer` |
| 5 | **Game feel pass.** Beam glow, freeze and burn feedback, screen shake on a lamp hit, sound hooks, sub-second restart. | `gameplay-programmer` |
| 6 | **Test pass.** Charter and checklist on Chrome, Firefox and Edge: fail and restart loop, power meter edge cases (drain at zero, rapid toggling), ten-minute stability run, clean-clone install, build and preview. File defects with repro steps. | `qa` |

Tasks 1 and 2 run in parallel. Task 3 depends on both, tasks 4 and 5 depend on 3, task 6 closes the milestone.

### 9. Main risks
- **Fun risk: a game with no movement may feel passive.** Highest risk here. Mitigation: a short parameter spike in task 1 and a playtest gate at the end of task 3. If the loop is flat after tuning, the pre-agreed pivot is beam-rotation inertia so aiming has weight, not more systems.
- **Readability.** A dark screen lit by a cone can become unreadable. Mitigation: a minimum ambient floor and strong silhouettes, owned by `ui-designer` and checked by `qa`.
- **Scope creep toward a roguelite.** Mitigation: the out-list is binding, and additions need my approval against pillar 1.
- **Parallel agents colliding on one scene file.** Mitigation: the module split is fixed in task 2 before tasks 3 to 5 start, each task owning named files.
- **Performance.** Overlapping alpha, glow and per-frame texture generation hurt frame rate. Mitigation: cap concurrent crawlers, generate textures once at boot, make 60 fps a QA acceptance criterion.
- **Public-repo asset licensing.** Mitigation: original or CC0 assets only, provenance in the README, nothing scraped or uncleared.
- **Originality.** Light-as-a-weapon and freeze-while-lit mechanics exist elsewhere. Mitigation: the wide-versus-focused power trade-off is ours, and we copy no existing title's name, art, levels or text.

---

**Board decision requested:** approve as written, or request changes. On approval I will propose the Game Project and have `game-designer` write the vision and pillars document for my approval.
