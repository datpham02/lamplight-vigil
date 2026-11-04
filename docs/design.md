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

**Both formulas are unchanged by the GAM-17 rebalance.** The curve was retuned by
moving §10 values only; `spawnInterval()` and `rampedSpeed()` in
`src/enemies/CrawlerField.ts` keep the shapes above.

#### The shape the numbers are chosen for

The two expressions above have three terms between them that a designer can move,
and each one owns a different part of the run. Naming which is which is what keeps
a retune from being a guess:

| Term | What it owns | Why it is that term |
| --- | --- | --- |
| `SPAWN_INTERVAL_START` | **How busy the opening is.** | It is the only term that acts at `t = 0`, so it is the only one that can put a second and third crawler on screen while the player is still learning the width decision. |
| `SPAWN_INTERVAL_DECAY_PER_SECOND` | **How fast the run turns over.** | It sets the *slope*, and therefore the distance between the moment a first-timer runs out of capacity and the moment a practised player does — the whole span the run-length criterion lives in. |
| `SPAWN_INTERVAL_MIN` | **How hard the game ever gets.** | Past the floor the spawn term stops growing. Crawler speed has already capped (§11.2). So the floor is the moment the game stops getting harder, for good. |

That last row is a change of meaning from the seeded spec, where the floor sat at
`t ≈ 386 s` and was documented as "a safety stop, not a balance value". It is now
a balance value and the most important one in the table, because **it is the only
thing in the design that bounds difficulty at all.** Without a floor inside the
reachable run, spawn *rate* — the reciprocal of a geometric decay — grows without
limit, and the gap between arrivals and what a player can clear grows with it. A
player does not experience unbounded growth as a difficulty curve; they experience
it as a wall that arrives somewhere they cannot predict.

So the curve is designed in three phases, and §11.1 derives the values that produce
them:

1. **Opening (0 – ~45 s).** A crawler every 3.2 s falling to every 2.7 s. Around
   three on screen by 50 s. Busy enough that the width decision is forced in the
   first half-minute, sparse enough to learn it in.
2. **Slide (~45 s – ~300 s).** Arrivals pass what the player can clear, first for a
   first-timer and much later for a practised one, and the shortfall grows —
   never by more than **0.0035 crawlers per second, per second**. That bound is
   what "readable" means here: the player can always see the field getting worse
   and still has whole seconds to choose what to give up.
3. **Asymptote (t ≥ ~332 s).** The floor binds, the speed cap has long since bound,
   and nothing gets harder again. The game holds one fixed, maximal, losing
   position. `SPAWN_INTERVAL_MIN` is chosen so that position is losing *provably* —
   see the asymptote invariant in §10.7.

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
second, which §11.1's table puts at about **t = 70 s**. That single crossover is
what these two numbers actually buy:

| Phase of the run | Spawn rate (§11.1) | Banish income | Time income | Which pays |
| --- | --- | --- | --- | --- |
| Opening (`t = 0`) | 0.313/s | 7.8 pts/s | 10 pts/s | **Surviving** |
| `t ≈ 70 s` | 0.400/s | 10.0 pts/s | 10 pts/s | Parity |
| Practised crossing (`t ≈ 184 s`) | 0.595/s | 14.9 pts/s | 10 pts/s | **Banishing** |
| Asymptote (`t ≥ 332 s`) | 1.000/s | 25.0 pts/s | 10 pts/s | **Banishing** |

So the weighting produces a **gradient, not a flat margin**: patience is correct
early, when crawlers are scarce and every one of them is also the thing that ends
your run, and aggression is correct late, when they arrive faster than they are
worth waiting on. The player is not being asked to pick a strategy once; they are
being asked to notice when the answer changed. That is the same triage the beam
width demands, expressed in the score.

**The GAM-17 rebalance moved the crossover from ~120 s to ~70 s, and neither score
value changed.** It moved because the crossover is a property of the *spawn curve*,
not of the weights: it sits wherever the rate reaches `0.4/s`, and the new curve
gets there sooner. This is an improvement, not a side effect to be tuned back out.
At 120 s the crossover sat past where most first runs end, so the median player
never reached the moment the right answer changes — the gradient §8 exists to
create was invisible to exactly the audience it was for. At 70 s it falls inside
the modelled median first run of 79 s, so a typical player now lives through both
halves of it. **Leave `SCORE_PER_BANISH` at 25.** If GAM-15 reports first-timers
abandoning the wide beam outright and burning everything from the first second,
that is the signal to raise it — raising it moves the crossover *later*, which is
the correction for over-aggression.

Averaged across a whole deep run the two land near parity — §11.1's practised run
banishes about 117 crawlers in 250 s, a realised 0.47/s, paying 11.7 points per
second against time's 10. Aggression edges ahead over a deep run, which is right:
the deep run is the one that spent its length under the arrivals it could not
clear. Neither strategy dominates end to end. That is the intent, and it is why
**the earlier framing of a flat "aggression wins by a quarter" was wrong** and has
been removed: `0.5` banishes/s is a *capacity* figure from §11.3, not a realised
rate, and no player sustains it because no spawner supplies it.

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
| **A** — baseline, the §10 values | 70 | 0.40 | 26 | 22 | 45.8% |
| **B** — tighter economy | 54 | 0.32 | 34 | 18 | 34.6% |
| **C** — looser economy | 86 | 0.55 | 20 | 26 | 56.5% |

**Set A was re-baselined by GAM-17** and sets B and C moved with it, because set A
is by definition the current §10 values and two of them changed (§11.1). The
spike's structure is untouched: A is the shipping economy, B is meaningfully
tighter, C is meaningfully looser, and all three stay inside the §10 safe ranges.
Any spike results recorded against the old set A are superseded — the spike had
not been run when GAM-17 landed, so nothing is lost.

All three sets satisfy the asymptote invariant in §10.7 against
`SPAWN_INTERVAL_MIN = 1.00` — A at 1.13 s, B at 1.27 s, C at 1.19 s — so whichever
set wins the spike, the game still out-produces perfect play at the floor. **Check
that invariant again for any set the spike adds**: a set that fails it ships a game
a sufficiently good player cannot lose.

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
| `POWER_DRAIN_RATE` | `number` | power/s | `26` | 16–40 | §4.1. Spike parameter (§9.2). **Unchanged by GAM-17** — see §11.1 |
| `POWER_RECHARGE_RATE` | `number` | power/s | `22` | 10–28 | §4.1. Spike parameter (§9.2). **GAM-17: 17 → 22.** Sets the sustainable focus duty with `POWER_DRAIN_RATE`, and therefore kill capacity. Subject to the §10.7 asymptote invariant |
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
| `BURN_DWELL_TIME` | `number` | s | `0.40` | 0.25–0.80 | §5.2. Spike parameter (§9.2). **GAM-17: 0.45 → 0.40.** Sets the drain cost of one banish with `BEAM_TRANSITION_TIME`. Subject to the §10.7 asymptote invariant |
| `BURN_DECAY_MULTIPLIER` | `number` | multiplier | `1.5` | 0.5–4.0 | §5.2 dwell decay rate. **Unchanged by GAM-17** — see §11.1 |

### 10.7 Spawning

| Name | Type | Unit | Initial | Safe range | Governs |
| --- | --- | --- | --- | --- | --- |
| `SPAWN_INTERVAL_START` | `number` | s | `3.2` | 2.5–6.0 | §5.4. **GAM-17: 4.0 → 3.2.** Owns how busy the opening is |
| `SPAWN_INTERVAL_MIN` | `number` | s | `1.00` | 0.90–1.30, **subject to the asymptote invariant below** | §5.4 floor. **GAM-17: 0.85 → 1.00, and it is now a balance value, not a safety stop.** Owns how hard the game ever gets |
| `SPAWN_INTERVAL_DECAY_PER_SECOND` | `number` | multiplier per s | `0.9965` | 0.9950–0.9990 | §5.4. **GAM-17: 0.996 → 0.9965.** Still the single most sensitive value in the table — it sets every capacity crossing at once. Re-derive §11.1 before changing it. The range narrowed from `0.990` because anything below `0.9950` reintroduces the late-game cliff this rebalance removed |
| `SPAWN_EDGE_WEIGHTS` | `{ top: number; bottom: number; left: number; right: number }` | weights | `{ top: 0.2, bottom: 0.2, left: 0.3, right: 0.3 }` | any set summing to `1` | §6.2 |
| `SPAWN_CORNER_INSET` | `number` | px | `40` | 0–120 | §6.3 |
| `SPAWN_MIN_SEPARATION_DEG` | `number` | degrees | `25` | 0–45 | §6.3 anti-clustering |
| `SPAWN_PLACEMENT_ATTEMPTS` | `number` | count | `6` | 1–12 | §6.3 re-roll budget |
| `MAX_CRAWLERS` | `number` | count | `16` | 6–40 | §5.3 cap. Performance rail — see §11.4 |

**Asymptote invariant — binds `SPAWN_INTERVAL_MIN` to the power economy and the
burn, across four rows in three subsections:**

> `SPAWN_INTERVAL_MIN` < `(BEAM_TRANSITION_TIME + BURN_DWELL_TIME) × (POWER_DRAIN_RATE + POWER_RECHARGE_RATE) / POWER_RECHARGE_RATE`

The right-hand side is the **shortest power-sustainable banish cycle**: the seconds
of wall clock a player must spend, at best, to pay for one banish out of the power
economy — the drain seconds of narrowing plus dwell, divided by the sustainable
focus duty (§11.3). It assumes perfect aim, zero travel between targets and zero
wasted focus, so no human reaches it; it is a hard ceiling on kill rate, not a
target.

The invariant says the floor interval must sit **below** that ceiling, so that at
the hardest the game ever gets, crawlers arrive faster than even perfect play can
clear them. Break it and the game has a stable state in which a sufficiently good
player never loses: the run never ends, the score grows without bound, and
`docs/vision.md` pillar 3 — "runs target 45 to 120 seconds" — has no upper bound
at all at the top of the skill range.

At the initial values: `1.00 < (0.12 + 0.40) × 48 / 22 = 1.13 s`, a margin of 13%.

**Check it as one expression, not as four ranges.** Each of the four rows is
individually safe anywhere inside its own band while the product is not: at
`BURN_DWELL_TIME = 0.25`, `POWER_DRAIN_RATE = 16` and `POWER_RECHARGE_RATE = 28`
the ceiling falls to `0.37 × 44 / 28 = 0.58 s`, below every value in
`SPAWN_INTERVAL_MIN`'s own range, without any row leaving its band. This is the
same failure mode as the joint speed bound in §10.5, and it is checked the same
way — by the simulation in [`docs/throughput-sim.md`](./throughput-sim.md), on
every retune.

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

### 11.1 Run length and the difficulty curve — `docs/vision.md` §6 criterion 2

Targets: **median first-time run 45–120 s; a practised player can exceed 3
minutes**; plus the two GAM-17 requirements — **pressure felt within 30–60 s**, and
**a late game that is hard but has no cliff**.

Everything below is derived from §10 and is checkable by the deterministic
simulation specified in [`docs/throughput-sim.md`](./throughput-sim.md). That
script is the executable form of this section: if it and this section disagree,
one of them has a bug, and the task that finds the disagreement fixes both.

#### What was wrong with the seeded curve

The seeded values (`SPAWN_INTERVAL_START = 4.0`,
`SPAWN_INTERVAL_DECAY_PER_SECOND = 0.996`, `SPAWN_INTERVAL_MIN = 0.85`,
`POWER_RECHARGE_RATE = 17`, `BURN_DWELL_TIME = 0.45`) hit the run-length numbers
and still produced the two complaints the Board raised after playing the build.
Both are properties of the curve's *shape*, not of where it ends:

1. **The opening is empty.** A spawn every 4.0 s against a journey of 4.5–8.5 s
   (§11.2) puts fewer than two crawlers on screen for the first half-minute. The
   player is never holding two threats at once, so the width decision — the whole
   game — does not arise. The field only reaches three crawlers at about **62 s**,
   by which point a first-timer is most of the way through their run.
2. **The late game is a wall, not a ramp.** Spawn *rate* is the reciprocal of a
   geometric decay, so it grows exponentially and without bound: `0.25/s` at
   `t = 0`, `0.65/s` at 240 s, `1.18/s` at the floor. Kill capacity is flat.
   The shortfall therefore grows faster the longer you survive, and the worst
   arrival-to-capacity ratio the game can reach is **2.44×** for a practised
   player. Nothing announces it; the field simply stops being clearable.

Neither defect is fixed by moving the endpoints. The fix is a busier start, a
shallower slope, a floor that binds inside a reachable run, and enough kill
capacity that "many at once" is answerable.

#### The service model

A run ends when one crawler reaches the lamp. Between spawning and arriving, each
crawler must be either **serviced** (banished) or **held** (kept frozen under the
beam). Holding defers a crawler; it does not remove one, and it costs beam time
that is then not spent killing. So the run is a single-server queue with a
tolerance for backlog:

- **Kill capacity** `C` — banishes per second a player can sustain, set by the
  power economy and by how much beam time they waste. Derived below.
- **Spawn rate** `r(t) = 1 / interval(t)` — §5.4.
- **Backlog** `n(t)` — unserviced crawlers in flight. It grows at `r(t) − C`
  whenever that is positive.
- **Backlog tolerance** `B` — how many unserviced crawlers a player can keep
  frozen before one slips through on a bearing the beam is not on. **The run ends
  when `n` reaches `B`.**

`B` is anchored on the beam, not invented: a wide cone covers
`BEAM_WIDE_ANGLE_DEG / 360 = 70 / 360 = 19.4%` of the bearings around the lamp, so
a player doing nothing but sweeping can keep roughly `1 / 0.194 ≈ 5` bearings
re-lit. A first-timer sweeping loosely while also trying to burn manages fewer; a
practised player placing the cone deliberately manages about that; an expert a
little more. **`B` is the one calibrated number in this model and GAM-15 is what
calibrates it** — see the recalibration rule at the end of this section.

**Kill capacity.** One banish costs `BEAM_TRANSITION_TIME + BURN_DWELL_TIME`
seconds of *drain* (§3.1: the drain starts when the key goes down, not when the
beam finishes narrowing), plus whatever focused seconds the player wastes
over-holding or re-earning dwell lost to decay (§5.2). Call that total `D`. The
sustainable focus duty is `POWER_RECHARGE_RATE / (POWER_DRAIN_RATE +
POWER_RECHARGE_RATE)` = `22 / 48` = **45.8%** (§11.3), so the power-limited cycle
is `D / 0.458` seconds per banish. A player is also limited by the wall-clock
round trip — drain, swing to the next target while wide, widen back — so:

> `C = 1 / max(D + aim + BEAM_TRANSITION_TIME, D / duty)`

| Skill tier | `aim` (s, wide) | waste (s, focused) | `D` (s) | cycle (s) | **`C`** (banishes/s) | `B` |
| --- | --- | --- | --- | --- | --- | --- |
| First-timer | 1.10 | 0.90 | 1.42 | 3.10 | **0.323** | 3 |
| Practised | 0.50 | 0.25 | 0.77 | 1.68 | **0.595** | 5 |
| Expert | 0.30 | 0.05 | 0.57 | 1.24 | **0.804** | 6 |

Every tier is power-limited, not wall-clock-limited, at these values — which is
why `POWER_RECHARGE_RATE` is the lever that moved. The `aim` and waste figures are
behavioural assumptions, stated so they can be argued with: `aim` is a mouse swing
of a quarter to a third of the canvas plus the decision to make it, and waste is
over-holding past the banish plus dwell re-earned after a wobble (at
`BURN_DECAY_MULTIPLIER = 1.5`, every 0.1 s off target costs 0.15 s of dwell).

#### The new curve

`interval(t) = max(1.00, 3.2 × 0.9965ᵗ)`. Writing `k = −ln(0.9965) = 0.003506`,
spawn rate is `0.3125 × e^{kt}` until the floor binds.

| `t` (s) | `interval(t)` (s) | spawns/s | vs. seeded | |
| --- | --- | --- | --- | --- |
| 0 | 3.20 | 0.313 | +25% | opening: a crawler every 3.2 s |
| 9 | 3.10 | **0.323** | | **crosses first-timer capacity** |
| 30 | 2.88 | 0.347 | +23% | |
| 45 | 2.73 | 0.366 | | 15 crawlers seen; about 3 on screen by 50 s |
| 70 | 2.50 | **0.400** | | **score crossover (§8)** |
| 120 | 2.10 | 0.476 | +18% | |
| 180 | 1.70 | 0.587 | +14% | |
| 184 | 1.68 | **0.595** | | **crosses practised capacity** |
| 240 | 1.38 | 0.725 | +11% | |
| 270 | 1.24 | **0.804** | | **crosses expert capacity** |
| 332 | **1.00** | **1.000** | +6% | **floor binds — nothing gets harder again** |
| 346 | 1.00 | 1.000 | 0% | the two curves cross; the seeded one keeps climbing |
| 400 | 1.00 | 1.000 | −15% | seeded: 1.176/s, and still the hardest it ever gets |

Read the "vs. seeded" column as the whole rebalance in one line: **more pressure
everywhere up to 346 s, and a lower, fixed ceiling after it.** The new curve is
hotter than the old one for longer than anyone plays, then stops; the old one
stays cooler for four minutes and then overtakes it and keeps going. That
inversion is the rebalance.

#### Run lengths

Integrating `n(t)` from each tier's crossing to `n = B`:

| Tier | Capacity crossed | Backlog reaches `B` | **Run length** | Crawlers seen | Banished | Score |
| --- | --- | --- | --- | --- | --- | --- |
| First-timer | 9 s | at 79 s | **79 s** | 28 | ~24 | ~1 390 |
| Practised | 184 s | at 250 s | **250 s** | 125 | ~117 | ~5 425 |
| Expert | 270 s | at 332 s | **332 s** | 196 | ~187 | ~8 000 |

- **Criterion 2, median run.** 79 s sits mid-window in 45–120 s, with the seeded
  curve's 90 s for comparison. The window has room on both sides of the median for
  the spread a cohort of ten will actually produce.
- **Criterion 2, practised player.** 250 s clears 180 s by 39%, so the requirement
  is met by a margin rather than by a hair, and an expert reaches 332 s.
- **Score spread.** About 1 400 to 8 000 — nearly 6×, against the seeded curve's
  4×. Best-score chasing has somewhere to go.

Note what the first-timer row says: they cross their capacity at **9 s** and then
spend **70 s** slowly losing. That is deliberate and it is the answer to "the time
until crawlers get busy is a bit long". The run is not a safe phase followed by a
collapse; it is a managed retreat from almost the first spawn, which is the
fantasy in the game's title. The backlog is still under 1 crawler at 45 s and under
2.5 at 75 s, so the player is never drowning — they are always one decision behind,
which is where this game is supposed to live.

#### Pressure within 30–60 s

Modelled crawlers on screen is `n(t) + r(t) × (mean seconds a serviced crawler is
alive)`, the second term taking 6 s for a first-timer from the journey times in
§11.2.

| | Seeded curve | New curve |
| --- | --- | --- |
| Crawlers on screen at 45 s | 2.1 | **2.9** |
| Reaches 3 on screen at | 62 s | **47 s** |
| Cumulative spawns by 45 s | 12 | **15** |

Three crawlers is the threshold that matters, because two can sit inside one wide
cone and three usually cannot (§3.2) — three is the first number at which the
player must *choose*. Moving it from 62 s to 47 s puts the first real triage inside
the first minute of a first run, which is also what `docs/vision.md` §6 criterion 5
needs: a player cannot describe a trade-off they were never made to make.

#### No cliff

Three bounds, each one checkable:

1. **The shortfall never accelerates past `k × r`.** Spawn rate grows at
   `d(rate)/dt = k × rate ≤ 0.003506 × 1.000` = **0.0035 crawlers/s per second**,
   and kill capacity is flat, so that is also the bound on how fast the shortfall
   grows. Seeded: `0.004008 × 1.176` = 0.0047/s², 34% steeper and never bounded.
2. **It stops growing altogether at 332 s.** The floor binds there and
   `CRAWLER_SPEED_MAX` has bound since 198 s (§11.2), so past 332 s no term in
   §5.4 is still moving. The game's hardest state is reached, named, and fixed.
3. **The hardest state is gentler than the seeded curve's.** Worst
   arrival-to-capacity ratio, `(1 / SPAWN_INTERVAL_MIN) / C`:

| Tier | Seeded worst ratio | New worst ratio |
| --- | --- | --- |
| First-timer | 4.37× | **3.10×** |
| Practised | 2.44× | **1.68×** |
| Expert | 1.84× | **1.24×** |

A practised player at the floor is out-produced by 68%, not by 144%. That is the
difference between a field you are losing and a field that has stopped being a
game. And the expert's 1.24× is the asymptote invariant in §10.7 doing its job from
the other side: above 1.0, so the run still ends.

#### Which levers moved, and why each one

Five values changed. Each owns one of the defects above; nothing changed that did
not have to.

| Lever | From | To | Why this one |
| --- | --- | --- | --- |
| `SPAWN_INTERVAL_START` | 4.0 | **3.2** | The only term that acts at `t = 0`, so the only one that can fix the empty opening. 3.2 s is the value at which three crawlers are on screen by 47 s while a first-timer's backlog is still under 1 at 45 s — busy, not lethal |
| `SPAWN_INTERVAL_DECAY_PER_SECOND` | 0.996 | **0.9965** | *Shallower*, against the instinct that a harder game needs a steeper ramp. The slope sets the distance between the first-timer and practised crossings; a shallower slope buys a 70 s slide instead of a 30 s collapse, and is bound 1 above |
| `SPAWN_INTERVAL_MIN` | 0.85 | **1.00** | Promoted from safety stop to the bound on difficulty. At 1.00 s the floor binds at 332 s — inside a reachable run — and sits 13% under the shortest power-sustainable banish cycle, so the asymptote is provably losing (§10.7) |
| `POWER_RECHARGE_RATE` | 17 | **22** | "Hard to clear them all" is a capacity complaint, and every tier is duty-limited, so duty is the lever: 39.5% → 45.8% lifts all three capacities by **15.9%** at a stroke. Recharge rather than drain, because drain is what the player *feels* when they commit, and changing it would re-pitch the core trade-off rather than its throughput |
| `BURN_DWELL_TIME` | 0.45 | **0.40** | Cuts the drain cost of a banish from 14.8 to 13.5 power (§11.3), which is the rest of the capacity rise — and it is tilted toward the skilled tiers (+8.1% for an expert against +3.4% for a first-timer), because dwell is a larger share of a clean kill than of a sloppy one, and a crowded late field is exactly where the complaint came from. **0.40 is where the cut stops:** at 0.35 the shortest sustainable banish cycle falls to 1.03 s and the §10.7 asymptote invariant is left with 2% of headroom against `SPAWN_INTERVAL_MIN` instead of 13% |

Deliberately **not** changed, each for a stated reason:

- **`POWER_DRAIN_RATE`** — one lever is enough to move the duty cycle, and drain is
  the number that sets what a commitment costs in the moment. Moving both would
  make the §9.2 spike unreadable.
- **`CRAWLER_SPEED_BASE`, `CRAWLER_SPEED_MAX`, `CRAWLER_SPEED_RAMP_PER_SECOND`,
  `CRAWLER_SPEED_JITTER`** — speed is the one difficulty term that already has no
  cliff: it caps at 198 s. It is also the term bounded by the readability criterion
  (§11.2, joint bound), where the current margin is 63% of the limit and is worth
  keeping. Spawn pressure is the dominant term (§5.4) and the right place to spend
  a rebalance.
- **`BURN_DECAY_MULTIPLIER`** — softening it would raise first-timer capacity and
  almost nothing else, which *narrows* the gap between tiers and therefore pulls
  the practised crossing back toward the first-timer's. The three-minute
  requirement needs that gap wide.
- **`MAX_CRAWLERS`** — a performance rail, not a balance lever (§5.3). The new peak
  is still under it; see §11.4.
- **`SPAWN_FIRST_DELAY`, `SPAWN_EDGE_WEIGHTS`, `SPAWN_CORNER_INSET`,
  `SPAWN_MIN_SEPARATION_DEG`** — placement and grace, not pressure. None of them
  appears in the arithmetic above.
- **`SCORE_PER_SECOND_SURVIVED`, `SCORE_PER_BANISH`** — the crossover moved on its
  own, to a better place. See §8.

#### Retuning and recalibration

`SPAWN_INTERVAL_DECAY_PER_SECOND` remains the most sensitive value in §10, because
it sets all three crossings at once. At `0.9950` the practised crossing falls from
184 s to 128 s and the practised run to about 184 s, so the three-minute
requirement survives only by a hair; at `0.9990` the slide stretches so far that
the median first run reaches about 165 s and leaves the window from the other
side. That is why its safe range narrowed. **Re-derive this section before
changing it, and run the simulation.**

`B` — 3 / 5 / 6 — is the model's one uncalibrated input, and the run-length
predictions are roughly linear in it. **GAM-15 is the calibration.** Fit `B` to the
observed median first-time run, re-run the simulation, and if the refitted `B`
moves the practised prediction under 180 s, bring `SPAWN_INTERVAL_DECAY_PER_SECOND`
up toward `0.9975` before touching anything else — it is the lever that separates
the tiers without disturbing the opening.

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

- Continuous focus from a full bar: `POWER_MAX / POWER_DRAIN_RATE` = **3.85 s**
  (unchanged by GAM-17 — `POWER_DRAIN_RATE` did not move).
- Empty to full: `POWER_MAX / POWER_RECHARGE_RATE` = **4.55 s** (was 5.88 s).
- Zero to the §4.2 rearm threshold: `POWER_FOCUS_REARM / POWER_RECHARGE_RATE` =
  **0.91 s** (was 1.18 s). Still long enough to read as one recovery beat rather
  than a flicker, which is the only thing that threshold has to buy.
- Sustainable focus duty cycle:
  `POWER_RECHARGE_RATE / (POWER_DRAIN_RATE + POWER_RECHARGE_RATE)` = **45.8%**
  (was 39.5%). The player spends a little under half of a sustained run narrow and
  a little over half wide. That ratio is the triage in `docs/concept.md` §6.5
  expressed as a number, it is what the §9 spike varies, and **it is the term
  GAM-17 moved to make a crowded field clearable** (§11.1).
- Power for one efficient banish, including narrowing:
  `(BEAM_TRANSITION_TIME + BURN_DWELL_TIME) × POWER_DRAIN_RATE` = **13.5 units**
  (was 14.8).
- Efficient banishes from a full bar: `POWER_MAX / 13.5` = **7.4** (was 6.7).
- **Shortest power-sustainable banish cycle:** 0.52 s draining plus
  `13.5 / 22 = 0.61 s` recharging = **1.13 s per banish**, i.e. **0.88/s** with
  perfect aim and no travel between targets (was 1.44 s and 0.69/s). This is the
  quantity the §10.7 asymptote invariant is stated against, and it is the ceiling
  the expert tier in §11.1 sits just under at 0.804/s. Real practised play lands
  near **0.60/s**.

**These are capacities, not rates.** They are the ceiling on how fast a player
*can* service crawlers, and are only reached when crawlers arrive that fast. Below
the relevant crossing in §11.1 the player is supply-limited, not capacity-limited,
and realised banishes track the spawn rate instead. §8 is derived from spawn rate
for exactly that reason; using these figures there would overstate banish income
across the whole early run.

### 11.4 The crawler cap — `docs/vision.md` §6 criterion 3

Criterion 3 requires 60 fps measured **with the configured maximum concurrent
crawler count on screen**, so the cap has to be both stated and honest.

Modelled concurrency is `backlog + spawn rate × (mean seconds a serviced crawler is
alive)`, both terms from §11.1. At the end of each modelled run — the moment
concurrency peaks, because that is when the backlog is at `B`:

| Tier | Backlog at death | In transit | **Peak concurrency** |
| --- | --- | --- | --- |
| First-timer (79 s) | 3 | 0.41/s × 6 s = 2.5 | **5.5** |
| Practised (250 s) | 5 | 0.75/s × 4 s = 3.0 | **8.0** |
| Expert (332 s) | 6 | 1.00/s × 3 s = 3.0 | **9.0** |

`MAX_CRAWLERS = 16` sits about **1.8×** above the deepest modelled peak. GAM-17
raised that peak from a modelled 6 to a modelled 9, so the headroom fell from 2.5×
to 1.8× — still high enough that the cap never acts as a difficulty lever, and low
enough to bound the worst case for the overlapping alpha that `docs/concept.md` §9
flags as the performance risk. **The cap was deliberately not raised** (§11.1): it
is a performance rail, `docs/vision.md` §6 criterion 3 is measured at whatever it
is set to, and QA has not yet reported a real peak to calibrate against.

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

**The opposite now needs watching too.** If QA or the simulation shows the spawner
*dropping* spawns (§5.3) before about 300 s, the cap has stopped being a rail and
become a difficulty lever — it would be silently making the late game easier than
§11.1 says it is. Report that as a balance defect, not a performance observation.
Raising the cap is the fix, and it re-opens criterion 3 at the new number.

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

### 12.1 The GAM-17 difficulty curve

Added by the rebalance. Criteria 12–14 are checked by the deterministic
simulation in [`docs/throughput-sim.md`](./throughput-sim.md) and need no build;
15–17 are checked in a browser and 15 needs the GAM-15 cohort.

| # | Criterion | How to verify |
| --- | --- | --- |
| 12 | The shipped config produces the §11.1 curve | Run the simulation against `src/config`. Spawn rate is 0.313/s at `t = 0`, 0.366/s at 45 s, 0.476/s at 120 s, 0.587/s at 180 s, 0.725/s at 240 s, and exactly `1 / SPAWN_INTERVAL_MIN` from `t = 332 s` onward, each within 2% |
| 13 | There is no cliff | From the simulation: `d(spawn rate)/dt ≤ 0.0035 /s²` at every `t`, and **exactly 0** for every `t ≥ 332 s`. Crawler speed is constant for every `t ≥ 198 s`. Therefore no difficulty term in §5.4 changes after 332 s |
| 14 | The asymptote is losing, and the cap is not a difficulty lever | From the simulation: the §10.7 asymptote invariant holds for the shipped config, and modelled peak concurrency stays below `MAX_CRAWLERS` for every `t` up to 400 s |
| 15 | Run lengths land where §11.1 says | Ten first-time runs from the GAM-15 cohort: median inside 45–120 s, and inside 60–100 s if the model is right. One practised player exceeds 180 s. This is criterion 3 above, measured against the new curve |
| 16 | Pressure is felt inside the first minute | Record a first-time run. At least three crawlers are alive simultaneously before `t = 50 s`, and at least 12 crawlers have spawned by `t = 45 s`. §11.1 models 3 on screen at 47 s and 15 spawns by 45 s |
| 17 | The pillars still hold at the new values | **Readability** (`docs/vision.md` §6 criterion 4): no crawler speed value changed, so §11.2 holds verbatim — re-check the joint bound as a product and confirm the worst approach is still ≥ 1.5 s. **Core loop** (`docs/vision.md` §3, the non-veto check): hold a wide beam on a crawler for 30 s at the new `POWER_RECHARGE_RATE` and confirm it stays frozen, does not die, and that power does not fall and is not consumed by freezing. Then focus and confirm it dies after the new `BURN_DWELL_TIME` with a visible drain |

---

## 13. Open items this document does not close

- **Difficulty-curve shape** (`docs/vision.md` §8.1) — MVP ships the continuous
  ramp in §5.4, retuned by GAM-17. Discrete waves with lulls remain open for a
  later milestone: GAM-17 changed the curve's *values*, not its shape, and
  deliberately did not close the ramp-versus-waves question.
- **The backlog tolerance `B`** (§11.1) — the one calibrated input to the run-length
  model, currently 3 / 5 / 6 on the cohort's first measurement. GAM-15 refits it,
  and the recalibration rule at the end of §11.1 says what to do with the result.
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
