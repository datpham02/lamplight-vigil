// `docs/design.md` §14.2 — the week key.
//
// Pure arithmetic on a millisecond instant. It never reads `Date.now()` itself,
// never consults the host's time zone, and never awaits anything: §14.8 requires
// that a weekly run never waits on the clock, and pillar 3 gives the whole
// restart path 1.0 s.

import { WEEK_RESET_UTC_OFFSET_HOURS, WEEKLY_EPOCH_UTC_MS } from '../config/index';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const WEEK_MS = 7 * MS_PER_DAY;

/**
 * The one offset the week boundary is anchored to, in milliseconds. Derived
 * from the single named constant in `src/config` so that the boundary is one
 * number in one place (criterion 36); see that constant for the decision.
 */
const WEEK_RESET_OFFSET_MS = WEEK_RESET_UTC_OFFSET_HOURS * MS_PER_HOUR;

/**
 * Midnight on the Monday of the week containing `shiftedMs`, in the **reset
 * frame** the offset defines — §14.2's name for the frame the whole computation
 * below happens inside.
 *
 * Takes an already-shifted instant and returns a shifted one. Both callers shift
 * on the way in, and `weekIndex` subtracts an epoch that is itself stated in the
 * reset frame, so no expression here ever mixes the two frames. That is the
 * whole trick: convert at the edges, never in the middle.
 */
function mondayOfWeek(shiftedMs: number): number {
  const d = new Date(shiftedMs);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dayIndex = (new Date(midnight).getUTCDay() + 6) % 7; // Monday = 0
  return midnight - dayIndex * MS_PER_DAY;
}

/**
 * §14.2 — the ISO-8601 week date of `nowMs` read at the reset offset, formatted
 * `YYYY-Www`. The week begins Monday 00:00:00 at UTC+7, which is Sunday
 * 17:00:00 UTC (D6).
 *
 * ISO week 1 is the week containing the first Thursday of January, so a year has
 * 52 or 53 weeks and the first days of January can belong to the previous ISO
 * year. 2026 is a 53-week year; `2026-W53` runs to the Sunday of 2027-W00 in the
 * reset frame.
 *
 * **A fixed offset, never the device's zone.** The host's time zone is not read
 * here or anywhere else. A leaderboard is one global list: deriving the key from
 * the device would put two players in different zones on different weeks, with
 * different modifiers, submitting to the same board — a fairness bug visible
 * only at the edges of a week and close to impossible to reproduce. A fixed
 * offset is the opposite of that — one boundary for the entire world, crossed by
 * everyone at the same instant, with no daylight-saving rule.
 *
 * **The cost, which §14.2 asks callers to remember.** For the seven hours
 * between Sunday 17:00 UTC and Monday 00:00 UTC, the date part of a UTC
 * timestamp and the week key disagree. Anything that logs, displays, buckets or
 * files a week takes it from here; deriving one from a UTC date is wrong for 4%
 * of the week.
 */
export function weekKey(nowMs: number): string {
  const monday = mondayOfWeek(nowMs + WEEK_RESET_OFFSET_MS);
  const thursday = monday + 3 * MS_PER_DAY;
  const isoYear = new Date(thursday).getUTCFullYear();
  const jan4 = Date.UTC(isoYear, 0, 4);
  const firstThursday = mondayOfWeek(jan4) + 3 * MS_PER_DAY;
  const week = 1 + Math.round((thursday - firstThursday) / WEEK_MS);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/**
 * §14.2 — whole weeks from `WEEKLY_EPOCH_UTC_MS`, floored at 0.
 *
 * The floor is belt and braces: the epoch is in the past, so a shipped build
 * reaches a negative index only if the device clock is wrong by years. A
 * negative index would otherwise hand `%` a negative slot and resolve a week to
 * nothing at all.
 *
 * Both sides of the subtraction are reset-frame Mondays — `WEEKLY_EPOCH_UTC_MS`
 * is one by §14.2's definition, not a UTC one — so the difference is an exact
 * whole number of weeks. Converting the epoch back to a real UTC instant here
 * would make every difference seven hours short and `Math.floor` would report
 * every index one week low, forever.
 */
export function weekIndex(nowMs: number): number {
  const monday = mondayOfWeek(nowMs + WEEK_RESET_OFFSET_MS);
  return Math.max(0, Math.floor((monday - WEEKLY_EPOCH_UTC_MS) / WEEK_MS));
}

/**
 * Milliseconds left in the week containing `nowMs`.
 *
 * Pillar 2: §14.2 requires the title screen to state the week key *and* the time
 * remaining in it before a run starts, so this is the arithmetic that answer
 * comes from rather than a second subtraction written in the HUD.
 */
export function msRemainingInWeek(nowMs: number): number {
  const shifted = nowMs + WEEK_RESET_OFFSET_MS;
  return mondayOfWeek(shifted) + WEEK_MS - shifted;
}
