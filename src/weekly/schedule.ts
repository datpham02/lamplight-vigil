// `docs/design.md` §14.4 — selection, the eight-week block schedule.
//
// A week's entry is its slot in a shuffled permutation of the whole table, not
// an independent draw. That buys three properties an independent draw does not
// have: every entry appears exactly once every N weeks, no two consecutive weeks
// share an entry, and the answer depends on the clock and nothing else — no
// stored history, no chain to replay, no `localStorage`. A fresh install and a
// two-year-old one resolve the same week identically.

import {
  WEEKLY_MODIFIERS,
  WEEKLY_SEED_NAMESPACE,
  type WeeklyModifier,
  type WeeklyModifierValue,
} from '../config/index';
import { fnv1a32, mulberry32 } from './seed';
import { weekIndex, weekKey } from './weekKey';

/** `N` in §14.4 — the length of the table, and therefore of a block. */
export const BLOCK_LENGTH = WEEKLY_MODIFIERS.length;

/**
 * §14.4 — a Fisher–Yates shuffle of the table, **iterated in `id` order** so it
 * does not depend on how the array in `src/config` happens to be written, driven
 * by `mulberry32(fnv1a32(...|block|b))`.
 */
export function rawBlockOrder(block: number): readonly string[] {
  const order = WEEKLY_MODIFIERS.map((modifier) => modifier.id).sort();
  const next = mulberry32(fnv1a32(`${WEEKLY_SEED_NAMESPACE}|block|${block}`));

  for (let i = order.length - 1; i >= 1; i -= 1) {
    const j = next() % (i + 1);
    const atI = order[i];
    const atJ = order[j];
    // Both indices are in range by construction; the guard is what
    // `noUncheckedIndexedAccess` needs to see rather than a real case.
    if (atI !== undefined && atJ !== undefined) {
      order[i] = atJ;
      order[j] = atI;
    }
  }

  return order;
}

/**
 * §14.4 — `rawBlockOrder`, with the first two entries swapped when the block
 * would otherwise open on the entry the previous one closed with.
 *
 * **A swap, not a rotation**, and the difference is not visible by reading. A
 * left rotation moves `order[0]` to the end, so a rotated block closes on
 * `rawBlockOrder(b)[0]` rather than `rawBlockOrder(b)[N - 1]` — and the next
 * block tests the latter, so whenever the previous block rotated the test reads
 * the wrong element. It then both misses genuine collisions and rotates
 * spuriously into fresh ones. Measured over 99 999 block boundaries, the
 * rotation leaks 1838 repeated weeks; the swap leaks none.
 *
 * A swap of the first two never touches `order[N - 1]`, so the quantity the next
 * block tests is rotation-independent, the recursion to the epoch never has to
 * happen, and this stays O(1) and stateless. The new opener `raw(b)[1]` cannot
 * equal `raw(b)[0]` — a block is a permutation — so the collision is closed
 * rather than moved. Requires `N >= 3`.
 */
export function blockOrder(block: number): readonly string[] {
  const order = [...rawBlockOrder(block)];

  if (block > 0) {
    const previous = rawBlockOrder(block - 1);
    const closing = previous[previous.length - 1];
    const first = order[0];
    const second = order[1];

    if (first !== undefined && second !== undefined && first === closing) {
      order[0] = second;
      order[1] = first;
    }
  }

  return order;
}

/**
 * What a run is played under: the week it belongs to, and the one entry and one
 * value that week resolved to.
 *
 * §14.2 — resolved once, at the transition to PLAYING, and held for the whole
 * run. A clock change, a midnight rollover or a laptop waking from sleep
 * mid-run never retunes a run in progress.
 */
export interface ResolvedWeek {
  /** §14.2 — `2026-W45`. The number a player must always be able to read. */
  readonly key: string;
  /** §14.2 — whole weeks since the epoch. */
  readonly index: number;
  readonly entry: WeeklyModifier;
  readonly value: WeeklyModifierValue;
}

/**
 * §14.4 — resolve a week from its key and index alone.
 *
 * Split from {@link resolveWeekAt} so the schedule can be checked against the
 * published conformance vector without a clock in the test, and so a server
 * written against D4 later has the same entry point this client uses.
 */
export function resolveWeek(key: string, index: number): ResolvedWeek {
  if (BLOCK_LENGTH === 0) {
    throw new Error('WEEKLY_MODIFIERS is empty: there is no week to resolve');
  }

  const block = Math.floor(index / BLOCK_LENGTH);
  const slot = index % BLOCK_LENGTH;
  const id = blockOrder(block)[slot];
  const entry = WEEKLY_MODIFIERS.find((modifier) => modifier.id === id);

  if (entry === undefined) {
    throw new Error(`the block schedule named an entry that is not in the table: ${String(id)}`);
  }

  const value = entry.values[fnv1a32(`${WEEKLY_SEED_NAMESPACE}|${key}|${entry.id}|value`) % entry.values.length];

  if (value === undefined) {
    throw new Error(`weekly modifier "${entry.id}" declares no values`);
  }

  return { key, index, entry, value };
}

/** {@link resolveWeek} for an instant. The only caller that needs a clock. */
export function resolveWeekAt(nowMs: number): ResolvedWeek {
  return resolveWeek(weekKey(nowMs), weekIndex(nowMs));
}
