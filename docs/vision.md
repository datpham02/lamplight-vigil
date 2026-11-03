# Lamplight Vigil — Vision and Pillars

Owner: `game-designer`. Approval: `game-director`. Pillar changes escalate to the
Game Director; scope changes escalate to the `producer`.

> **Verification needed before approval.** The agent that wrote this could not read
> issue GAM-1 from its run (the Paperclip API was not reachable). Sections 3
> (pillars), 4 (core loop) and 5 (MVP boundary) are reconstructed **from the
> concept text already merged into `AGENTS.md` and `README.md`**, not copied from
> GAM-1. Game Director: please check them against GAM-1 and correct any drift.
> Nothing here is intended as a scope change; proposals are marked **[PROPOSAL]**.

## 1. Vision statement

Lamplight Vigil is a single-screen arcade survival game about the discipline of
aiming a light. You are the last lamp in a dark hollow. You cannot move, run, or
strike — the only thing you control is your beam. Creatures crawl in from every
edge and stop dead while your light touches them, so a wide beam buys you time
across the whole field but kills nothing, while narrowing the beam burns a
creature away and spends the power keeping you alive. Every second is the same
small, sharp decision made under pressure: hold the line, or spend to clear it.
The game is over in a few minutes, the failure is always legible, and the restart
is instant.

**Target player.** Someone on a desktop browser with five spare minutes who likes
pure, readable arcade score-attack — the audience for Missile Command, Geometry
Wars, or Vampire Survivors' first ten minutes. They want depth from one mechanic,
not a tutorial. They will play six runs in a sitting and want to beat their own
number.

## 2. How to read the pillars

A pillar is a veto. If a proposed feature fails a pillar, it does not ship without
Game Director approval to change the pillar itself. Each pillar below carries a
check QA can run without reading gameplay code.

## 3. The three pillars

### Pillar 1 — Your only weapon is where you look

**What it means.** The lamp is fixed. One hundred percent of player agency flows
through aiming the beam and shaping it. We never solve a design problem by giving
the player a second verb.

- **Do:** make a threat answerable by *where* and *when* you point, not by a
  button the player does not have.
- **Do:** express difficulty as a geometry problem — two threats on opposite
  edges, one beam.
- **Don't:** add a dash, a bomb, a shield, a turret, or lamp movement.
- **Don't:** add a passive effect that clears creatures without the beam touching
  them.

**QA check.** Bind every input the build accepts. Confirm that each one only aims
the beam or changes its width, and that no input removes, damages, or repels a
creature the beam is not touching. Any third effect is a pillar failure.

### Pillar 2 — Width is the whole economy

**What it means.** Wide holds, narrow kills, narrow costs power. That single
tradeoff is the game's entire resource system. Everything the player wants must be
paid for in beam width and power, never in a separate currency.

- **Do:** tune pressure by changing what the wide/narrow choice costs — drain
  rate, freeze radius, creature speed.
- **Do:** make the cost of a kill legible in the moment the player pays it.
- **Don't:** introduce ammo, cooldowns, charges, pickups, or an upgrade currency.
- **Don't:** let a wide beam kill, or a narrow beam be free.

**QA check.** Hold a wide beam on a creature for 30 seconds: it must stay frozen
and must not die, and power must not fall from freezing alone. Narrow onto that
same creature: it must die, and the power readout must visibly drop during the
burn. Either half failing is a pillar failure.

### Pillar 3 — The dark is honest

**What it means.** The hollow is dark, but the game never cheats with that
darkness. One screen, no camera, no off-screen spawns, no death the player could
not have seen coming. Darkness is tension, never a withheld fact.

- **Do:** give every creature a visible tell at the screen edge before it is a
  threat.
- **Do:** keep power, score, and run state readable at a glance while the player's
  eyes are on the beam.
- **Don't:** spawn a creature already inside the play field, or scroll/zoom the
  camera.
- **Don't:** rely on an audio cue alone for information the player needs to act on.

**QA check.** Record a run. For every creature that reaches the lamp, step back
through the footage and confirm it was visible on screen for at least 1.5 seconds
before contact, and that it entered from an edge. Any creature failing either test
is a pillar failure.

## 4. Core loop

*Reconstructed — verify against GAM-1.*

1. Creatures enter from the screen edges and crawl toward the lamp at the centre.
2. The player sweeps a **wide** beam to freeze whatever is closest to arriving.
   Frozen creatures do not advance; nothing dies.
3. The player picks a moment to **narrow** the beam onto a single creature,
   burning it away and draining lamp power.
4. The player must widen again before an unattended creature closes the distance.
5. Score accrues over the run. The run ends and restarts immediately.

**Open in GAM-1 and raised in section 7:** whether power regenerates, and the
exact run-end condition (a creature reaching the lamp, power hitting zero, or
both). This document does not assume an answer.

## 5. MVP boundary — milestone "Playable Vigil"

*Reconstructed — verify against GAM-1. Do not treat as approved scope until the
Game Director confirms it.*

**In**

- One fixed lamp at the centre of a 960x540 single screen.
- Beam aiming and continuous beam-width control.
- Creatures spawning from all four edges with one movement behaviour.
- Freeze on wide-beam contact; burn on narrow-beam contact.
- Lamp power as a drainable resource spent by burning.
- Score, run-end, and immediate restart.
- HUD: power, score, run-state messaging.

**Out (explicitly, for this milestone)**

- Multiple creature types or behaviours.
- Upgrades, unlocks, meta-progression, or persistent save data.
- Audio, music, and narrative framing.
- Menus beyond what restart needs; options screens; mobile or touch input.
- Multiple levels, arenas, or a camera of any kind.

## 6. Success criteria — "Playable Vigil"

QA can test each of these directly.

| # | Criterion | Measure |
|---|---|---|
| 1 | Restart is instant | ≤ 1.0 s from input to a playable run; ≤ 2 inputs from death to playing |
| 2 | Run length | Median first-time run 45–120 s; a practised player can exceed 3 minutes |
| 3 | Frame rate | Sustained 60 fps at 960x540 in a current desktop Chrome/Firefox on mid-range hardware, measured at peak on-screen creature count; no frame under 30 fps |
| 4 | Readability | Every creature is on screen ≥ 1.5 s before it can reach the lamp (pillar 3 check) |
| 5 | Mechanic legibility | 5 of 5 fresh playtesters correctly describe the wide-holds / narrow-kills-and-costs tradeoff after one run, unprompted |
| 6 | Failure legibility | 5 of 5 playtesters correctly name what killed them immediately after a run |
| 7 | No scaling bugs | The game is fully playable and correctly letterboxed at window sizes from 640x360 up to 2560x1440 |
| 8 | Tuning rule holds | Every speed, radius, rate, duration, colour and score value is a named export in `src/config` (per `AGENTS.md`) |

## 7. Open design questions (later milestones)

1. **Power regeneration.** Does power recover over time, on kills, on holding
   wide, or not at all? This decides whether the game is attrition or budgeting.
2. **Run-end condition.** Creature contact, power exhaustion, or both — and is
   there a grace state between?
3. **Difficulty curve.** Continuous ramp, or discrete waves with lulls? Pillar 2
   says pressure comes from the cost of the width choice, not from new systems.
4. **Score formula.** Does narrowing to kill score more than surviving, and should
   killing at maximum narrowness pay a precision bonus?
5. **Creature variety.** Pillar 1 permits creatures that *re-pose the geometry
   problem* (faster, splitting, freeze-resistant). Which, if any, earn their
   complexity after MVP?
6. **Input device.** Mouse-aim versus keyboard-aim changes the feel of pillar 1
   completely; needs a playtest comparison, not a desk decision.
7. **Audio.** Pillar 3 forbids audio-only information, but audio could carry
   *confirmation* (the burn, the freeze). What is the minimum useful set?
8. **[PROPOSAL] Pause.** A browser game loses focus constantly. I propose an
   auto-pause on window blur for the milestone after Playable Vigil; it touches
   nothing in the MVP scope above.
