// A lint-style check over `src/`: gameplay code may not import a constant the
// §14.5 table can override. GAM-46, `docs/design.md` §14.5 and §14.9.
//
// Why this exists rather than one more assertion about behaviour. Twice now the
// same defect has shipped in two different modules: `src/beam` derived
// `BEAM_WIDE_HALF_ANGLE_RAD` from `BEAM_WIDE_ANGLE_DEG` at module load (GAM-44),
// and `src/enemies` read `BURN_DWELL_TIME` from `src/config` at module load
// (GAM-46). Both made a weekly modifier a label on a screen: `npm run sim`
// certified the week at the modified number and the game played the shipped one.
// Both were invisible to every behavioural test in the repository, because a
// test that never resolves a cell cannot see the difference.
//
// A behavioural test proves one module reads its config today. This proves no
// module can quietly stop, in any module, including one nobody has written yet —
// which is the part the two bugs got past.
//
// **The rule.** A file under `src/`, outside `src/config` and outside a test,
// may not import any of the seven §14.5 constants by name from `src/config`. It
// takes the numbers from the run's `TuningConfig` instead: the record §14.2
// resolves once at the transition to PLAYING and hands to `Beam.reset` and
// `CrawlerField.reset`.
//
// **What is deliberately exempt.**
//
// - `src/config` itself, which is where the constants live. Its one derivation
//   from a table constant is a *function* of a run's config
//   (`beamWideHalfAngleRad`), which §14.5 requires and this check cannot judge.
// - `*.test.ts`, which must be able to say "under `plain` the burn takes the
//   shipped 0.40 s" — that assertion is the shipped constant, by name.
// - `tools/`, which is not gameplay and is not bundled: `throughput-sim.ts` is
//   the model, and it evaluates a cell by passing a config to the same curves.
//
// This file lives in `tools/` because it is developer tooling rather than a rule
// of the game, and `AGENTS.md` keeps tooling out of `src/`. `npm test` runs it.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { WEEKLY_MODIFIERS } from '../src/config/weeklyModifiers';

const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url));
const CONFIG_DIR = path.join(SRC_DIR, 'config');

/**
 * The constants no gameplay module may import, read off the table itself.
 *
 * Derived rather than listed, so that adding an entry to §14.5 extends this
 * check on the same commit. A new entry naming a constant some module still
 * imports fails here, which is the review the two bugs above slipped past.
 */
const OVERRIDABLE: ReadonlySet<string> = new Set(WEEKLY_MODIFIERS.map((entry) => entry.constant));

/** One banned import, named well enough to fix without opening the file. */
interface Violation {
  readonly file: string;
  readonly binding: string;
  readonly specifier: string;
}

/**
 * Every `import ... from '...'` in a source file.
 *
 * A regular expression rather than a parse: the check is a lint over import
 * syntax, the repository has no TypeScript-compiler dependency to borrow, and
 * the two shapes that could hide a read from it — a namespace import and a
 * dynamic `import()` — are themselves rejected below rather than parsed.
 */
const IMPORT = /\bimport\s+([^;']*?)\s*from\s*'([^']+)'/g;

/** Resolves an import specifier to a path, or null if it is a package. */
function resolveSpecifier(file: string, specifier: string): string | null {
  return specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier) : null;
}

/** The names an import clause binds, ignoring `type` markers and aliases. */
function boundNames(clause: string): readonly string[] {
  const braces = /\{([^}]*)\}/.exec(clause);
  if (braces === null) {
    return [];
  }

  return (braces[1] ?? '')
    .split(',')
    .map((item) => item.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim() ?? '')
    .filter((name) => name.length > 0);
}

/** Every §14.5 constant this source text imports from `src/config`. */
function violationsIn(file: string, source: string): readonly Violation[] {
  const found: Violation[] = [];

  for (const match of source.matchAll(IMPORT)) {
    const clause = match[1] ?? '';
    const specifier = match[2] ?? '';
    const resolved = resolveSpecifier(file, specifier);

    if (resolved === null || !resolved.startsWith(CONFIG_DIR)) {
      continue;
    }

    // `import * as config from '../config/index'` would put every constant in
    // reach under a name this check cannot follow, so the shape is banned
    // outright rather than analysed. No file in `src/` uses one.
    if (clause.trimStart().startsWith('*')) {
      found.push({ file, binding: '* as …', specifier });
      continue;
    }

    for (const binding of boundNames(clause)) {
      if (OVERRIDABLE.has(binding)) {
        found.push({ file, binding, specifier });
      }
    }
  }

  return found;
}

/** Every `.ts` file under `dir`, recursively. */
function tsFilesIn(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return tsFilesIn(full);
    }
    return entry.isFile() && full.endsWith('.ts') ? [full] : [];
  });
}

/** The files this check covers: `src/`, less `src/config` and less the tests. */
function gameplayFiles(): readonly string[] {
  return tsFilesIn(SRC_DIR).filter(
    (file) => !file.startsWith(CONFIG_DIR) && !file.endsWith('.test.ts'),
  );
}

function relative(file: string): string {
  return path.relative(SRC_DIR, file).split(path.sep).join('/');
}

describe('gameplay code reads a weekly constant from the run, not from src/config (§14.5)', () => {
  const files = gameplayFiles();

  it('has a table of overridable constants to check against', () => {
    // Guards the check against passing because it found nothing to forbid.
    assert.ok(OVERRIDABLE.size >= 7, `only ${OVERRIDABLE.size} constants are fenced`);
    assert.ok(OVERRIDABLE.has('BURN_DWELL_TIME'), 'the GAM-46 constant');
    assert.ok(OVERRIDABLE.has('BEAM_WIDE_ANGLE_DEG'), 'the GAM-44 constant');
  });

  it('has gameplay files to check, in every module that plays the game', () => {
    // And against passing because the walk found nothing to check.
    assert.ok(files.length > 20, `only ${files.length} files were scanned`);

    for (const dir of ['beam', 'enemies', 'hud', 'scenes', 'weekly']) {
      assert.ok(
        files.some((file) => relative(file).startsWith(`${dir}/`)),
        `src/${dir} was not scanned`,
      );
    }
  });

  it('imports none of them, anywhere under src/', () => {
    const violations = files.flatMap((file) => violationsIn(file, readFileSync(file, 'utf8')));

    assert.deepEqual(
      violations.map((v) => `${relative(v.file)} imports ${v.binding} from '${v.specifier}'`),
      [],
      'a §14.5 constant imported here is a modifier the game will not play — take it ' +
        "from the run's TuningConfig instead (src/config/tuning.ts)",
    );
  });

  // The check's own failure path. Without these, a regression in the matcher
  // would make the suite above pass silently on a repository that violates it —
  // which is exactly the failure mode the whole file exists against.

  it('catches the GAM-46 bug it was written for', () => {
    const bug = "import { BURN_DECAY_MULTIPLIER, BURN_DWELL_TIME } from '../config/index';";
    const found = violationsIn(path.join(SRC_DIR, 'enemies', 'Crawler.ts'), bug);

    assert.deepEqual(
      found.map((v) => v.binding),
      ['BURN_DWELL_TIME'],
      'and not its innocent neighbour, which §14.5 does not name',
    );
  });

  it('catches one behind a `type` marker, an alias, or a namespace import', () => {
    const here = path.join(SRC_DIR, 'scenes', 'VigilScene.ts');

    assert.equal(
      violationsIn(here, "import { type SPAWN_EDGE_WEIGHTS } from '../config/index';").length,
      1,
      'a type-only import still names the constant',
    );
    assert.equal(
      violationsIn(here, "import { POWER_DRAIN_RATE as drain } from '../config/index';").length,
      1,
      'an alias is the same read under another name',
    );
    assert.equal(
      violationsIn(here, "import * as config from '../config/index';").length,
      1,
      'a namespace import puts all seven in reach',
    );
  });

  it('leaves alone what §14.5 does not fence off', () => {
    const here = path.join(SRC_DIR, 'beam', 'BeamModel.ts');

    assert.deepEqual(violationsIn(here, "import Phaser from 'phaser';"), []);
    assert.deepEqual(
      violationsIn(here, "import { POWER_MAX, POWER_FOCUS_REARM } from '../config/index';"),
      [],
      '§14.7 keeps these out of the table, so the beam may read them directly',
    );
    assert.deepEqual(
      violationsIn(here, "import { BASE_TUNING, type BeamTuning } from '../config/tuning';"),
      [],
      'the override surface itself is how a run is handed its numbers',
    );
    assert.deepEqual(
      violationsIn(here, "import { WEEKLY_MODIFIERS } from '../config/weeklyModifiers';"),
      [],
      'the table is data, and naming an entry is not reading a constant',
    );
  });
});
