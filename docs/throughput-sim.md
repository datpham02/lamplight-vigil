# Throughput simulation — build specification

Owner of this spec: `game-designer`. Implementer: `gameplay-programmer`, in the
task that follows GAM-17. Approval: `game-director`.

**Where this sits.** [`docs/design.md`](./design.md) §11.1 derives the difficulty
curve by hand. This document specifies the script that checks that derivation
against the values actually in `src/config`, on demand and in CI-friendly form.
The two must agree. **If the script and §11.1 disagree, one of them has a bug and
the task that finds the disagreement fixes both** — do not quietly adjust the
script's expectations to match whatever it printed.

**What it is not.** It is not a game simulator. It does not place crawlers, pick
edges, aim a beam, or roll dice. It integrates two closed-form curves and one
first-order model of a player, and prints the result. Nothing in it renders and
nothing in it is random.

---

## 1. Why it exists

Three of the design's invariants are products of values that live in different
subsections of the tuning table, and every one of them can be broken by a retune
in which no single value leaves its own documented safe range:

- the **joint speed bound** (`docs/design.md` §10.5) — readability,
- the **asymptote invariant** (§10.7) — that the game's hardest state still
  out-produces perfect play,
- the **no-cliff bound** (§11.1) — that the shortfall between arrivals and kill
  capacity never accelerates past `0.0035 /s²` and stops growing at the floor.

A designer retuning `src/config` cannot be expected to re-derive §11.1 by hand
each time, and reviewers demonstrably do not. The script makes those invariants
executable, so a bad retune fails loudly instead of shipping.

Its second job is the GAM-15 playtest. GAM-15 measures run length; §11.1 predicts
run length from one calibrated parameter (`B`, the backlog tolerance). The script
is how the prediction is refitted to what the cohort actually did.

---

## 2. Placement, invocation, and the single source of truth

| | |
| --- | --- |
| Path | `tools/throughput-sim.ts` (a new top-level `tools/` directory; it is not gameplay code and does not belong under `src/`) |
| Invocation | `npm run sim`, a new `package.json` script running `node --import tsx tools/throughput-sim.ts` |
| Runtime | Node 20+, the tooling runtime already declared in `AGENTS.md`. No browser, no Phaser, no DOM |
| Dependencies | **None beyond what the repository already has.** `tsx` and `typescript` are already dev dependencies; adding a package for this is out of scope |
| Typecheck | Must pass `npm run typecheck` under the existing strict `tsconfig.json`, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` |

**Every balance value is imported from `src/config/index.ts`. Not one of them is
re-declared in the script.** This is the whole point: a simulation with its own
copy of `SPAWN_INTERVAL_START` is a document that goes stale, not a check. The
only numbers the script may define for itself are the skill-tier behavioural
parameters in §4 and the acceptance thresholds in §7, both of which are properties
of the *model* rather than of the game.

Where `src/enemies/CrawlerField.ts` already exports a pure function for a curve —
`spawnInterval(t)` and `rampedSpeed(t)` — **import and call it rather than
re-implementing the formula.** That makes the script a check on shipped behaviour
rather than on a second opinion about it.

---

## 3. The model, normatively

This is the model `docs/design.md` §11.1 is derived from. Implement this and
nothing cleverer; a more sophisticated model would no longer be checking the
design document.

Let `t` be elapsed run time in seconds and `n(t)` the **backlog** — unserviced
crawlers in flight.

```
rate(t)        = 1 / spawnInterval(t)                        // src/enemies
speed(t)       = rampedSpeed(t)                              // src/enemies

duty           = POWER_RECHARGE_RATE
                 / (POWER_DRAIN_RATE + POWER_RECHARGE_RATE)

drainPerKill   = BEAM_TRANSITION_TIME + BURN_DWELL_TIME + tier.wasteFocused
cycleSeconds   = max(drainPerKill + tier.aimWide + BEAM_TRANSITION_TIME,
                     drainPerKill / duty)
capacity       = 1 / cycleSeconds                            // constant in t

dn/dt          = max(0, rate(t) - capacity)
```

The run **ends at the first `t` where `n(t) ≥ tier.backlogTolerance`.**

Derived outputs:

```
crossing       = first t where rate(t) >= capacity           // null if never
cumulativeSpawns(t) = ∫₀ᵗ rate(u) du
banished(t)    = cumulativeSpawns(t) - n(t) - inTransit(t)
inTransit(t)   = rate(t) * tier.meanAliveSeconds
concurrency(t) = n(t) + inTransit(t)
score(t)       = floor(t * SCORE_PER_SECOND_SURVIVED)
                 + floor(banished(t)) * SCORE_PER_BANISH
```

Four properties of the model that are deliberate, and that a reviewer should not
"fix":

1. **Capacity does not vary with `t`.** Nothing in §10 makes a player better or
   worse over a run. Crawler speed rises, but speed shortens the *deadline* for a
   crawler, which this model handles through `backlogTolerance`, not through
   capacity.
2. **The backlog never recovers.** `dn/dt` is floored at zero, so a player who is
   ahead stays at `n = 0` and never banks credit. The ramp is monotonic (§5.4), so
   there are no lulls to bank credit in. If the ramp-versus-waves question
   (`docs/vision.md` §8.1) is ever reopened, this is the first line of the model
   that has to change.
3. **Freezing is not throughput.** A frozen crawler is deferred, not removed. Its
   whole contribution to the model is the size of `backlogTolerance`.
4. **`backlogTolerance` is calibrated, not derived.** §11.1 anchors it on
   `360 / BEAM_WIDE_ANGLE_DEG ≈ 5` and GAM-15 refits it. Everything else in the
   model is arithmetic over `src/config`.

---

## 4. Skill tiers

Three tiers, defined in the script as a single exported table so a designer can
read and edit them without reading the integration code.

| Tier key | `aimWide` (s) | `wasteFocused` (s) | `backlogTolerance` | `meanAliveSeconds` |
| --- | --- | --- | --- | --- |
| `first-timer` | 1.10 | 0.90 | 3 | 6 |
| `practised` | 0.50 | 0.25 | 5 | 4 |
| `expert` | 0.30 | 0.05 | 6 | 3 |

What each one means, so they can be argued with rather than merely believed:

- **`aimWide`** — seconds between finishing one banish and having the next target
  inside the cone, spent wide and therefore recharging. A mouse swing across a
  quarter to a third of a 960 px canvas, plus the decision to make it.
- **`wasteFocused`** — focused seconds that produce no banish: holding past the
  moment the crawler dies, and re-earning dwell lost to decay after a wobble. At
  `BURN_DECAY_MULTIPLIER = 1.5`, each 0.1 s off target costs 0.15 s of dwell.
- **`backlogTolerance`** — unserviced crawlers the player can keep frozen before
  one slips through on a bearing the beam is not on.
- **`meanAliveSeconds`** — mean lifetime of a crawler the player *does* service.
  Used only for the concurrency readout, never for the run-length integration.

The tier table must be overridable from the command line —
`npm run sim -- --tier practised --backlog 4.2` — so GAM-15's refit can be tried
without editing the file.

---

## 5. Output

Two sections on stdout. Plain text by default; `--csv` emits the time series alone,
with a header row, for pasting into a spreadsheet.

**5.1 Time series,** one row per `--step` seconds (default 15) to `--horizon`
(default 400 s), with columns:

`t`, `interval`, `rate`, `speed`, then per tier: `capacity`, `deficit`,
`backlog`, `concurrency`.

Rows at `t` past a tier's run length print that tier's columns as `—`.

**5.2 Summary,** one block per tier:

`capacity`, `cycleSeconds`, `crossing`, `runLength`, `cumulativeSpawns`,
`banished`, `score`, `peakConcurrency`.

Followed by the curve landmarks, which are properties of the config rather than of
any tier: `floorBindsAt` (first `t` where `spawnInterval(t) === SPAWN_INTERVAL_MIN`),
`speedCapsAt`, `scoreCrossoverAt` (first `t` where
`rate(t) × SCORE_PER_BANISH ≥ SCORE_PER_SECOND_SURVIVED`), `maxRateSlope`, and the
asymptote invariant's two sides.

---

## 6. Determinism

Non-negotiable, because the acceptance numbers in §7 are exact:

- **No RNG.** No `Math.random`, no seeded generator, no sampling of any kind. The
  script must contain no source of randomness to seed.
- **No clock, no I/O beyond stdout, no network.**
- Fixed integration step, `dt = 0.01 s`, exposed as `--dt` for a convergence check
  only. The acceptance numbers in §7 are quoted at `dt = 0.01`.
- Forward Euler is sufficient and is what §11.1's closed form was checked against.
  At `dt = 0.001` no acceptance number may move by more than 0.5%; make that a
  test.
- Running the script twice produces byte-identical output.
- **Exit code 0 if every assertion in §7 passes, non-zero otherwise**, with each
  failure printed as `FAIL <name>: expected <x>, got <y>`. This is what lets the
  check be wired into `npm run build` later without further design input.

---

## 7. Acceptance — the numbers it must show

Two groups. **Group A** reproduces `docs/design.md` §11.1 at the shipped config; a
failure means the script, the config, or §11.1 is wrong. **Group B** is the
invariant set; a failure means a retune has broken the design and must be reverted
or escalated, whatever §11.1 says.

### Group A — reproduces §11.1 at the shipped config

Tolerance **±2%** on rates and capacities, **±5%** on times and run lengths, unless
stated otherwise.

**Curve landmarks**

| Quantity | Expected |
| --- | --- |
| `rate(0)` | 0.313 /s |
| `rate(45)` | 0.366 /s |
| `rate(120)` | 0.476 /s |
| `rate(180)` | 0.587 /s |
| `rate(240)` | 0.725 /s |
| `floorBindsAt` | 332 s |
| `rate(t)` for all `t ≥ floorBindsAt` | exactly `1 / SPAWN_INTERVAL_MIN` = 1.000 /s |
| `speedCapsAt` | 198 s |
| `scoreCrossoverAt` | 70 s |
| `duty` | 45.8% |
| shortest power-sustainable banish cycle | 1.13 s |

**Per tier**

| Tier | `capacity` | `crossing` | `runLength` | `banished` | `score` | `peakConcurrency` |
| --- | --- | --- | --- | --- | --- | --- |
| `first-timer` | 0.323 /s | 9 s | **79 s** | ~24 | ~1 390 | 5.5 |
| `practised` | 0.595 /s | 184 s | **250 s** | ~117 | ~5 425 | 8.0 |
| `expert` | 0.804 /s | 270 s | **332 s** | ~187 | ~8 000 | 9.0 |

`banished` and `score` carry a wider **±10%** tolerance: they depend on
`meanAliveSeconds`, which is the softest parameter in §4.

**Pressure inside the first minute**

| Quantity | Expected |
| --- | --- |
| `cumulativeSpawns(45)` | 15 |
| first `t` where `first-timer` concurrency ≥ 3 | 47 s |
| `first-timer` backlog at `t = 45` | < 1.0 |

### Group B — invariants that must hold at *any* config

These take no tolerance. They are assertions about the values in `src/config`, not
about §11.1, and they are the reason the script exists.

| # | Assertion | Source |
| --- | --- | --- |
| B1 | `CRAWLER_SPEED_MAX × (1 + CRAWLER_SPEED_JITTER) ≤ 156` | §10.5 joint speed bound |
| B2 | Shortest approach at the capped, jittered speed ≥ 1.5 s. Compute it — `(RENDER_HEIGHT / 2 − LAMP_RADIUS − 2 × CRAWLER_RADIUS) / (CRAWLER_SPEED_MAX × (1 + CRAWLER_SPEED_JITTER))` — rather than hard-coding 234 px, so a change to `LAMP_RADIUS`, `CRAWLER_RADIUS` or `RENDER_HEIGHT` is caught | §11.2, `docs/vision.md` §6 criterion 4 |
| B3 | `SPAWN_INTERVAL_MIN < (BEAM_TRANSITION_TIME + BURN_DWELL_TIME) × (POWER_DRAIN_RATE + POWER_RECHARGE_RATE) / POWER_RECHARGE_RATE` | §10.7 asymptote invariant |
| B4 | `d(rate)/dt ≤ 0.0035 /s²` at every sampled `t`, and **exactly 0** for every `t ≥ floorBindsAt` | §11.1 no-cliff bound |
| B5 | `floorBindsAt ≤ 360 s` — the ramp must terminate inside a reachable run | §5.4, §11.1 |
| B6 | `concurrency(t) < MAX_CRAWLERS` for every tier at every `t ≤ 400 s` | §5.3, §11.4 — the cap must stay a performance rail |
| B7 | `SPAWN_EDGE_WEIGHTS` sums to 1 | §6.2 |
| B8 | `BEAM_FOCUS_RANGE > 551` and `BEAM_WIDE_RANGE < 480` | §3.2 facts 1 and 2 |
| B9 | `first-timer` run length ∈ [45, 120] s and `practised` run length > 180 s | `docs/vision.md` §6 criterion 2 |

B9 is the one group-B assertion with model error in it. Keep it anyway: it is the
shipping criterion, and a retune that puts the *model's* prediction outside the
window is a retune that needs a conversation, not a silent pass.

---

## 8. Pillar check

Recorded here because the next task changes `src/config`, and a tuning change can
break a pillar as easily as a code change can.

- **Pillar 1 — light is the only verb.** The script adds no mechanic and the
  rebalance adds no constant that is not already in §10. No new input, no new
  effect on a crawler the beam is not touching.
- **Pillar 2 — readable at a glance.** Readability is criterion B2 above, and no
  crawler speed value changed in GAM-17, so §11.2 holds verbatim: the worst case
  is 2.4 s against a 1.5 s floor. Edge entry and the corner inset are untouched.
  Nothing in the rebalance adds state the HUD does not already show — the spawn
  interval and the countdown to the next spawn are both already printed
  (`HUD_SURGE_Y`, `HUD_NEXT_SPAWN_Y`).
- **Pillar 3 — one more sweep.** This is the pillar the rebalance is for. Run
  length is Group A and B9; restart is untouched.
- **Core-loop rule** (`docs/vision.md` §3, the non-veto check): a wide beam still
  freezes without killing and without drain. `BURN_DWELL_TIME` accrues only in
  `FOCUSED` (§5.2 rule 2) and power recharges in `WIDE` (§4.1); GAM-17 changed the
  *size* of the dwell and of the recharge, not which state either belongs to.
  Criterion 17 in `docs/design.md` §12.1 re-runs the check by hand at the new
  values.

---

## 9. Notes for the implementer

1. **The config edit and the script are the same task.** Apply the five changed
   values from `docs/design.md` §10 — `SPAWN_INTERVAL_START` 3.2,
   `SPAWN_INTERVAL_DECAY_PER_SECOND` 0.9965, `SPAWN_INTERVAL_MIN` 1.00,
   `POWER_RECHARGE_RATE` 22, `BURN_DWELL_TIME` 0.40 — and update the prose
   comments in `src/config/index.ts` that describe them. The comment on
   `SPAWN_INTERVAL_MIN` currently reads "a safety stop, not a balance value" and is
   now wrong; §5.4 and §10.7 say what it is instead.
2. **An existing test hard-codes the old curve and will fail.**
   `src/enemies/CrawlerField.test.ts`, the case named *"reproduces the §11.1
   crossings the run-length target is derived from"*, asserts
   `1 / spawnInterval(55) ≈ 0.31` and `1 / spawnInterval(218) ≈ 0.60`. The new
   crossings are **9 s at 0.323/s** and **184 s at 0.595/s**. Update the
   assertions and the comment above them. Do not delete the test — it is the
   cheapest guard the repository has against an accidental curve change, and
   `AGENTS.md` forbids deleting a failing test to make a build pass.
3. **No gameplay formula changes.** `spawnInterval()` and `rampedSpeed()` keep
   their shapes (`docs/design.md` §5.4). If implementing this spec seems to
   require changing either, stop and ask — it means the spec is wrong.
4. **Report the numbers back.** Put the script's full summary output in the PR. If
   any Group A number is outside tolerance, say so on the task rather than
   adjusting the expectation; the discrepancy is a design question and it is mine.

---

## 10. The weekly modifier sweep (Online Vigil)

`docs/design.md` §14.9 extends this script with `npm run sim -- --modifiers`,
which iterates every cell of the weekly modifier table in §14.5 and asserts
**Group B per cell**, plus three additional assertions (W1–W3) and a tightened
B9 band. Plain `npm run sim` keeps the behaviour specified above, unchanged.

Two notes that belong here rather than there:

- **Group A is not run per cell.** It reproduces §11.1 at the shipped config and
  is expected to fail under a modifier by design.
- It needs a **config-override surface** through `spawnInterval`, `rampedSpeed`
  and the model, which §2's "every balance value is imported from
  `src/config/index.ts`" currently rules out at module level. The rule it is
  protecting still holds: the sweep overrides the shipped values through one
  explicit parameter, it never re-declares them, and at the base config the output
  must be byte-identical to today's.

Read `docs/design.md` §14.9 before implementing it; this is a pointer, not the
specification.
