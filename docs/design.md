# Lamplight Vigil — Design Spec and Tuning Table

Milestone: **Playable Vigil** ([`docs/concept.md`](./concept.md) §8, row 1).
Owner: `game-designer`. Approval: `game-director`.

**Where this sits.** [`docs/concept.md`](./concept.md) is the Board-approved concept
and is the source of truth for *what the game is*. [`docs/vision.md`](./vision.md)
holds the pillars and the milestone success criteria. This document holds *how it
behaves and what the numbers are*, and is the spec the core-loop task (concept §8
row 3) implements against. Where the three disagree, concept wins, then vision,
then this file.

Pillar changes escalate to `game-director`. Scope changes escalate to `producer`.
Retuning a value inside the ranges in §10 is mine and needs no escalation.

**Reading order for an implementer.** §10 is the contract — every number in this
document appears there as a named export. §2–§8 explain what each number governs
and the rules that bind them. §11 shows the arithmetic behind the balance so you
can tell a deliberate value from a typo.

---

## 1. Scope of this document

**In.** Run state machine, beam state machine, beam geometry, crawler movement and
spawning, the power economy, freeze and burn resolution, scoring, and the full
tuning table.

**Out, and deliberately so.**

- Everything on the "Explicitly out" list in `docs/concept.md` §7.
- The open design questions in `docs/vision.md` §8: difficulty-curve *shape*
  beyond the MVP wave timer, score precision bonus, crawler variety, audio beyond
  confirmation, auto-pause on blur. §6 below ships a continuous ramp precisely
  because the ramp-versus-discrete-waves question is open and not mine to close.
- Visual and audio direction. This document names the colour and alpha constants
  that gameplay code reads and gives them initial values; `ui-designer` owns the
  final palette in the HUD-and-screens task (concept §8 row 4).
- Beam-rotation inertia. It is the pre-agreed contingency pivot for the passivity
  risk and is recorded in §9.3 as a contingency only. **Do not implement it.**

**No new verb.** The player's complete input surface is in §7: aim the beam, shape
the beam, start, restart. Nothing in this document removes, damages, slows or
repels a crawler that the beam is not touching.

---

## 2. Run state machine

Four states. One scene owns the state; per-run state resets in `init()`, not in
the constructor (`AGENTS.md`).

```
            any key / click                crawler contacts lamp
   TITLE ─────────────────────▶ PLAYING ──────────────────────────▶ GAME_OVER
     ▲                            ▲                                     │
     │                            └──────── R, after lockout ───────────┘
     └──── (never returns to title during a session)
```

### 2.1 TITLE

Entered at boot. Shows the game name, the control summary, and the best score.
No crawlers exist, no timer runs, no power drains. Any key or any click enters
PLAYING.

### 2.2 PLAYING

The only state in which the world updates.

**Reset on every entry to PLAYING** (both from TITLE and from GAME_OVER):

| Thing | Reset to |
| --- | --- |
| Elapsed run time | `0` |
| Score | `0` |
| Crawlers banished | `0` |
| All live crawlers | destroyed; list empty |
| Lamp power | `POWER_START` |
| Beam state | `WIDE`, at `BEAM_WIDE_ANGLE_DEG` / `BEAM_WIDE_RANGE` |
| Beam aim | the current pointer position, applied before the first frame renders |
| Spawn interval | `SPAWN_INTERVAL_START` |
| Next spawn timer | `SPAWN_FIRST_DELAY` |
| Focus input | **disarmed** — see the edge-trigger rule below |

**Explicitly not reset:** the best score, and anything in `localStorage`.

Beam aim is reset *to the live pointer position* rather than to a fixed heading so
the first frame of a restart is never a beam pointing somewhere the player is not
looking. This matters for the sub-second restart feel in pillar 3.

**Focus is edge-triggered on entry to PLAYING.** A focus input (`INPUT_FOCUS_KEY`
or left mouse button) that is *already held* at the moment of entry does not count
as a hold. It is ignored until it is released and pressed again; the beam starts
`WIDE` and power does not drain.

This exists because the click that starts a run is itself a focus binding (§7). A
player who clicks through the title screen is still holding the button on the first
frame of PLAYING, and without this rule the beam begins narrowing and draining at
`t = 0`, before they have oriented or even seen the arena. The same path opens on
any restart taken with the button still down.

**Scope it to this transition only.** It must not touch §4.2's rearm, where
resuming under a still-held key is deliberate and correct: there the player chose
to hold, and the recovery beat is the reward for holding. Here they never chose at
all. The distinction is whether the hold began before the state was entered.

### 2.3 GAME_OVER

Entered the moment any crawler's centre comes within `LAMP_RADIUS +
CRAWLER_RADIUS` of the lamp centre. On entry, in this order:

1. Freeze the world. No crawler moves, no crawler spawns, power neither drains nor
   recharges, elapsed time stops accumulating. Everything stays rendered exactly
   where it was — the player must be able to see the crawler that killed them,
   still touching the lamp (`docs/vision.md` §6 criterion 6).
2. Finalise the score (§8).
3. If the score beats the stored best, overwrite it and write to `localStorage`
   immediately — not on unload, which a browser may never deliver.
4. Show the game-over overlay: final score, crawlers banished, time survived, best
   score, and the restart prompt.

`R` does not restart the run for `GAME_OVER_INPUT_LOCKOUT` after entry. **A press
during the lockout is buffered, not discarded: it fires the instant the lockout
expires.** One buffered press is enough — further presses during the lockout change
nothing. The buffer is cleared on entry to PLAYING, so a press held across the
restart cannot queue a second one.

The lockout exists because death is sudden and a player's hands are already moving;
without it, a reflexive `R` can skip the score before it is read. It is not a
confirmation step and not an intermediate screen — pillar 3 forbids those, and this
is neither.

Buffering is what keeps it from being a dropped input. A game that silently ignores
a keypress is the exact feel pillar 3 exists to protect, and a deferred press costs
nothing against the budget: QA measures restart from the *moment of death*, not
from the first accepted keypress, so `GAME_OVER_INPUT_LOCKOUT` plus the transition
must stay inside the 1.0 s budget in `docs/vision.md` §6 criterion 1 either way. If
it ever does not, set it to `0` — it is a comfort value, not a balance value.

### 2.4 Time, and the frame-stall rule

Elapsed run time is the sum of frame deltas while in PLAYING, never wall-clock
time. Every delta is clamped to `DELTA_CLAMP_MS` before any movement, timer, power
or score integration uses it.

The clamp is a correctness requirement, not an optimisation. A backgrounded tab, a
GC pause or a breakpoint produces one enormous delta; unclamped, every crawler
teleports toward the lamp in a single frame and the player dies to something they
never saw move. That is a pillar 2 failure — a death the screen never showed. The
clamp makes a stalled frame cost the player a slice of time instead of the run.

---

## 3. The beam

### 3.1 Beam state machine

The beam has a continuous **width parameter** `w ∈ [0, 1]`: `0` is fully wide, `1`
is fully focused. Four states drive it.

```
                 focus held                    w reaches 1
        WIDE ──────────────▶ NARROWING ───────────────────▶ FOCUSED
         ▲                       │                             │
         │                       │ focus released              │ focus released,
         │                       │                             │ or power hits 0
         │   w reaches 0         ▼                             │
         └──────────────────  WIDENING ◀──────────────────────-┘
```

- `NARROWING` drives `w` toward `1`, `WIDENING` drives it toward `0`, both at a
  rate of `1 / BEAM_TRANSITION_TIME` per second. Releasing focus mid-narrow
  reverses from wherever `w` currently is; it does not snap.
- Cone half-angle and reach interpolate linearly on `w` between the wide and the
  focused values. So does beam alpha.
- **Power drains in `NARROWING` and `FOCUSED`. Power recharges in `WIDENING` and
  `WIDE`.** The drain starts the instant the key goes down, not when the beam
  finishes narrowing.
- **Burn dwell accrues only in `FOCUSED`** (§5.2).

The symmetry of the drain and recharge boundaries is what makes rapid toggling
self-balancing rather than a special case: a player who taps the focus key pays
power for the narrow-and-widen round trip and never reaches `FOCUSED`, so they
bank no burn progress. No cooldown, no tap-detection, no extra rule — which is why
this handles the "rapid toggling" edge case the test pass (concept §8 row 6) will
hunt for.

### 3.2 Geometry

The lamp is fixed at the arena centre, `(RENDER_WIDTH / 2, RENDER_HEIGHT / 2)` =
`(480, 270)`. The beam is a cone with its apex at the lamp centre, its bisector on
the lamp-to-pointer heading, and a flat circular end cap at its reach.

| | Wide | Focused |
| --- | --- | --- |
| Full cone angle | `BEAM_WIDE_ANGLE_DEG` | `BEAM_FOCUS_ANGLE_DEG` |
| Reach from lamp centre | `BEAM_WIDE_RANGE` | `BEAM_FOCUS_RANGE` |
| Fill alpha | `BEAM_WIDE_ALPHA` | `BEAM_FOCUS_ALPHA` |

Two geometric facts are load-bearing and must survive retuning:

1. **Focused reaches the corners; wide does not reach the side edges.** The
   half-diagonal of the arena is `√(480² + 270²) ≈ 551 px`. `BEAM_FOCUS_RANGE`
   clears that; `BEAM_WIDE_RANGE` does not clear the 480 px to the left and right
   edges. A crawler that has just spawned on the left or right edge therefore
   cannot be frozen — it can only be *burned*, or waited out until it closes to
   within wide reach. This is the geometry that makes focusing a real choice near
   the corners rather than an optional luxury, and it is the main reason the side
   edges carry more spawn weight than the top and bottom (§6.2).
2. **Focused is narrower but brighter and longer.** It reads as concentration
   rather than as a weaker beam. `BEAM_FOCUS_ALPHA > BEAM_WIDE_ALPHA` is not
   decoration — it is how a player learns in one run that the narrow beam is the
   expensive, lethal one (`docs/vision.md` §6 criterion 5).

A crawler is **inside the beam** when its *centre* lies within the cone: the
angular difference between its bearing from the lamp and the beam bisector is at
most half the current cone angle, and its distance from the lamp centre is at most
the current reach. Centre-based, not radius-based, so the test is one comparison
and the edge of the cone reads exactly where it is drawn.

---

## 4. Power

### 4.1 Rules

- Power runs from `0` to `POWER_MAX`. A run starts at `POWER_START`.
- Drains at `POWER_DRAIN_RATE` per second in `NARROWING` and `FOCUSED`.
- Recharges at `POWER_RECHARGE_RATE` per second in `WIDENING` and `WIDE`.
- There is no delay before recharging begins and no delay before draining begins.

### 4.2 Zero power, and the rearm threshold

From `docs/vision.md` §7, settled: **power reaching zero does not end the run. It
ends the ability to burn.**

When power reaches `0`:

1. The beam is forced out of `NARROWING`/`FOCUSED` into `WIDENING`, whether or not
   the focus input is still held. It widens normally.
2. The focus input is **ignored** until power recovers to `POWER_FOCUS_REARM`.
3. At `POWER_FOCUS_REARM`, focus arms again. If the player is still holding the
   key at that moment, the beam begins narrowing immediately — no re-press needed.
   **This is deliberate and is not affected by §2.2's edge trigger**, which applies
   only to entry into PLAYING. Here the player chose to keep holding; there they
   never pressed at all.

The rearm threshold is not flavour. Without it, a player holding focus at zero
power gets one frame of focus per frame of recharge, producing a flickering beam
that drains as fast as it fills, burns nothing, and looks like a bug. The
threshold converts that into one clear, readable recovery beat.

**Both the power level and the rearm threshold must be on screen.** Pillar 2
forbids state the screen never shows, and a locked-out focus key with no visible
reason is exactly that. The power readout carries a mark at `POWER_FOCUS_REARM`,
and the readout changes appearance while focus is locked out. The visual treatment
is `ui-designer`'s; its *presence* is a pillar requirement, not a nice-to-have.

---

## 5. Crawlers

### 5.1 Movement

- A crawler is a circle of radius `CRAWLER_RADIUS`.
- At spawn it takes a heading straight at the lamp centre. **That heading is fixed
  for its lifetime** and never re-aimed. The lamp does not move, so a straight line
  is also the correct line — and a constant heading is a promise to the player that
  where a crawler is going is readable from where it has been (pillar 2).
- Its speed is `CRAWLER_SPEED_BASE`, scaled by the run-time ramp in §5.4 and by a
  per-crawler jitter in §6.3, capped at `CRAWLER_SPEED_MAX`.
- It moves only while **not frozen** (§5.2), and only while the run is in PLAYING.
- The run ends when the distance between the crawler's centre and the lamp centre
  falls to `LAMP_RADIUS + CRAWLER_RADIUS` or less.

### 5.2 Freeze, burn, and banish

Three rules, evaluated per crawler per frame, in this order:

1. **Frozen while lit.** A crawler inside the beam cone — at *any* width — has its
   speed set to zero for that frame. It resumes the frame the light leaves it. No
   grace period, no easing, no residual slow: `docs/concept.md` §6.3 says "resumes
   the moment the light leaves it", and that is literal.
2. **Burn dwell.** A crawler inside the cone **while the beam is in `FOCUSED`**
   accumulates burn dwell at 1 second per second. A crawler not in that situation —
   outside the cone, or inside it while the beam is wide, narrowing or widening —
   *loses* dwell at `BURN_DECAY_MULTIPLIER` seconds per second, floored at zero.
3. **Banish.** When accumulated dwell reaches `BURN_DWELL_TIME`, the crawler is
   banished: removed from play, `crawlers banished` incremented, `SCORE_PER_BANISH`
   awarded.

Decay rather than instant reset is deliberate. At `BURN_DECAY_MULTIPLIER` above
`1.0`, a momentary wobble off-target costs more than it gained, so sloppy aim is
still punished — but a single jittery frame does not erase four-tenths of a second
of correct play. Instant reset makes the burn feel broken on a cheap mouse; no
decay at all lets a player chip a crawler down across unrelated sweeps, which
destroys the commitment the whole design rests on.

**Burn progress must be visible on the crawler.** Partial dwell is per-crawler
state that changes what the player should do next; under pillar 2 it cannot be
invisible. The crawler shifts toward `CRAWLER_BURN_COLOR` in proportion to its
dwell fraction. Frozen crawlers read as `CRAWLER_FROZEN_COLOR`. Exact treatment is
`ui-designer`'s call; showing the state at all is not optional.

A crawler can be frozen and burning at once — the focused beam does both. That is
the point: committing to a burn also holds *that one* still, while everything else
walks.

### 5.3 Cap

At most `MAX_CRAWLERS` crawlers exist at once. When the spawner fires at the cap,
**the spawn is dropped, not queued.** Queuing would convert a performance rail into
a delayed difficulty spike that arrives after the pressure has passed.

`MAX_CRAWLERS` is a performance rail, not a balance lever — see §11.4 for the
modelled peak concurrency it sits above, and the QA stress procedure.

### 5.4 Difficulty ramp

Two things ramp with elapsed run time, both continuous, neither stepped:

```
speed(t)    = min(CRAWLER_SPEED_MAX,
                  CRAWLER_SPEED_BASE × (1 + CRAWLER_SPEED_RAMP_PER_SECOND × t))

interval(t) = max(SPAWN_INTERVAL_MIN,
                  SPAWN_INTERVAL_START × SPAWN_INTERVAL_DECAY_PER_SECOND ^ t)
```

`t` is elapsed run time in seconds (§2.4). Speed ramps linearly, spawn interval
decays geometrically — spawn pressure is the dominant difficulty term and
compounds; speed is the secondary term and must not, because speed is bounded by
the readability criterion (§11.2).

The ramp is continuous and wave-free *because the shape of the difficulty curve is
an open question* (`docs/vision.md` §8.1). A continuous ramp is the shape that
assumes least. Discrete waves with lulls are a live alternative and belong to a
later milestone, not to this one.

---

## 6. Spawning

### 6.1 Timing

The first crawler of a run spawns `SPAWN_FIRST_DELAY` after entering PLAYING. Each
subsequent spawn is scheduled `interval(t)` after the previous one, evaluated at
the moment of the previous spawn.

`SPAWN_FIRST_DELAY` buys the player a beat to find their cursor after a restart.
Pillar 3 wants the gap between runs too short to think in; it does not want the
first crawler already halfway to the lamp when the screen appears.

### 6.2 Edge choice

The spawning edge is drawn using `SPAWN_EDGE_WEIGHTS`, which must sum to `1`.

The weights are **not** uniform by perimeter. Uniform-by-perimeter would put 64% of
spawns on the top and bottom edges, which are only 270 px from the lamp — barely
more than half the 480 px from the sides. That biases the game toward its shortest,
least interesting reaction window. The weights deliberately tilt the other way: a
majority of crawlers come from the long axis, which is also the axis the wide beam
cannot reach at spawn (§3.2), so the long approach is the one that forces the width
decision.

### 6.3 Placement

- Position along the chosen edge is uniform, excluding `SPAWN_CORNER_INSET` at each
  end. Corner spawns are the hardest to read and the slowest to reach; the inset
  keeps them out of play (pillar 2).
- The crawler is placed so that it is **fully inside the render area on its first
  frame** — inset from the edge by `CRAWLER_RADIUS`. It must never be partly
  off-screen and must never appear inside the field: both are pillar 2 failures.
- **Anti-clustering.** A candidate position is rejected if its bearing from the lamp
  is within `SPAWN_MIN_SEPARATION_DEG` of a living crawler's bearing. Re-roll up to
  `SPAWN_PLACEMENT_ATTEMPTS` times, then accept the last candidate anyway rather
  than skipping the spawn. Without this, random placement occasionally stacks three
  crawlers into one approach lane, which is either free (one burn clears the lane)
  or unanswerable (three arrive together) — both are noise, not difficulty. The
  give-up-and-accept fallback keeps the spawn rate honest.
- Each crawler's speed is multiplied by a random factor drawn uniformly from
  `1 ± CRAWLER_SPEED_JITTER`, fixed at spawn. Jitter stops crawlers spawned in the
  same second from arriving in lockstep.

---

## 7. Input

The complete input surface. Nothing else is read.

| Input | State | Effect |
| --- | --- | --- |
| Pointer move | PLAYING | Sets the beam heading from the lamp centre to the pointer. |
| Hold `INPUT_FOCUS_KEY` | PLAYING | Narrows the beam. Release widens it. Edge-triggered on entry to PLAYING (§2.2). |
| Hold left mouse button | PLAYING | Identical to the above, including the edge trigger. |
| `INPUT_RESTART_KEY` | GAME_OVER | Restarts. A press inside `GAME_OVER_INPUT_LOCKOUT` is buffered and fires when it expires (§2.3). |
| Any key, any click | TITLE | Starts the run. |

**Both focus bindings are edge-triggered on entry to PLAYING** — a focus input
already held when the state is entered is ignored until released and pressed again
(§2.2). This is a direct consequence of left mouse button being a focus binding:
without it, the click that starts the run is also a focus hold, and the run opens
with the beam narrowing and power draining before the player has seen the arena.

Aiming is absolute, not relative: the beam points at the pointer, with no
smoothing, no lag and no turn-rate limit. Any of those would be beam-rotation
inertia, which is the §9.3 contingency and is not in scope.

**On the second focus binding — ruled, approved.** `docs/concept.md` §6.4 says
"holding a key", and `INPUT_FOCUS_KEY` honours that. Left mouse button is an
additional binding for the same action: it adds no mechanic, no state and no input
the pillars do not already permit, and it is how a first-time player will try to
focus before they read anything. `docs/vision.md` §6 criterion 5 requires every
playtester to describe the wide/focused trade-off after **one** run, unprompted —
a trade-off they never discovered cannot be described.

`game-director` approved this: it is a binding, not a verb, and pillar 1's test is
whether an input does anything other than aim or shape the beam. It does not. The
edge-trigger rule above is the condition attached to that approval.

The title screen states both bindings and the restart key. Per pillar 2, the game
never relies on an audio cue for information the player must act on.

---

## 8. Scoring

```
score(t) = floor(t × SCORE_PER_SECOND_SURVIVED) + banished × SCORE_PER_BANISH
```

`t` is elapsed run time in seconds (§2.4); `banished` is the count of crawlers
banished this run. Score accrues continuously and is displayed floored, so the HUD
counts up smoothly rather than ticking once a second.

**The weighting, and why.** Time pays `SCORE_PER_SECOND_SURVIVED` per second
unconditionally. Banishing pays `SCORE_PER_BANISH` each — but **how much that is
worth per second is not fixed, because realised banishes are supply-limited by the
spawn rate, not by the player's capacity.** A player cannot banish crawlers that
have not spawned. So the banish-vs-survive comparison is:

> banish income ≈ `spawn rate × SCORE_PER_BANISH`, against `SCORE_PER_SECOND_SURVIVED` flat.

With `25` and `10`, the two are equal at a spawn rate of `10 / 25 = 0.4` per
second, which §11.1's table puts at about **t = 120 s**. That single crossover is
what these two numbers actually buy:

| Phase of the run | Spawn rate (§11.1) | Banish income | Time income | Which pays |
| --- | --- | --- | --- | --- |
| Opening (`t = 0`) | 0.250/s | 6.3 pts/s | 10 pts/s | **Surviving** |
| `t ≈ 120 s` | 0.404/s | 10.1 pts/s | 10 pts/s | Parity |
| Practised crossing (`t ≈ 218 s`) | 0.600/s | 15.0 pts/s | 10 pts/s | **Banishing** |

So the weighting produces a **gradient, not a flat margin**: patience is correct
early, when crawlers are scarce and every one of them is also the thing that ends
your run, and aggression is correct late, when they arrive faster than they are
worth waiting on. The player is not being asked to pick a strategy once; they are
being asked to notice when the answer changed. That is the same triage the beam
width demands, expressed in the score.

Averaged across a whole deep run the two land near parity — §11.1's practised run
banishes 95 crawlers in 240 s, a realised 0.40/s, paying 9.9 points per second
against time's 10. Neither strategy dominates end to end. That is the intent, and
it is why **the earlier framing of a flat "aggression wins by a quarter" was wrong**
and has been removed: `0.5` banishes/s is a *capacity* figure from §11.3, not a
realised rate, and no player sustains it because no spawner supplies it.

Retune either value only against the other, and re-derive **the crossover time**,
not a per-second margin. Raising `SCORE_PER_BANISH` moves the crossover earlier and
at the extreme deletes the patient phase, making the wide beam a mistake and gutting
the triage the loop is built on; lowering it moves the crossover past the end of a
realistic run, which rewards turtling behind a wide sweep — the passive failure mode
in `docs/concept.md` §9. The number to keep honest is **where the gradient crosses**,
and it should land inside the window where runs actually end.

**No precision bonus.** `docs/vision.md` §8.2 leaves open whether a burn completed
at the last moment before contact should pay extra. It stays open and stays out:
it is a scoring *mechanic*, not a weight, and adding it here would close a question
that is scheduled for a later milestone.

**Best score.** Stored in `localStorage` under `SCORE_STORAGE_KEY`, written the
moment it is beaten (§2.3). Visible on the title, play and game-over screens
(pillar 3). A missing, unparseable or negative stored value is treated as `0`, and
`localStorage` being unavailable or throwing must not break the run — best score
degrades to session-only. This is the only save data in the game
(`docs/concept.md` §7).

---

## 9. The passivity spike

`docs/concept.md` §9 names the fun risk — *"a game with no movement may feel
passive"* — as the project's highest, and names its mitigation: **a short parameter
spike in this task**, plus a playtest gate at the end of the core-loop task. This
section is that spike.

### 9.1 What the spike tests

Not "is it fun". The specific question: **does the width decision occur often
enough, and land hard enough, to feel like play rather than like sweeping?**

The parameters that govern decision frequency are the power economy (how often you
must stop burning), the burn dwell (how long a commitment lasts), and the wide cone
angle (how much the beam covers for free). Those three move together; the spike
varies them together as sets.

### 9.2 Procedure

Run on the first playable build from the core-loop task, before the task-3 playtest
gate. Timeboxed: three sets, five runs each, at least two people. No code changes —
every parameter below is a `src/config` value from §10.

| Set | `BEAM_WIDE_ANGLE_DEG` | `BURN_DWELL_TIME` | `POWER_DRAIN_RATE` | `POWER_RECHARGE_RATE` | Sustainable focus duty |
| --- | --- | --- | --- | --- | --- |
| **A** — baseline, the §10 values | 70 | 0.45 | 26 | 17 | 39.5% |
| **B** — tighter economy | 54 | 0.35 | 34 | 15 | 30.6% |
| **C** — looser economy | 86 | 0.60 | 20 | 22 | 52.4% |

Per set, record:

1. **Focus presses per minute** — how often the player actually commits.
2. **Percentage of run time spent in `NARROWING` or `FOCUSED`** — whether the
   economy is being used or hoarded.
3. **"Were you choosing where to point, or just sweeping?"**, 1 (sweeping) to 5
   (choosing), asked after each set.
4. **Median run length**, as a check that the set has not broken §11.1.

**Pass:** at least one set reaches a median score of **≥ 4** on question 3 with
**≥ 20 focus presses per minute** and a median run length still inside 45–120 s.
That set's four values replace the §10 values by an edit to this document, and the
core-loop task picks them up from `src/config` — no gameplay code changes.

**Fail:** no set reaches 4. The passivity risk is live. Escalate to
`game-director` with the recorded numbers; the contingency in §9.3 is then on the
table at the task-3 playtest gate.

### 9.3 Contingency — beam-rotation inertia. Not in scope.

If the spike fails, `docs/concept.md` §9 pre-agrees the pivot: **beam-rotation
inertia, so aiming has weight — not more systems.** The beam would lag the pointer
under a maximum turn rate and an acceleration, making a wide sweep cost time and a
snap to a far corner cost more.

Recorded here so that the decision, if it is taken, starts from a known shape and
not from a blank page. **It is not specified, not approved, and not to be
implemented from this document.** No constants for it appear in §10. The playtest
gate at the end of the core-loop task decides whether it is taken, and that call is
`game-director`'s — not mine, not the implementer's, and not `producer`'s.

---

## 10. Tuning table

Every value in this document, as `src/config` will export it. This table is the
contract for `docs/vision.md` §6 criterion 9: **no number from this spec may appear
anywhere outside `src/config`.**

"Safe range" is the band a designer may retune inside without re-reviewing this
document. Outside it, the derivations in §11 stop holding — re-check them and say
so on the task.

Colours are Phaser integer literals (`0xRRGGBB`), except `BACKGROUND_COLOR`, which
is a CSS string because it sets the canvas background. Initial values for existing
exports match `src/config/index.ts` as seeded by the skeleton task.

### 10.1 Render and run

| Name | Type | Unit | Initial | Safe range | Governs |
| --- | --- | --- | --- | --- | --- |
| `RENDER_WIDTH` | `number` | px | `960` | fixed | §3.2 — not tunable; `AGENTS.md` fixes the render target |
| `RENDER_HEIGHT` | `number` | px | `540` | fixed | §3.2 — not tunable |
| `DELTA_CLAMP_MS` | `number` | ms | `50` | 20–100 | §2.4 frame-stall clamp |
| `SPAWN_FIRST_DELAY` | `number` | s | `1.2` | 0.5–3.0 | §6.1 grace before the first crawler |
| `GAME_OVER_INPUT_LOCKOUT` | `number` | s | `0.25` | 0–0.5 | §2.3 restart lockout. A press inside it is buffered, never dropped |

### 10.2 Lamp and arena

| Name | Type | Unit | Initial | Safe range | Governs |
| --- | --- | --- | --- | --- | --- |
| `BACKGROUND_COLOR` | `string` | CSS hex | `'#06070b'` | `ui-designer` | The dark hollow |
| `LAMP_RADIUS` | `number` | px | `18` | 12–28 | §5.1 contact distance |
| `LAMP_COLOR` | `number` | `0xRRGGBB` | `0xffd9a0` | `ui-designer` | Lamp body |
| `LAMP_GLOW_RADIUS` | `number` | px | `64` | 40–120 | Lamp glow |
| `LAMP_GLOW_COLOR` | `number` | `0xRRGGBB` | `0xffb347` | `ui-designer` | Lamp glow |
| `LAMP_GLOW_ALPHA` | `number` | 0–1 | `0.18` | 0.05–0.40 | Lamp glow |
| `AMBIENT_LIGHT_ALPHA` | `number` | 0–1 | `0.08` | 0.04–0.14 | Minimum ambient floor (`docs/concept.md` §9 readability risk). `ui-designer` finalises |

### 10.3 Beam

| Name | Type | Unit | Initial | Safe range | Governs |
| --- | --- | --- | --- | --- | --- |
| `BEAM_WIDE_ANGLE_DEG` | `number` | degrees, full cone | `70` | 50–95 | §3.2. Spike parameter (§9.2) |
| `BEAM_WIDE_RANGE` | `number` | px from lamp centre | `420` | 320–470 | §3.2. Must stay **under 480** or wide reaches the side edges and §3.2 fact 1 breaks |
| `BEAM_FOCUS_ANGLE_DEG` | `number` | degrees, full cone | `16` | 10–26 | §3.2. Must stay well under `BEAM_WIDE_ANGLE_DEG` |
| `BEAM_FOCUS_RANGE` | `number` | px from lamp centre | `560` | 555–580 | §3.2. Must stay **above 551** (the half-diagonal) or corners become unreachable. The safe floor is 555, not 551, so that no value inside the range can break the invariant |
| `BEAM_TRANSITION_TIME` | `number` | s | `0.12` | 0.05–0.25 | §3.1 narrow/widen duration |
| `BEAM_WIDE_ALPHA` | `number` | 0–1 | `0.16` | 0.08–0.30 | §3.2. Must stay below `BEAM_FOCUS_ALPHA` |
| `BEAM_FOCUS_ALPHA` | `number` | 0–1 | `0.34` | 0.20–0.55 | §3.2 |
| `BEAM_COLOR` | `number` | `0xRRGGBB` | `0xffe6b8` | `ui-designer` | Beam fill |

### 10.4 Power

| Name | Type | Unit | Initial | Safe range | Governs |
| --- | --- | --- | --- | --- | --- |
| `POWER_MAX` | `number` | power units | `100` | 50–200 | §4.1 |
| `POWER_START` | `number` | power units | `100` | 0–`POWER_MAX` | §2.2 reset. Equal to `POWER_MAX` unless a partial start is a deliberate choice |
| `POWER_DRAIN_RATE` | `number` | power/s | `26` | 16–40 | §4.1. Spike parameter (§9.2) |
| `POWER_RECHARGE_RATE` | `number` | power/s | `17` | 10–28 | §4.1. Spike parameter (§9.2) |
| `POWER_FOCUS_REARM` | `number` | power units | `20` | 5–40 | §4.2. Must be `> 0` and `< POWER_MAX` |

### 10.5 Crawler

| Name | Type | Unit | Initial | Safe range | Governs |
| --- | --- | --- | --- | --- | --- |
| `CRAWLER_RADIUS` | `number` | px | `9` | 6–14 | §5.1 draw and contact |
| `CRAWLER_SPEED_BASE` | `number` | px/s | `52` | 35–75 | §5.4 |
| `CRAWLER_SPEED_MAX` | `number` | px/s | `88` | 60–130, **subject to the joint bound below** | §5.4. See §11.2 |
| `CRAWLER_SPEED_RAMP_PER_SECOND` | `number` | fraction of base per s | `0.0035` | 0.001–0.008 | §5.4 |
| `CRAWLER_SPEED_JITTER` | `number` | fraction, ± | `0.12` | 0–0.25, **subject to the joint bound below** | §6.3 |

**Joint speed bound — binds `CRAWLER_SPEED_MAX` and `CRAWLER_SPEED_JITTER` together:**

> `CRAWLER_SPEED_MAX × (1 + CRAWLER_SPEED_JITTER) ≤ 156 px/s`, where `156 = 234 / 1.5`.

This is the real readability bound and it is not expressible as two independent
ranges. A crawler's time on screen is set by its *effective* speed, so the bound is
stated in effective speed. The two ranges above are each individually safe but
jointly reachable past the bound — `130 × 1.25 = 162.5 px/s` gives `234 / 162.5 =
1.44 s`, under the 1.5 s floor, without either value ever leaving its own range.
Check the product, not the rows. At the initial values: `88 × 1.12 = 98.6 px/s`,
well inside. See §11.2 for the derivation of `234` and `156`.
| `CRAWLER_COLOR` | `number` | `0xRRGGBB` | `0x8a93a8` | `ui-designer` | Default crawler |
| `CRAWLER_FROZEN_COLOR` | `number` | `0xRRGGBB` | `0x9fd4ff` | `ui-designer` | §5.2 frozen tell |
| `CRAWLER_BURN_COLOR` | `number` | `0xRRGGBB` | `0xffb066` | `ui-designer` | §5.2 burn-progress tell |

### 10.6 Freeze and burn

| Name | Type | Unit | Initial | Safe range | Governs |
| --- | --- | --- | --- | --- | --- |
| `BURN_DWELL_TIME` | `number` | s | `0.45` | 0.25–0.80 | §5.2. Spike parameter (§9.2) |
| `BURN_DECAY_MULTIPLIER` | `number` | multiplier | `1.5` | 0.5–4.0 | §5.2 dwell decay rate |

### 10.7 Spawning

| Name | Type | Unit | Initial | Safe range | Governs |
| --- | --- | --- | --- | --- | --- |
| `SPAWN_INTERVAL_START` | `number` | s | `4.0` | 2.5–6.0 | §5.4 |
| `SPAWN_INTERVAL_MIN` | `number` | s | `0.85` | 0.5–1.5 | §5.4 floor |
| `SPAWN_INTERVAL_DECAY_PER_SECOND` | `number` | multiplier per s | `0.996` | 0.990–0.999 | §5.4. The single most sensitive value in the table — see §11.1 |
| `SPAWN_EDGE_WEIGHTS` | `{ top: number; bottom: number; left: number; right: number }` | weights | `{ top: 0.2, bottom: 0.2, left: 0.3, right: 0.3 }` | any set summing to `1` | §6.2 |
| `SPAWN_CORNER_INSET` | `number` | px | `40` | 0–120 | §6.3 |
| `SPAWN_MIN_SEPARATION_DEG` | `number` | degrees | `25` | 0–45 | §6.3 anti-clustering |
| `SPAWN_PLACEMENT_ATTEMPTS` | `number` | count | `6` | 1–12 | §6.3 re-roll budget |
| `MAX_CRAWLERS` | `number` | count | `16` | 6–40 | §5.3 cap. Performance rail — see §11.4 |

### 10.8 Score

| Name | Type | Unit | Initial | Safe range | Governs |
| --- | --- | --- | --- | --- | --- |
| `SCORE_PER_SECOND_SURVIVED` | `number` | points/s | `10` | 0–50 | §8. Retune against `SCORE_PER_BANISH` only; re-derive the crossover |
| `SCORE_PER_BANISH` | `number` | points | `25` | 0–200 | §8. Retune against `SCORE_PER_SECOND_SURVIVED` only; the ratio sets the patience-to-aggression crossover at `SCORE_PER_SECOND_SURVIVED / SCORE_PER_BANISH` spawns/s |
| `SCORE_STORAGE_KEY` | `string` | — | `'lamplight-vigil.best-score'` | fixed | §8. Changing it orphans every existing best score |

### 10.9 Input

Bindings live in `src/config` so that the input handler and the on-screen prompt
read the same source — a prompt that disagrees with the binding is hidden state
under pillar 2. They are not balance values; changing one is a design decision.

| Name | Type | Unit | Initial | Safe range | Governs |
| --- | --- | --- | --- | --- | --- |
| `INPUT_FOCUS_KEY` | `string` | Phaser key name | `'SHIFT'` | design decision | §7 |
| `INPUT_FOCUS_POINTER` | `boolean` | — | `true` | design decision | §7 left-mouse alternate binding |
| `INPUT_RESTART_KEY` | `string` | Phaser key name | `'R'` | design decision | §7 |

---

## 11. Why these numbers

Every figure below is derived from §10 and is **not** itself a tunable. It is shown
so an implementer or QA can tell a deliberate value from a typo, and so that
retuning can be checked rather than guessed.

### 11.1 Run length — `docs/vision.md` §6 criterion 2

Target: **median first-time run 45–120 s; a practised player can exceed 3 minutes.**

The model: a run ends when one crawler gets through. A player "services" a crawler
by getting the beam onto it before it arrives. Call `s` the seconds of beam
attention one crawler costs — acquire, commit, burn. The player keeps up while the
spawn rate stays under `1/s`, and leaks shortly after it passes.

From the power economy, the theoretical ceiling on sustained burning is `1.44 s`
per banish (§11.3), so `s ≈ 1.6 s` for a practised player once aiming is included,
and `s ≈ 3.2 s` for a first-timer who over-holds focus, releases early and wastes
power. That gives a first-timer capacity of `0.31` crawlers/s and a practised
capacity of about `0.60`.

Spawn rate is `1 / interval(t)`:

| `t` (s) | `interval(t)` (s) | spawns/s | |
| --- | --- | --- | --- |
| 0 | 4.00 | 0.250 | opening: a crawler every four seconds, time to learn |
| 30 | 3.55 | 0.282 | |
| 55 | 3.21 | **0.312** | **crosses first-timer capacity (0.31/s)** |
| 90 | 2.79 | 0.359 | |
| 120 | 2.47 | 0.404 | |
| 180 | 1.94 | 0.514 | |
| 218 | 1.67 | **0.600** | **crosses practised capacity (0.60/s)** |
| 240 | 1.53 | 0.654 | |

A first-timer meets more pressure than they can absorb at about **55 s** and leaks
within the following 15–30 s, putting the median death around **70–85 s** —
mid-window, with enough spread on either side to stay inside 45–120 s for players
well above and below the median. A practised player meets their crossing at about
**218 s**, comfortably past the three-minute requirement without making it a
formality.

`SPAWN_INTERVAL_MIN` is reached at about 386 s. It is a safety stop, not a balance
value: nothing in the target window touches it.

Cumulative spawns, `∫₀ᵀ dt / interval(t)`: about **22** by 75 s and about **101** by
240 s. A median first run therefore sees roughly 22 crawlers, banishes perhaps 18
of them, and scores around **1200** (`750 + 18 × 25`); a deep practised run sees
about 101, banishes about 95, and scores around **4800** (`2400 + 95 × 25`). A wide
enough spread for best-score chasing to have somewhere to go.

`SPAWN_INTERVAL_DECAY_PER_SECOND` is the most sensitive value in the table, because
it sets both crossings at once. Moving it from `0.996` to `0.994` pulls the
first-timer crossing from 55 s to about 37 s and the practised crossing from 218 s
to about 146 s — a run length below the target window and a three-minute
requirement that can no longer be met. Re-derive this table before changing it.

### 11.2 Readability — `docs/vision.md` §6 criterion 4

Required: every crawler is on screen **≥ 1.5 s** before it can reach the lamp.

The shortest possible approach is from the top or bottom edge: `270 px` from edge
to lamp centre, less the `LAMP_RADIUS + CRAWLER_RADIUS = 27 px` contact distance,
less the `CRAWLER_RADIUS` spawn inset — **234 px** of travel.

- At `CRAWLER_SPEED_BASE` (52 px/s): **4.5 s**.
- At `CRAWLER_SPEED_MAX` (88 px/s): **2.7 s**.
- At `CRAWLER_SPEED_MAX` with maximum jitter (98.6 px/s): **2.4 s**.

All clear 1.5 s with margin, and the fastest case only exists after about 198 s,
when speed caps.

**The bound is on effective speed, not on `CRAWLER_SPEED_MAX` alone.** The
criterion breaks at `234 / 1.5 = 156 px/s` of *effective* speed — the speed a
crawler actually travels at, after jitter. So the invariant in §10.5 is the product:

> `CRAWLER_SPEED_MAX × (1 + CRAWLER_SPEED_JITTER) ≤ 156 px/s`

Stating it as a ceiling on `CRAWLER_SPEED_MAX` alone would be wrong, because
`CRAWLER_SPEED_JITTER` is itself tunable: at the top of both §10.5 ranges,
`130 × 1.25 = 162.5 px/s` and the shortest approach takes `1.44 s` — a criterion 4
and pillar 2 failure reached without either value leaving its own safe range. The
product form is tune-proof where two independent ranges are not. At the initial
values the margin is large: `88 × 1.12 = 98.6 px/s`, or 63% of the bound.

This is a correctness bound, not a taste bound: past it the game fails a pillar 2
check — a crawler the player cannot react to.

Long-axis approaches are far roomier: `480 − 27 − 9 = 444 px`, giving **8.5 s** at
base speed and **5.0 s** at the cap.

### 11.3 The power economy

- Continuous focus from a full bar: `POWER_MAX / POWER_DRAIN_RATE` = **3.85 s**.
- Empty to full: `POWER_MAX / POWER_RECHARGE_RATE` = **5.88 s**.
- Sustainable focus duty cycle:
  `POWER_RECHARGE_RATE / (POWER_DRAIN_RATE + POWER_RECHARGE_RATE)` = **39.5%**.
  The player spends about two-fifths of a sustained run narrow and three-fifths
  wide. That ratio is the triage in `docs/concept.md` §6.5 expressed as a number,
  and it is what the §9 spike varies.
- Power for one efficient banish, including narrowing:
  `(BEAM_TRANSITION_TIME + BURN_DWELL_TIME) × POWER_DRAIN_RATE` = **14.8 units**.
- Efficient banishes from a full bar: `POWER_MAX / 14.8` = **6.7**.
- Theoretical sustained banish rate: 0.57 s focused plus `14.8 / 17 = 0.87 s`
  recharging = **1.44 s per banish**, i.e. **0.69/s** with perfect aim and no
  travel between targets. Real practised play lands near **0.5/s** — the figure
  §11.1 uses to set the practised crossing.

**0.5/s is a capacity, not a rate.** It is the ceiling on how fast a player *can*
service crawlers, and it is only ever reached when crawlers are arriving that fast.
Below the practised crossing the player is supply-limited, not capacity-limited, and
realised banishes track the spawn rate instead. §8 is derived from spawn rate for
exactly that reason; using this figure there would overstate banish income across
the whole early run.

### 11.4 The crawler cap — `docs/vision.md` §6 criterion 3

Criterion 3 requires 60 fps measured **with the configured maximum concurrent
crawler count on screen**, so the cap has to be both stated and honest.

Modelled peak concurrency is low. In-flight count is roughly spawn rate × effective
journey time. At the first-timer crossing (0.31/s, ~6 s journeys, stretched maybe
1.5× by freezing) that is about **3**. In a deep practised run (0.65/s, ~4.5 s
journeys, stretched up to 2× by a player who freezes rather than burns) it is about
**6**, with transient peaks perhaps into double figures. `MAX_CRAWLERS = 16` sits
roughly 2.5× above the deepest modelled peak: high enough that it never acts as a
difficulty lever, low enough to bound the worst case for the overlapping alpha that
`docs/concept.md` §9 flags as the performance risk.

**QA stress procedure.** The cap is most reachable late in a long run by freezing
rather than burning — sweep wide continuously past 180 s and let crawlers
accumulate under the beam instead of banishing them. Measure frame rate at the
highest concurrency reached.

If the cap cannot be reached in play, criterion 3 is satisfied by: (a) confirming
the spawner never exceeds `MAX_CRAWLERS`, and (b) recording sustained 60 fps with
no frame under 30 fps at the highest concurrency actually observed. **Record that
observed peak and send it back to me** — if the real peak is far under 16, the cap
should come down so that the criterion measures something reachable, and that is a
retune of a §10 value, not a code change.

---

## 12. Acceptance criteria

These are the testable statements this document is accountable for. They restate
the task's criteria against the sections above, so QA can derive cases directly.

| # | Criterion | How to verify |
| --- | --- | --- |
| 1 | Every speed, radius, rate, duration, colour and score value in this document is a named export in `src/config` | Diff §10 against `src/config/index.ts`: every row present, same name, same initial value. Then grep `src/beam`, `src/enemies`, `src/hud`, `src/scenes` for numeric literals — only `0`, `1`, `2` and array indices may appear |
| 2 | `MAX_CRAWLERS` is one of those constants and bounds concurrency | §10.7. Instrument or observe peak concurrency across a long run; the spawner never exceeds it, and spawns at the cap are dropped, not queued (§5.3) |
| 3 | Median first-time run lands in 45–120 s; a practised player exceeds 3 minutes | Ten first-time runs from the playtest cohort; median inside the window. One practised player exceeds 180 s. Reasoning and the ramp arithmetic are in §11.1 |
| 4 | No second player verb, and no hidden state | §7 is the entire input surface — exercise every input and confirm each only aims or shapes the beam. Confirm power, the `POWER_FOCUS_REARM` mark, the focus lockout, burn progress and freeze are all visible on screen (§4.2, §5.2) |
| 5 | Nothing from `docs/concept.md` §7 "Explicitly out" is introduced | §1 lists what is excluded; read §2–§8 against the out-list |
| 6 | The passivity spike is specified, and beam-rotation inertia is recorded as a contingency only | §9. The spike has three parameter sets, four measures and a pass bar (§9.2). §9.3 adds no constants to §10 and instructs that the pivot is not implemented here |
| 7 | Every crawler is on screen ≥ 1.5 s before it can reach the lamp | §11.2 derives 2.4 s as the worst case, at maximum speed and maximum jitter on the shortest approach. Check the §10.5 joint bound as a product — `CRAWLER_SPEED_MAX × (1 + CRAWLER_SPEED_JITTER) ≤ 156` — not the two ranges separately. QA records a run and steps back from each contact |
| 8 | Restart from the moment of death to the first playable frame is ≤ 1.0 s | §2.3. Budget includes `GAME_OVER_INPUT_LOCKOUT` |
| 9 | A stalled frame cannot kill the player | §2.4. Background the tab for 10 s, return, and confirm no crawler jumped position |
| 10 | No restart press is ever dropped | §2.3. Press `R` within 0.1 s of death; the run must restart when the lockout expires, not require a second press |
| 11 | A run never opens with the beam already narrowing | §2.2. Start a run by clicking and keep the button held; confirm the beam stays `WIDE` and power does not drain until the button is released and pressed again. Repeat on restart with `R` held and with the mouse held. Then confirm §4.2's rearm still resumes under a held key — the edge trigger must not have leaked into it |

---

## 13. Open items this document does not close

- **Difficulty-curve shape** (`docs/vision.md` §8.1) — MVP ships the continuous
  ramp in §5.4. Discrete waves with lulls remain open for a later milestone.
- **Score precision bonus** (`docs/vision.md` §8.2) — stays out; see §8.
- **Crawler variety** (`docs/vision.md` §8.3) — out of MVP scope entirely.
- **Audio beyond confirmation** (`docs/vision.md` §8.4) — §5.2 and §4.2 name the
  three moments worth confirming (the freeze, the burn, the lamp hit); the audio
  set itself is not specified here.
- **Auto-pause on window blur** (`docs/vision.md` §8.6) — `producer` has ruled it
  out of this milestone. §2.4's delta clamp covers the correctness half of the
  problem regardless.
- **The spike's winning parameter set** (§9.2) — resolved by running the spike,
  then edited into §10 and §9.2 here.
- **`MAX_CRAWLERS` final value** (§11.4) — may come down once QA reports the real
  peak concurrency.
