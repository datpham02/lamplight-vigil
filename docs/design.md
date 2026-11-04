# Lamplight Vigil — Design Spec and Tuning Table

Milestone: **Playable Vigil** ([`docs/concept.md`](./concept.md) §8, row 1).
Owner: `game-designer`. Approval: `game-director`.

§1–§13 are Playable Vigil. §14 is the first section of the **Online Vigil**
milestone and carries its own approval.

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
tuning table. §14 adds the Online Vigil weekly seed and the closed table of weekly
modifiers; it is a later milestone and is scoped in its own preamble.

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

### 2.5 Suspension — auto-pause when nobody is looking

Closes the `docs/vision.md` §8.6 proposal. **A suspended run is not a fourth
state.** It is still PLAYING; it has simply stopped advancing, and the state
machine above is unchanged.

**What suspends it.** The window losing focus (`blur`), or the tab going into the
background (`visibilitychange` with `document.hidden`). Nothing else. There is no
pause key: a pause the player can take at will is a way to stop the clock while
reading the board, and §8's score is time survived.

**What suspension does.** Everything in PLAYING stops, on the same terms as
§2.3's freeze and then some: no crawler moves or spawns, no power drains or
recharges, no elapsed time accrues, no score is earned, the lamp's pulse holds,
and even a fading burst holds. **A pause can therefore neither earn a point nor
cost one.**

The one thing that still tracks the pointer is the beam's heading, exactly as it
does under §2.3's freeze: aiming advances no rule, reads no geometry while the
run is suspended, and a beam that lied about where the mouse was would only
mislead on the frame the player resumes.

**What ends it.** Any key or any click, exactly as on the title screen. Regaining
focus is deliberately *not* enough: a run that resumed on the frame the window
came forward would put a crawler on the lamp before the player's eyes were back
on the screen, which is the same pillar 2 failure the §2.4 clamp exists to
prevent — a death the screen never showed.

The input that resumes runs through the §2.2 edge trigger, for the reason given
there: it is very often the left mouse button, which is also a focus binding.
Nothing else is reset. Power, beam width and the §4.2 lockout come back exactly
where the suspension froze them, because a pause gives nothing back.

**It is on screen.** Pillar 2 forbids the game holding a stopped run clock the
screen never mentions, and a frozen hollow is otherwise indistinguishable from a
crash. The pause overlay says so in words and says which inputs resume.

**TITLE and GAME_OVER are never suspended.** Neither advances a clock or earns a
score, so there is nothing to protect, and a title screen that stopped breathing
until it was clicked would be a worse first impression than the one it fixes.

**A suspension never retunes the run it suspends.** A pause can last across
midnight, across a laptop sleeping, and across the Monday 00:00 UTC rollover.
§14.2 already rules that the week key and the modifier are resolved once at the
transition to PLAYING and held for the whole run, so a run that resumes in the
next week finishes under the configuration it started in. Suspension resets
nothing and re-reads nothing; it is the clock-change case §14.2 names, reached
by a different route.

### 2.6 The game is a widget, not a page

The game mounts into an element the host page owns and can be taken back off it
again (`src/host`). This is a constraint on the whole of §2, not a feature beside
it, and it is what §2.5 is built out of.

What it requires of everything above:

- **Nothing global and nothing shared.** Two games on one page are two runs. The
  `localStorage` best score in §8 is the single deliberate exception: it is the
  player's, not the instance's.
- **Input is scoped to the container.** The §7 keyboard bindings only fire when
  the game has focus, so a key typed into a form beside the game never reaches
  it, and a key aimed at the game never reaches the form. A pointer press has
  to land inside the game's box to count — a click on the host's own page is
  not a run start, not a resume, and not a focus hold.
- **No audio device before a user gesture.** The §13 cues create their
  AudioContext inside the first click or keypress on the game and not before.
- **The render space in §10.1 is fitted to the container, not to the window.**
  The game letterboxes inside whatever box it is given and never paints outside
  it.
- **Teardown is complete and synchronous.** Mounting and destroying repeatedly
  must leave no listener, timer or audio node behind.

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
| Any key, any click | PLAYING, suspended | Resumes. Runs through the §2.2 edge trigger (§2.5). |

Every one of these is read from the game's own container, never from the window
(§2.6). A key pressed while the page's focus is somewhere else is not an input to
this game.

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

---

## 14. Weekly seed and the modifier table

Milestone: **Online Vigil** (planned in GAM-16, approved by the Board 2026-11-04).
Owner: `game-designer`. **Approval: `game-director`, before OV-2 starts.** This is
task OV-1.

*Placed after §13 rather than before it because `src/config`, `src/scenes` and
`src/enemies` all cite "§13" by number for the three sound cues. Renumbering an
anchor to make a table of contents tidier is not worth a stale reference.*

**D4 — provider and hosting — is still pending with the Board.** Nothing in this
section calls a backend, names one, or assumes one exists. Everything here
resolves on the device, from the device clock and the shipped `src/config`, with
no network access of any kind. The seed is specified as a pure function precisely
so that whatever D4 lands on can recompute the same answer later and verify a
submission without this document changing.

### 14.1 What a weekly modifier is, and what it is not

GAM-16 condition **C1.1** is the rule this whole section exists to enforce:

> A weekly modifier is a tuning value, never a mechanic. Every weekly variation is
> a multiplier or override on an **existing named constant in `src/config`**,
> declared in one closed table. No new entity, no new input, no new beam
> behaviour, and nothing that removes, damages or repels a crawler the beam is not
> touching.

Four rules follow, and each one is checkable:

1. **One entry is active per week.** Not two, not a stack. Two simultaneous
   modifiers square the number of configurations the game can produce, and a week
   that needs two sentences to describe is a pillar 2 failure on the title screen.
2. **One entry touches exactly one constant.** The constant is named in the table
   and is one of the seven in §14.5.
3. **Every entry declares a finite set of values** — not a range the seed samples
   from. This is the load-bearing decision in this section, and §14.6 explains it:
   a finite table is a table CI can enumerate, so *every week the game will ever
   generate* can be checked before any of them happens.
4. **The table is data, in `src/config`.** It is not a module of gameplay code
   with a switch statement in it. `AGENTS.md` puts every tuning value there, the
   simulation already imports from there, and it keeps this table mine to edit
   under the §10 rules rather than a programmer's.

A proposal that cannot be written as a row of §14.5 is not a modifier. It is a
feature, and it comes to me as its own task against pillar 1.

### 14.2 The week key

The **week key** is the ISO-8601 week date of the current UTC instant, formatted
`YYYY-Www` — `2026-W45`. The week begins **Monday 00:00:00 UTC** and runs 7 days.
ISO week 1 is the week containing the first Thursday of January, so a year has 52
or 53 weeks and the first days of January can belong to the previous ISO year.

```ts
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Midnight UTC on the Monday of the week containing `ms`. */
function mondayUtc(ms: number): number {
  const d = new Date(ms);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dayIndex = (new Date(midnight).getUTCDay() + 6) % 7; // Monday = 0
  return midnight - dayIndex * 86_400_000;
}

/** ISO-8601 week date, UTC. */
function weekKey(ms: number): string {
  const thursday = mondayUtc(ms) + 3 * 86_400_000;
  const isoYear = new Date(thursday).getUTCFullYear();
  const jan4 = Date.UTC(isoYear, 0, 4);
  const firstThursday = mondayUtc(jan4) + 3 * 86_400_000;
  const week = 1 + Math.round((thursday - firstThursday) / WEEK_MS);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** Whole weeks since WEEKLY_EPOCH_UTC_MS, floored at 0. */
function weekIndex(ms: number): number {
  return Math.max(0, Math.floor((mondayUtc(ms) - WEEKLY_EPOCH_UTC_MS) / WEEK_MS));
}
```

**`WEEKLY_EPOCH_UTC_MS = Date.UTC(2026, 0, 5)`** — Monday 5 January 2026, the
Monday of `2026-W02`. It is in the past so that no shipped build ever computes a
negative index, and it is a Monday so that `weekIndex` is exact rather than
rounded.

**Worked examples**, which are also acceptance vectors (criterion 18):

| UTC instant | `weekKey` | `weekIndex` |
| --- | --- | --- |
| `2026-01-05T00:00:00Z` | `2026-W02` | 0 |
| `2026-01-11T23:59:59Z` | `2026-W02` | 0 |
| `2026-01-12T00:00:00Z` | `2026-W03` | 1 |
| `2026-11-02T00:00:00Z` | `2026-W45` | 43 |
| `2026-11-08T23:59:59Z` | `2026-W45` | 43 |
| `2026-11-09T00:00:00Z` | `2026-W46` | 44 |
| `2026-12-28T00:00:00Z` | `2026-W53` | 51 |
| `2027-01-03T00:00:00Z` | `2026-W53` | 51 |
| `2027-01-04T00:00:00Z` | `2027-W01` | 52 |

2026 is a 53-week ISO year; the boundary rows above are in the table because that
is the case an implementation gets wrong.

**Why UTC and not local time.** A leaderboard is one global list. If the week key
came from local time, two players in different zones would be on different weeks,
with different modifiers, submitting to the same board — a fairness bug that only
shows up at the edges of the week and is almost impossible to reproduce. The cost
is that the reset lands at an awkward local hour for some players; that is a
smaller problem than a board that silently mixes two configurations.

**Pillar 2 — the week is not hidden state.** The title screen states the week key
and the time remaining in it, in plain words, before a run starts. A player must
never be unable to answer "which week am I playing?"

**The key is resolved once per run, at the transition to `PLAYING`, and held for
the whole run.** A clock change, a midnight rollover or a laptop waking from sleep
mid-run never retunes a run in progress. §2.2 already resets per-run state in
`init()`; the resolved week and modifier are per-run state and belong there.

### 14.3 The seed

Two functions, specified exactly, because a server implemented against D4 later
must reproduce them byte for byte.

**FNV-1a, 32-bit**, over the UTF-8 bytes of the string:

```ts
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;                       // offset basis
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;  // prime 16777619
  }
  return hash >>> 0;
}
```

**mulberry32**, a 32-bit PRNG, used only to shuffle the schedule in §14.4:

```ts
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return (t ^ (t >>> 14)) >>> 0;             // uint32, not a float
  };
}
```

**Conformance vectors** (criterion 19):

| Input | `fnv1a32` | hex |
| --- | --- | --- |
| `""` | 2166136261 | `0x811c9dc5` |
| `"a"` | 3826002220 | `0xe40c292c` |
| `"lamplight-vigil"` | 2718592447 | `0xa20a6dbf` |
| `"lamplight-vigil/weekly/1\|block\|0"` | 3239841354 | `0xc11c0e4a` |
| `"lamplight-vigil/weekly/1\|2026-W45\|plain\|value"` | 3660224661 | `0xda2a9895` |

**`WEEKLY_SEED_NAMESPACE = 'lamplight-vigil/weekly/1'`.** Every seed string is the
namespace, then `|`-joined fields. The trailing `1` is a schedule version: bumping
it reshuffles every week from that build onward, and it is the only sanctioned way
to reshuffle the schedule deliberately. Bumping it is a design decision and needs
`game-director` approval, like a table entry does.

**Why not `crypto.subtle` or `Math.random`.** `Math.random` is unseedable and
therefore cannot produce the same week twice, let alone the same week on two
devices. `crypto.subtle.digest` is asynchronous, which would put a promise in the
path between pressing a key and a run starting — pillar 3's restart budget is
1.0 s and it is not spending any of it on a hash. FNV-1a is twenty lines, is
synchronous, has no dependency, and this is not a security problem: nobody gains
anything by predicting next week's modifier, and the table is published in this
document anyway.

### 14.4 Selection — the eight-week block schedule

Entries are not drawn independently each week. The week's entry is its slot in a
shuffled permutation of the whole table:

```
index  = weekIndex(now)
block  = Math.floor(index / N)          // N = WEEKLY_MODIFIERS.length
slot   = index % N
order  = blockOrder(block)
entry  = order[slot]
value  = entry.values[fnv1a32(`${NS}|${key}|${entry.id}|value`) % entry.values.length]
```

where `blockOrder` is a Fisher–Yates shuffle of the table — **iterated in `id`
order, so it does not depend on how the array happens to be written** — driven by
`mulberry32(fnv1a32(`${NS}|block|${block}`))`:

```ts
function rawBlockOrder(block: number): readonly string[] {
  const order = WEEKLY_MODIFIERS.map((m) => m.id).sort();
  const next = mulberry32(fnv1a32(`${WEEKLY_SEED_NAMESPACE}|block|${block}`));
  for (let i = order.length - 1; i >= 1; i -= 1) {
    const j = next() % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function blockOrder(block: number): readonly string[] {
  const order = [...rawBlockOrder(block)];
  if (block > 0) {
    const previous = rawBlockOrder(block - 1);
    // Swap the first two entries if this block would open on the entry the last
    // one closed with. The swap never touches order[N - 1], so a block's closing
    // entry is always rawBlockOrder(block)[N - 1] — which is exactly what the
    // test above reads. See "Why a swap and not a rotation". Requires N >= 3.
    if (order[0] === previous[previous.length - 1]) {
      [order[0], order[1]] = [order[1], order[0]];
    }
  }
  return order;
}
```

**Why a swap and not a rotation.** The obvious fix-up — rotate the block left by
one — is wrong, in a way that is worth recording because it is not visible by
reading and does not show up in a short measurement.

A left rotation moves `order[0]` to the end, so a rotated block's closing entry is
`rawBlockOrder(b)[0]`, not `rawBlockOrder(b)[N - 1]`. The next block tests against
`rawBlockOrder(b - 1)[N - 1]`, so whenever block `b - 1` rotated, the test reads
the wrong element and fails two ways: it misses a genuine collision when
`raw(b)[0] === raw(b - 1)[0]`, and it rotates needlessly when
`raw(b)[0] === raw(b - 1)[N - 1]`, which can hand the opening slot to an entry that
collides anyway. Testing `blockOrder(b - 1)` instead would be correct but would
chain every block back to the epoch, costing property 3.

A swap of the first two elements is the fix because it leaves `order[N - 1]`
alone. The quantity the next block tests becomes rotation-independent, so the
recursion never has to happen and `blockOrder` stays O(1) and stateless. The new
opener `raw(b)[1]` cannot equal `raw(b)[0]` — a block is a permutation — so the
collision is genuinely closed rather than moved.

**Measured, over 99 999 block boundaries:** the rotation leaks **1838** repeated
weeks (one boundary in 54); the swap leaks **0**. The swapped order is still a
permutation and its closing entry still equals `rawBlockOrder(b)[N - 1]` at every
one of the first 20 000 blocks.

**This is why criterion 21 counts boundaries rather than sampling weeks.** The
rotation's first leak is at block 128 — weeks 1023 and 1024, about nineteen years
past the epoch — so a 520-week sample sees zero instances and reports the property
as holding. It is not a rare bug that a longer sample would have caught; it is a
bug that *this particular seed* hides for nineteen years, and bumping the schedule
version in §14.3 re-rolls that dice and may put the first leak in week 20. A
property guaranteed "by construction" must be tested as a property, not estimated
from a sample.

**Three properties this buys, none of which an independent weekly draw has:**

1. **Every entry appears exactly once every `N` weeks.** Over 520 weeks each of
   the eight entries comes up 65 times — exactly 12.5%, not approximately.
   Independent draws gave 10.2% to 14.6% over the same span.
2. **No two consecutive weeks share an entry.** Guaranteed by construction, not by
   luck — the swap above is what makes that sentence true, and criterion 21 is
   what keeps it true. Verified over 99 999 consecutive block boundaries: zero
   repeats. An independent draw repeats 1 week in 8 and produced a run of four
   identical weeks inside 520. "The twist did not change this week" is the single
   worst thing a weekly feature can say, and it is now unrepresentable.
3. **It is O(1) and stateless.** The answer depends on the clock and nothing else:
   no stored history, no chain to replay from an epoch, no `localStorage`. A fresh
   install and a two-year-old one resolve the same week identically.

**Conformance vector** (criterion 22) — the first ten weeks from the Board's
approval date, at the table in §14.5:

| Week | `weekIndex` | Entry | Value |
| --- | --- | --- | --- |
| `2026-W45` | 43 | `clinging-dark` | ×1.30 |
| `2026-W46` | 44 | `plain` | ×1.00 |
| `2026-W47` | 45 | `one-axis` | `over-the-top` |
| `2026-W48` | 46 | `restless-hollow` | ×1.10 |
| `2026-W49` | 47 | `hungry-flame` | ×1.10 |
| `2026-W50` | 48 | `narrow-lantern` | ×1.15 |
| `2026-W51` | 49 | `clinging-dark` | ×1.15 |
| `2026-W52` | 50 | `crowded-threshold` | ×1.06 |
| `2026-W53` | 51 | `hungry-flame` | ×1.20 |
| `2027-W01` | 52 | `one-axis` | `long-dark` |

These ten weeks span blocks 5 and 6. **Re-derived under the corrected
`blockOrder`, the vector is unchanged**: neither block collides with its
predecessor, so neither swaps, and all ten rows resolve identically under the old
and the new rule. Block 4 closes on `narrow-lantern` and block 5 opens on
`thin-wick`; block 5 closes on `hungry-flame` and block 6 opens on
`narrow-lantern`. The vector above is therefore correct against the code in this
section, not inherited from the draft it replaces.

**Editing the table changes history.** Adding, removing or renaming an entry
changes `N` and every permutation after it, so past weeks resolve differently than
they did when they were played. Two consequences, both rules:

- **A submitted score records the resolved `id` and value it was played under.**
  It is never recomputed from the week key after the fact. Which field carries it
  is D4's business; *that* it is carried is this section's requirement, and OV-3
  must not design a payload without it.
- **Edits land at a block boundary.** An entry added mid-block would change the
  remaining weeks of a block players are already inside. Ship a table edit so it
  takes effect at `index % N === 0`, or accept and state that the current block is
  reshuffled.

### 14.5 The closed table

Eight entries, fifteen cells. Every value in the "Values" column is the complete
set a week can resolve to — there is nothing between them.

`plain` is a ×1.00 multiplier rather than a special case, so that the schedule, the
submission payload and the CI sweep have no "no modifier" branch to get wrong. A
plain week is a cell like any other, and the sweep checks that it reproduces §11.1
exactly.

| # | `id` | On screen | Constant | Kind | Values | Resolved | Modelled first-timer run |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `plain` | **A plain vigil.** The hollow as it is. | `SPAWN_INTERVAL_START` | multiplier | ×1.00 | 3.20 s | 79.1 s |
| 2 | `restless-hollow` | **A restless hollow.** The crawl is quicker / slower this week. | `CRAWLER_SPEED_BASE` | multiplier | ×0.90, ×1.10 | 46.8, 57.2 px/s | 79.1 s (see §14.6) |
| 3 | `clinging-dark` | **The dark clings.** Burning one takes longer. | `BURN_DWELL_TIME` | multiplier | ×1.15, ×1.30 | 0.46, 0.52 s | 68.7 s, 59.9 s |
| 4 | `thin-wick` | **A thin wick.** The lamp recovers slowly. | `POWER_RECHARGE_RATE` | multiplier | ×0.90, ×0.85 | 19.8, 18.7 power/s | 64.7 s, 57.9 s |
| 5 | `hungry-flame` | **A hungry flame.** Focusing costs more. | `POWER_DRAIN_RATE` | multiplier | ×1.10, ×1.20 | 28.6, 31.2 power/s | 66.0 s, 55.7 s |
| 6 | `crowded-threshold` | **A crowded / quiet threshold.** They come sooner / later at first. | `SPAWN_INTERVAL_START` | multiplier | ×0.94, ×1.06 | 3.008, 3.392 s | 61.9 s, 95.7 s |
| 7 | `narrow-lantern` | **A narrow / broad lantern.** The wide beam holds less / more of the field. | `BEAM_WIDE_ANGLE_DEG` | multiplier | ×0.85, ×1.15 | 59.5°, 80.5° | 73.8 s, 83.9 s |
| 8 | `one-axis` | **The long dark / Over the top.** They come from the sides / from above and below. | `SPAWN_EDGE_WEIGHTS` | override | see below | — | 79.1 s (see §14.6) |

`one-axis` overrides the whole record, and both values sum to 1 (B7):

| Value | `top` | `bottom` | `left` | `right` |
| --- | --- | --- | --- | --- |
| `long-dark` | 0.05 | 0.05 | 0.45 | 0.45 |
| `over-the-top` | 0.40 | 0.40 | 0.10 | 0.10 |

**Modelled run lengths are from the shipped simulation**, one cell at a time at
`dt = 0.01`, not from a second opinion about the model.

**Practised-tier run length, all fifteen cells**, which criterion B9 also bounds
and criterion 30 checks. Listed per cell rather than per displayed row, so the
count matches the fifteen the sweep reports:

| Cell | First-timer | Practised |
| --- | --- | --- |
| `plain ×1.00` | 79.1 s | 250.3 s |
| `restless-hollow ×0.90` | 79.1 s | 250.3 s |
| `restless-hollow ×1.10` | 79.1 s | 250.3 s |
| `clinging-dark ×1.15` | 68.7 s | 231.4 s |
| `clinging-dark ×1.30` | 59.9 s | 213.8 s |
| `thin-wick ×0.90` | 64.7 s | 235.6 s |
| `thin-wick ×0.85` | 57.9 s | 227.3 s |
| `hungry-flame ×1.10` | 66.0 s | 237.0 s |
| `hungry-flame ×1.20` | 55.7 s | 224.4 s |
| `crowded-threshold ×0.94` | 61.9 s | 232.7 s |
| `crowded-threshold ×1.06` | 95.7 s | 266.9 s |
| `narrow-lantern ×0.85` | 73.8 s | 245.3 s |
| `narrow-lantern ×1.15` | 83.9 s | 254.9 s |
| `one-axis long-dark` | 79.1 s | 250.3 s |
| `one-axis over-the-top` | 79.1 s | 250.3 s |

Every one is over the 180 s floor, the lowest being `clinging-dark ×1.30` at
213.8 s.

**The four cells that read exactly as the base config are model-invisible, not
unmeasured.** `restless-hollow` (both values) and `one-axis` (both values) change
constants the run-length model does not integrate over — §14.6 says why, and for
`one-axis` it is the right answer rather than a gap. Each was run through the sim
individually and returned 79.08 s / 250.32 s / 332.42 s, identical to base to the
reported precision. QA should expect those four rows to match `plain` exactly; a
row that *differs* is the thing to report.

**`hungry-flame ×1.20` at 55.7 s is the tightest cell in the table** — 0.7 s above
the 55 s band floor. It is inside the band and correct by the band's own logic
(§14.6), but it has the least room of any cell, so it is the **first to revisit
once GAM-15 refits `B`**, ahead of `restless-hollow`, whose bound is a judgement
rather than a measurement. If a refit moves it below 55 s, it comes back to
`game-director` as a bound question, per §14.9 — it does not get nudged to ×1.18
in place.

**Where the derived constants are concerned.** `src/config` computes
`BEAM_WIDE_HALF_ANGLE_RAD` from `BEAM_WIDE_ANGLE_DEG` at module load. A modifier
on a constant other exports are derived from must be applied **before** the
derivation, not after it, or the cone's geometry and its half-angle disagree —
which is a freeze that happens outside the drawn cone, and a pillar 2 failure.
`BEAM_WIDE_ANGLE_DEG` is the only entry in this table with that property today.

**Floating point.** A modifier is a single IEEE-754 double multiply of a literal by
a literal. That is bit-identical on every platform and in every browser, so two
players on the same week are playing the same numbers, and `3.2 × 0.94` is whatever
it is as long as it is the same everywhere.

### 14.6 How each bound was derived

Four different things bound this table, and knowing which one binds an entry is
the difference between retuning it safely and guessing.

#### The cell band: every cell lands in 55–110 s

`docs/vision.md` §6 criterion 2 wants a median first-time run in **45–120 s**. This
table is held to the tighter **55–110 s**, and the margin is not arbitrary.

The model's one calibrated input is `B`, the backlog tolerance (§11.1), and GAM-15
refits it. Measured sensitivity at the shipped config: `B = 3 → 79.1 s`,
`B = 2.55 (−15%) → 73.8 s`, `B = 3.45 (+15%) → 83.9 s`. So a ±15% recalibration of
`B` moves a run length by about ∓6.7%/+6.1% — run length is markedly *less*
sensitive to `B` than linearly. Shrink the criterion window by that error and you
get the band: a cell at 55 s survives a −15% refit at 51.3 s, still inside 45 s;
a cell at 110 s survives a +15% refit at 116.7 s, still inside 120 s.

**The band is the criterion window minus the model's own calibration error.** It is
what lets GAM-15's refit land without retiring a published week.

#### The asymptote invariant fences the whole easy side of the power economy

This is the most useful thing the arithmetic turned up, and it is why entries 3, 4
and 5 are one-directional.

The §10.7 asymptote invariant is
`SPAWN_INTERVAL_MIN < (BEAM_TRANSITION_TIME + BURN_DWELL_TIME) × (POWER_DRAIN_RATE + POWER_RECHARGE_RATE) / POWER_RECHARGE_RATE`,
and at the shipped config it holds by 13.5%. Every way of making the power economy
*kinder* pushes the right-hand side **down**, toward the floor interval:

| Direction | Where the margin goes |
| --- | --- |
| `BURN_DWELL_TIME` ×0.95 | 13.5% → 9.1% |
| `POWER_RECHARGE_RATE` ×1.08 | 13.5% → 8.9% |
| `POWER_DRAIN_RATE` ×0.90 | 13.5% → 7.3% |
| `SPAWN_INTERVAL_MIN` ×1.10 | 13.5% → 3.2% |

This table requires **at least 10% of margin on B3 for any published cell** —
enough that a later retune of the base config under §10 does not silently push a
week that already shipped through the invariant. Every "easier" direction above
breaches that before it is big enough for a player to notice, so:

- `clinging-dark`, `thin-wick` and `hungry-flame` **only go the harder way.**
- `SPAWN_INTERVAL_MIN` is not in the table at all.

That is not a limitation to work around; it is the invariant doing exactly its job.
It exists so that the game's hardest state still out-produces perfect play and
every run ends. A weekly modifier is the last thing that should be allowed to
quietly buy a good player an unbounded run — and the easy side of the power economy
is precisely the direction that would.

The easier weeks therefore come from somewhere else: a quieter opening
(`crowded-threshold ×1.06`), a broader cone (`narrow-lantern ×1.15`), a slower crawl
(`restless-hollow ×0.90`), roomier approaches (`one-axis long-dark`).

#### B5 fences the quiet opening

`crowded-threshold` cannot go far upward either, and the bound is not run length —
it is **B5, `floorBindsAt ≤ 360 s`**. The floor binds at
`ln(SPAWN_INTERVAL_START / SPAWN_INTERVAL_MIN) / 0.003506` seconds, so stretching
the opening pushes the moment the game stops getting harder out past the horizon:

| `SPAWN_INTERVAL_START` | `floorBindsAt` | B5 | First-timer run |
| --- | --- | --- | --- |
| ×1.06 → 3.392 | 348.4 s | pass (3.2% margin) | 95.7 s |
| ×1.08 → 3.456 | 353.7 s | pass (1.8% margin) | 101.0 s |
| ×1.15 → 3.680 | 371.6 s | **FAIL** | 118.9 s |

×1.15 is still inside the 45–120 s window at 118.9 s and still inside
`SPAWN_INTERVAL_START`'s own §10.7 safe range. It fails anyway, on an invariant two
subsections away. This is the §10.5 / §10.7 joint-bound failure mode happening to a
weekly modifier, and it is the clearest evidence that this table needs the CI sweep
rather than a reviewer's judgement.

Downward, the bound is the cell band: ×0.85 gives a 41.2 s first-timer run, outside
the criterion outright. ×0.94 (61.9 s) is the published value, and it is a real
change — three crawlers on screen at **29 s** instead of 47 s.

#### What the model is blind to, and what bounds those entries instead

The run-length model integrates arrivals against a flat kill capacity. Two entries
— four cells — do not appear in that arithmetic at all, and the sweep will
correctly report their run lengths as unchanged. All four were run through the sim
individually to confirm that rather than assume it; they return the base figures
exactly (§14.5). That is not a gap to paper over: for one entry it is the right
answer, and for the other it is a bound stated by hand.

- **`one-axis` — correctly invisible.** §11.1 lists `SPAWN_EDGE_WEIGHTS` among the
  values that are "placement and grace, not pressure"; the weights appear nowhere
  in the model because they genuinely change nothing about arrival rate or kill
  capacity. Readability is also safe for a reason worth stating precisely: the
  top/bottom approach is the short one (2.37 s at the capped, jittered speed), and
  it **already exists at weight 0.2**. Re-weighting changes how often a crawler
  takes an approach that is already in the game; it cannot create an approach
  shorter than the shortest one, so B2 is untouched by construction.
  *QA note:* with 0.8 of the weight on two edges, the §6.3 anti-clustering re-roll
  budget is under more pressure. Watch for visibly stacked spawns on the heavy
  axis and report the rate; the fix would be `SPAWN_PLACEMENT_ATTEMPTS`, which is a
  §10 retune, not a code change.
- **`restless-hollow` — invisible, and bounded by hand.** §3 of
  `docs/throughput-sim.md` is explicit that speed shortens a crawler's *deadline*
  rather than the player's capacity, and the model handles that through `B`, not
  through capacity. So the sweep bounds this entry through B1 and B2 only:
  `CRAWLER_SPEED_MAX` is untouched, so effective top speed stays 98.6 px/s and the
  worst approach stays 2.37 s against the 1.5 s floor. What does move is
  `speedCapsAt` — 198 s at base, **153.9 s at ×1.10** — i.e. the crawl reaches its
  ceiling sooner, and §11.2's base-speed journey time goes from 4.5 s to 4.1 s.
  Both are comfortably inside the readability bound. The ±10% bound on this entry
  is therefore a judgement, deliberately set tight because the sweep is only
  half-checking it, and it is the entry to revisit first once GAM-15 has refit `B`.
- **`narrow-lantern` — made visible on purpose.** §11.1 anchors `B` on
  `360 / BEAM_WIDE_ANGLE_DEG`, so a cone modifier genuinely does change the
  backlog tolerance, and the sweep must say so. **Required coupling:** when the
  sweep applies a `BEAM_WIDE_ANGLE_DEG` multiplier `m`, it scales every tier's
  `backlogTolerance` by the same `m`. That is the one place the sweep is allowed to
  touch a §4 tier parameter, it is why this entry's run lengths differ from the
  base at all, and it keeps the most interesting modifier in the table honestly
  checked instead of excluded.

### 14.7 Constants deliberately **not** in the table

Recorded so they are not reopened one task at a time.

| Constant | Why not |
| --- | --- |
| `SPAWN_INTERVAL_DECAY_PER_SECOND` | §10.7 calls it the most sensitive value in the table: it sets all three capacity crossings at once and §11.1 must be re-derived before it moves. A week that changes the slope is a different game, not a twist |
| `SPAWN_INTERVAL_MIN` | Owns how hard the game ever gets, and B3 leaves it 3.2% of margin at ×1.10 (§14.6) |
| `CRAWLER_SPEED_MAX`, `CRAWLER_SPEED_JITTER` | The joint speed bound (§10.5) is the one readability margin §11.1 says is worth keeping. A candidate for a later entry once QA has footage; not for the first table |
| `MAX_CRAWLERS` | A performance rail, not a balance lever (§5.3, §11.4). `docs/vision.md` §6 criterion 3 is measured at whatever it is set to, so a weekly value would make the frame-rate criterion unmeasurable |
| `POWER_MAX`, `POWER_START`, `POWER_FOCUS_REARM` | The bar's scale and the §4.2 rearm mark are what the HUD is drawn against. Moving them weekly makes the power meter mean something different each week — pillar 2 |
| `BEAM_FOCUS_RANGE`, `BEAM_WIDE_RANGE`, `BEAM_FOCUS_ANGLE_DEG` | §3.2 facts 1 and 2 (B8) are the geometry the whole width decision rests on: focused reaches the corners, wide does not reach the side edges. Not weekly |
| `SCORE_PER_SECOND_SURVIVED`, `SCORE_PER_BANISH` | Scores from different weeks already sit on one board. Re-weighting the formula weekly would make the number itself mean something different each week, which is worse than a harder week |
| `SCORE_STORAGE_KEY`, every `INPUT_*` | Changing a binding or a storage key weekly is self-evidently hostile. Listed only so no one has to ask |
| Every colour, and everything under HUD | `ui-designer` owns the palette, and C1.2 forbids a cosmetic that touches the beam. A recoloured week is also the shape of "content you log in for" that C1.1 fences off |

### 14.8 Free Play

**Free Play is unseeded, unranked, and carries no modifier.** It runs the shipped
`src/config` exactly as committed: it never reads the clock for a week key, never
resolves an entry, never submits a score, and never shows a rank.

- **Both modes keep the same local best score.** `SCORE_STORAGE_KEY` and the
  degrade-gracefully behaviour in `src/scenes/bestScore.ts` are unchanged (C3.3).
  A per-week local best is additive and is OV-3's call, not this table's.
- **The game-over screen names the mode the run was played in**, because one
  best-score number now spans two configurations and an unlabelled number is state
  the screen is not showing. The screen work is OV-2's; the requirement is mine.
- **The mode choice lives on the title screen only**, and `R` from game-over always
  restarts the mode you were already in (GAM-16, pillar 3). The restart path never
  grows a step, in either mode.
- **A weekly run never waits on the clock.** The week key is a local arithmetic
  function of `Date.now()`. There is no fetch, no time-sync and nothing to await
  between the keypress and the first playable frame.

### 14.9 The sweep — what `npm run sim` must check

GAM-16 condition **C2.1** requires the simulation to iterate the whole declared
table and exit non-zero on a breach. This is the highest-value thing in OV-1: it
turns the fence from a promise into a build failure.

**Invocation.** `npm run sim -- --modifiers` sweeps every cell; plain `npm run sim`
keeps its current behaviour exactly, so GAM-17's gate is untouched.

**Per cell, assert Group B of `docs/throughput-sim.md` §7, plus three more:**

| # | Assertion |
| --- | --- |
| B1–B8 | Unchanged, per cell |
| B9 | First-timer run in **[55, 110] s** (the §14.6 band, tighter than B9's own 45–120 s) and practised > 180 s |
| W1 | The resolved value lies inside the constant's own §10 safe range. A week can never put the game somewhere a designer could not have tuned it by hand |
| W2 | The entry names a constant on the §14.5 list, and the cell changes **that constant only** |
| W3 | The `plain` cell reproduces the shipped config's Group A numbers exactly. If it does not, the override layer is lying about something |

**Group A is not run per cell.** It reproduces §11.1 *at the shipped config* and is
expected to fail under a modifier by design — `restless-hollow ×1.10` moves
`speedCapsAt` from 198 s to 153.9 s, which is the modifier working, not a defect.
Run Group A once, for the base config, exactly as now.

**Two things this needs from the implementer, neither of which is a design
decision:**

1. **A config-override surface.** `tools/throughput-sim.ts` and
   `src/enemies/CrawlerField.ts` read `src/config` through module-level imports, so
   there is currently no way to evaluate the curve at anything but the shipped
   values. Thread a config object through `spawnInterval`, `rampedSpeed` and the
   model. **It must not change shipped behaviour at the base config** — the
   existing `npm run sim` output and `CrawlerField.test.ts` are the regression.
   How it is threaded is yours; that the sim imports the real curve functions
   rather than re-implementing them (`docs/throughput-sim.md` §2) still holds.
2. **The `backlogTolerance` coupling** for `BEAM_WIDE_ANGLE_DEG`, specified in
   §14.6. It applies to that constant and no other.

**Report the sweep's full output in the PR**, as §9 of `docs/throughput-sim.md`
already requires for the base run. If a cell is outside tolerance, say so on the
task rather than adjusting the cell — the bound is a design question and it is
mine.

### 14.10 Acceptance criteria — Online Vigil, OV-1

Continuing the numbering in §12 and §12.1, so QA can cite a criterion by number
across the whole document.

| # | Criterion | How to verify |
| --- | --- | --- |
| 18 | The week key is a pure function of the UTC clock, per ISO-8601 | Unit test over the nine vectors in §14.2, including the `2026-W53` → `2027-W01` boundary. Freeze the clock; no other input |
| 19 | The seed functions match the published vectors | Unit test over the five `fnv1a32` vectors in §14.3. A mismatch means a future server will disagree with the client |
| 20 | A week resolves with no network access | Block the network at the browser, load the game, and confirm the title screen names the week and its modifier. No request is made and nothing is awaited |
| 21 | Every entry appears exactly once per eight-week block, and no two consecutive weeks share one | **Two assertions, and the second must not be a sample.** (a) *Count:* iterate 520 weeks from `WEEKLY_EPOCH_UTC_MS`; each of the eight `id`s appears exactly 65 times and the longest run of one `id` is 1. (b) *Boundary, as a property:* for every block `b` in `1 .. 10_000`, assert `blockOrder(b)[0] !== blockOrder(b - 1)[N - 1]`, and assert `blockOrder(b)` is a permutation of all `N` ids. Sampling 520 weeks passes on a schedule whose first repeat is nineteen years out (§14.4), so (a) alone is not evidence for this criterion |
| 22 | The schedule matches the published vector | The ten weeks in §14.4 resolve to exactly those entries and values |
| 23 | Every resolved value is inside its constant's §10 safe range | Sweep assertion W1 |
| 24 | The sweep fails loudly on a bad cell | Temporarily add a cell outside the band (for example `SPAWN_INTERVAL_START ×1.15`, which breaks B5), confirm `npm run sim -- --modifiers` exits non-zero and names the cell and the assertion, then revert it |
| 25 | No modifier adds an entity, input or beam behaviour | Read the diff: the table is data in `src/config`, and the only constants it names are the seven in §14.5. Then run the pillar 1 QA check (`docs/vision.md` §3) on a modified week — exercise every input and confirm each only aims or shapes the beam |
| 26 | The modifier is resolved once, at run start, and never changes mid-run | Start a weekly run, change the system clock across a Monday boundary mid-run, and confirm nothing retunes. The next run picks up the new week |
| 27 | The active modifier is not hidden state | Its name and its effect are on the title screen before the run and on the game-over screen after it, in plain words, with the week key. A player who has never read this document can say what is different this week |
| 28 | Free Play is unseeded, unranked and unmodified | Play Free Play on a week whose modifier is `clinging-dark ×1.30` and confirm a burn takes the shipped 0.40 s, no rank appears and no submission is attempted |
| 29 | The restart path never grows a step | `R` from game-over restarts the mode just played, with no mode prompt, inside the §12 criterion 8 budget. Measure it in both modes |
| 30 | Every cell lands in the modelled band | From the sweep: first-timer run in [55, 110] s and practised > 180 s for all fifteen cells. The §14.5 per-cell table lists the expected value for each — fifteen rows for fifteen cells, including the four that are expected to equal `plain` exactly |
