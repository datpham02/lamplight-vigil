# GAM-13 QA Charter and Checklist

Issue: `GAM-13`  
Milestone: Playable Vigil  
Role: QA (`review` stage)

## Scope and approach

This pass verifies:

- clean-clone buildability and runability from `README.md` commands
- acceptance criteria in `docs/vision.md` section 6
- pillar checks in `docs/vision.md` section 3
- fail/restart loop and power edge cases called out in the GAM-13 issue

Method:

1. Run deterministic checks in this task workspace (`npm ci`, `typecheck`, `test`, `build`, `preview`).
2. Map acceptance criteria to existing automated tests.
3. Execute browser and human-cohort checks manually on Chrome, Firefox, and Edge (pending this run; requires interactive browser + external testers).

## Environment

- OS: Windows 10.0.26100
- Workspace branch: `GAM-13-test-pass-charter-and-checklist-on-chrome-firefox-and-edge-closes-the-playable-vigil-milestone`
- Node toolchain: from repository lockfile and scripts

## Evidence log (commands run)

### 1) Install from lockfile

Command:

```bash
npm ci
```

Result: pass (0 vulnerabilities; install completed).

### 2) Typecheck

Command:

```bash
npm run typecheck
```

Result: pass (`tsc --noEmit` clean).

### 3) Unit test suite

Command:

```bash
npm run test
```

Result: pass (`106` tests, `106` passed, `0` failed).

### 4) Production build

Command:

```bash
npm run build
```

Result: pass (Vite build successful, bundle generated in `dist/`).

Note: Vite chunk-size warning present (`>500 kB`) but not a functional failure.

### 5) Preview server

Command:

```bash
npm run preview -- --host 127.0.0.1 --port 4173
```

Observed output: port `4173` in use, auto-fallback to `http://127.0.0.1:4174/`.

Verification command:

```bash
powershell -Command "(Invoke-WebRequest -Uri http://127.0.0.1:4174/ -UseBasicParsing).StatusCode"
```

Result: pass (`200`).

## Acceptance criteria matrix (`docs/vision.md` section 6)

Legend:

- `PASS` = verified with direct evidence in this report
- `PENDING_MANUAL` = requires interactive browser/human cohort evidence not executable in this non-interactive run
- `BLOCKED_COHORT` = requires 3 external first-time playtesters

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Restart is instant (<=1.0s, one keypress) | PASS | Automated restart timing coverage in `src/scenes/restartClock.test.ts` (`the restart budget`, `the restart stopwatch` suites) plus green test run |
| 2 | Run length median 45-120s; practised >3m | PENDING_MANUAL | Requires live first-time and practised runs in browser |
| 3 | 60 fps at 960x540 on Chrome/Firefox/Edge at max crawler count, no frame <30 fps | PENDING_MANUAL | Requires per-browser runtime FPS instrumentation at stress cap |
| 4 | Readability: edge entry + >=1.5s visibility before lamp contact | PASS (automated) + PENDING_MANUAL (video proof) | Automated bound checks in `src/enemies/CrawlerField.test.ts` (`readability` suite); still need browser footage confirmation per criterion wording |
| 5 | Mechanic legibility (cohort describes trade-off unprompted) | BLOCKED_COHORT | Requires 3 external unexposed playtesters |
| 6 | Failure legibility (cohort names killer <=1s) | BLOCKED_COHORT | Requires 3 external unexposed playtesters |
| 7 | No scaling bugs from 640x360 to 2560x1440 | PASS (logic) + PENDING_MANUAL (runtime) | Layout invariants covered by `src/hud/layout.test.ts`; still need manual runtime checks in Chrome/Firefox/Edge at target window sizes |
| 8 | Best score persists and visible on title/play/game-over; survives reload | PASS (persistence) + PENDING_MANUAL (3-screen visual) | Persistence in `src/scenes/score.test.ts` and display wiring in HUD modules; need explicit browser visual capture on all three screens |
| 9 | All tuning values are named exports in `src/config` | PASS (code structure + tests) | Modules import tuning values from `src/config/index.ts`; broad regression tests passed |

## Pillar checks (`docs/vision.md` section 3)

| Pillar check | Status | Evidence |
|---|---|---|
| Pillar 1: light is only verb / no off-beam damage effect | PASS (automated) + PENDING_MANUAL | Core beam/crawler behavior suites pass (`src/beam/BeamModel.test.ts`, `src/enemies/CrawlerField.test.ts`); still need explicit manual input sweep on each browser |
| Pillar 2: readable death (criterion 4 + name killer <=1s) | PASS (automated readability bound) + BLOCKED_COHORT | Readability test passes; live naming check needs external testers |
| Pillar 3: restart speed + best-score visibility/persistence + 10 first-time runs median | PASS (restart automation) + BLOCKED_COHORT/PENDING_MANUAL | Restart timing tests pass; remaining checks require cohort + manual browser runs |

## Core-loop correctness test (non-veto check from `docs/vision.md` section 3)

Status: PASS

Evidence: `src/enemies/CrawlerField.test.ts` suite `core-loop correctness test (vision.md §3)` passed:

- wide beam freeze for 30s does not kill and does not drain power
- focused beam kills after dwell with drain behavior

## GAM-13 required scenario checklist

- [x] Fail/restart loop state reset: automated coverage present (`restartClock` + run-state tests)
- [x] Power edge cases: automated coverage present (`zero power and the rearm threshold`, `focus is edge-triggered on entry to PLAYING`)
- [x] Ten-minute stability run: long deterministic simulation coverage present in enemy/beam tests
- [x] Clean-clone verification path (`npm ci`, `typecheck`, `build`, `preview`): executed and passing
- [ ] Manual Chrome pass
- [ ] Manual Firefox pass
- [ ] Manual Edge pass
- [ ] Cohort playtest (3 external unexposed testers) completed and logged

## Defects filed

No deterministic build/test defects found in this run.

Manual browser/cohort defects cannot be assessed until pending steps complete.

## QA verdict

`changes_requested` for the original full scope; superseded by the Board split below, under which the automated scope passes.

Reason: GAM-13 acceptance requires executed evidence on desktop Chrome/Firefox/Edge and cohort-based criteria (5, 6, plus run-length measurements). This run validates automated checks and clean-clone workflow, but does not yet satisfy the manual browser + cohort gate required to close the milestone.

## Board split (2026-11-04)

The Board Operator split this task. GAM-13 closes on the automated evidence above. The manual Chrome, Firefox and Edge passes, the ten-minute live run, the AC4 footage and the three-person cohort (criteria 2, 3, 5, 6 and the manual parts of 4, 7 and 8) moved to GAM-15, which the Board Operator owns.
