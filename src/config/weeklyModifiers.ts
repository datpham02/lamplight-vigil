// The closed weekly modifier table — `docs/design.md` §14.5, transcribed.
//
// GAM-16 condition C1.1: *a weekly modifier is a tuning value, never a mechanic.*
// Every entry below is a multiplier or an override on one existing named constant
// in `src/config`, and the complete set of values a week can ever resolve to is
// written out. There is nothing between the listed values, because §14.1 rule 3
// makes the finite set the load-bearing decision: a finite table is a table CI can
// enumerate, so every week the game will ever generate is checked before any of
// them happens. `tools/throughput-sim.ts --modifiers` is that check.
//
// §14.1 rule 4 puts the table here rather than in a gameplay module: it is data,
// `game-designer` owns it under the §10 rules, and the simulation already imports
// from `src/config`. The three functions at the foot of this file are the table's
// own accessors — how a cell is named and how it is applied to a config. They hold
// no entry-specific logic and no switch on an `id`; adding one would make this a
// module of gameplay code, which is what §14.1 rule 4 forbids.
//
// Editing this table changes history (§14.4): adding, removing or renaming an
// entry changes `N` and every permutation after it. Edits land at a block
// boundary, and each entry is approved individually by `game-director`.

import { SPAWN_EDGES, type SpawnEdge } from './index';
import type { TuningConfig } from './tuning';

/** The six numeric constants §14.5 may scale. One entry touches exactly one. */
export type WeeklyNumericConstant =
  | 'BEAM_WIDE_ANGLE_DEG'
  | 'BURN_DWELL_TIME'
  | 'CRAWLER_SPEED_BASE'
  | 'POWER_DRAIN_RATE'
  | 'POWER_RECHARGE_RATE'
  | 'SPAWN_INTERVAL_START';

/** The seven constants of §14.5. Nothing outside this union may be modified. */
export type WeeklyConstant = WeeklyNumericConstant | 'SPAWN_EDGE_WEIGHTS';

/** A §10 "Safe range" band, inclusive at both ends. */
export interface SafeRange {
  readonly min: number;
  readonly max: number;
}

/**
 * The §10 safe range of each numeric constant in the table, transcribed from
 * §10.3–§10.7. Sweep assertion W1 holds every resolved value to its own band: a
 * week can never put the game somewhere a designer could not have tuned it to by
 * hand.
 *
 * `SPAWN_EDGE_WEIGHTS` has no band — §10.7 gives it "any set summing to 1", which
 * is assertion B7 — so it is absent here by design rather than by omission.
 */
export const WEEKLY_SAFE_RANGES: Readonly<Record<WeeklyNumericConstant, SafeRange>> = {
  BEAM_WIDE_ANGLE_DEG: { min: 50, max: 95 },
  BURN_DWELL_TIME: { min: 0.25, max: 0.8 },
  CRAWLER_SPEED_BASE: { min: 35, max: 75 },
  POWER_DRAIN_RATE: { min: 16, max: 40 },
  POWER_RECHARGE_RATE: { min: 10, max: 28 },
  SPAWN_INTERVAL_START: { min: 2.5, max: 6 },
};

const SAFE_RANGE_BY_CONSTANT = new Map<string, SafeRange>(Object.entries(WEEKLY_SAFE_RANGES));

/**
 * The §10 safe range of a constant by name, or `undefined` if it has none in this
 * table. Keyed by string rather than by `WeeklyNumericConstant` on purpose: the
 * union fences the table at compile time, and a table hand-edited past it — or
 * widened by a later task — has to fail an assertion rather than throw.
 */
export function weeklySafeRange(constant: string): SafeRange | undefined {
  return SAFE_RANGE_BY_CONSTANT.get(constant);
}

/** One of the two §14.5 edge-weight overrides. Both sum to 1 (B7). */
export interface WeeklyEdgeWeights {
  readonly id: string;
  readonly weights: Readonly<Record<SpawnEdge, number>>;
}

/** An entry that scales one numeric constant. */
export interface WeeklyMultiplierEntry {
  readonly id: string;
  readonly kind: 'multiplier';
  readonly constant: WeeklyNumericConstant;
  /** The complete set of multipliers this entry can resolve to. */
  readonly values: readonly number[];
}

/** The one entry that replaces a whole record rather than scaling a number. */
export interface WeeklyOverrideEntry {
  readonly id: string;
  readonly kind: 'override';
  readonly constant: 'SPAWN_EDGE_WEIGHTS';
  readonly values: readonly WeeklyEdgeWeights[];
}

export type WeeklyModifier = WeeklyMultiplierEntry | WeeklyOverrideEntry;

/**
 * §14.5 — eight entries, fifteen cells.
 *
 * `plain` is a x1.00 multiplier rather than a special case, so that the schedule,
 * the submission payload and this sweep have no "no modifier" branch to get wrong.
 * A plain week is a cell like any other, and assertion W3 checks that it
 * reproduces §11.1 exactly.
 *
 * No on-screen copy lives here. `AGENTS.md` puts user-facing strings in
 * `src/hud/strings.ts`, and §14.5's "On screen" column is the brief for them.
 */
export const WEEKLY_MODIFIERS: readonly WeeklyModifier[] = [
  { id: 'plain', kind: 'multiplier', constant: 'SPAWN_INTERVAL_START', values: [1.0] },
  { id: 'restless-hollow', kind: 'multiplier', constant: 'CRAWLER_SPEED_BASE', values: [0.9, 1.1] },
  { id: 'clinging-dark', kind: 'multiplier', constant: 'BURN_DWELL_TIME', values: [1.15, 1.3] },
  { id: 'thin-wick', kind: 'multiplier', constant: 'POWER_RECHARGE_RATE', values: [0.9, 0.85] },
  { id: 'hungry-flame', kind: 'multiplier', constant: 'POWER_DRAIN_RATE', values: [1.1, 1.2] },
  {
    id: 'crowded-threshold',
    kind: 'multiplier',
    constant: 'SPAWN_INTERVAL_START',
    values: [0.94, 1.06],
  },
  { id: 'narrow-lantern', kind: 'multiplier', constant: 'BEAM_WIDE_ANGLE_DEG', values: [0.85, 1.15] },
  {
    id: 'one-axis',
    kind: 'override',
    constant: 'SPAWN_EDGE_WEIGHTS',
    values: [
      { id: 'long-dark', weights: { top: 0.05, bottom: 0.05, left: 0.45, right: 0.45 } },
      { id: 'over-the-top', weights: { top: 0.4, bottom: 0.4, left: 0.1, right: 0.1 } },
    ],
  },
];

/**
 * A value is addressed by its index, which is how §14.4 resolves one:
 * `entry.values[fnv1a32(...) % entry.values.length]`.
 */
function valueAt(entry: WeeklyModifier, valueIndex: number): number | WeeklyEdgeWeights {
  const value = entry.values[valueIndex];
  if (value === undefined) {
    throw new Error(`${entry.id} has no value at index ${valueIndex}`);
  }
  return value;
}

/** How a cell is named, in the sweep and anywhere else one has to be reported. */
export function weeklyCellLabel(entry: WeeklyModifier, valueIndex: number): string {
  const value = valueAt(entry, valueIndex);
  return typeof value === 'number' ? `${entry.id} x${value.toFixed(2)}` : `${entry.id} ${value.id}`;
}

/**
 * The resolved value, as §14.5's "Resolved" column states it. Weights are listed
 * in the `SPAWN_EDGES` order: top/bottom/left/right.
 *
 * A multiplied value is reported to ten significant figures, which is a display
 * decision alone: `0.4 * 1.15` is `0.45999999999999996` as a double, and §14.5
 * calls it 0.46. Every assertion is made against the double, never against this.
 */
export function weeklyResolvedLabel(
  base: TuningConfig,
  entry: WeeklyModifier,
  valueIndex: number,
): string {
  const applied = applyWeeklyModifier(base, entry, valueIndex);
  if (entry.kind === 'override') {
    return SPAWN_EDGES.map((edge) => applied.SPAWN_EDGE_WEIGHTS[edge]).join('/');
  }

  // Branching on `kind` rather than on the value's type, so that an entry naming
  // something that is not a numeric constant is still reportable rather than fatal.
  const value: unknown = applied[entry.constant];
  return typeof value === 'number' ? String(Number(value.toPrecision(10))) : String(value);
}

/**
 * The cell's config: the base with this entry's constant, and no other, resolved.
 *
 * A multiplier is applied as a single multiply of the shipped value, which §14.5
 * requires: one IEEE-754 double multiply of a literal by a literal is bit-identical
 * on every platform, so two players on the same week are playing the same numbers.
 */
export function applyWeeklyModifier(
  base: TuningConfig,
  entry: WeeklyModifier,
  valueIndex: number,
): TuningConfig {
  const value = valueAt(entry, valueIndex);

  if (entry.kind === 'override') {
    if (typeof value === 'number') {
      throw new Error(`${entry.id} is an override entry but value ${valueIndex} is a number`);
    }
    return { ...base, SPAWN_EDGE_WEIGHTS: value.weights };
  }

  if (typeof value !== 'number') {
    throw new Error(`${entry.id} is a multiplier entry but value ${valueIndex} is not a number`);
  }
  return { ...base, [entry.constant]: base[entry.constant] * value };
}

/** Every cell of the table, in declaration order. Fifteen at the §14.5 table. */
export function weeklyCells(
  table: readonly WeeklyModifier[] = WEEKLY_MODIFIERS,
): readonly { readonly entry: WeeklyModifier; readonly valueIndex: number }[] {
  return table.flatMap((entry) => entry.values.map((_, valueIndex) => ({ entry, valueIndex })));
}
