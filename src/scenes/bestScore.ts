// src/scenes owns the run and its bookkeeping. This is the only save data in the
// game (docs/concept.md §7).
//
// docs/design.md §8: a missing, unparseable or negative stored value is treated
// as 0, and localStorage being unavailable or throwing must not break the run —
// the best score degrades to session-only. Private-mode browsers throw on write,
// so both sides are wrapped.

import { SCORE_STORAGE_KEY } from '../config/index';

/** Reads the stored best score, or 0 if there is not a usable one. */
export function readBestScore(): number {
  try {
    const raw = globalThis.localStorage?.getItem(SCORE_STORAGE_KEY);
    if (raw === null || raw === undefined) {
      return 0;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }

    return Math.floor(parsed);
  } catch {
    return 0;
  }
}

/**
 * Writes the best score the moment it is beaten (§2.3) — not on unload, which a
 * browser may never deliver. Returns false if the write was refused, in which
 * case the caller keeps the value in memory for the session.
 */
export function writeBestScore(score: number): boolean {
  try {
    globalThis.localStorage?.setItem(SCORE_STORAGE_KEY, String(score));
    return true;
  } catch {
    return false;
  }
}
