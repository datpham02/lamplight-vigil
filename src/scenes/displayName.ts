// src/scenes owns the run and its bookkeeping. This is the second thing the game
// saves, after the best score, and it is `docs/design.md` §15.
//
// It is the *rules* half of the display name: what a name may be, what a name
// is when the player has not chosen one, how long a rename has to wait, and how
// the record is read and written. The typing half is `nameEdit.ts` and the
// screen is `src/hud/NameEditorOverlay.ts`.
//
// **No network.** `docs/vision.md` §5b leaves D4 — provider and hosting —
// pending with the Board, so nothing here calls, names or assumes a backend.
// The same charset and length bounds the server will enforce are held here as a
// convenience, so that a name is never typed, sent and then refused; they are
// not the check, and the rename interval is mirrored for the same reason.
//
// Storage degrades exactly the way `bestScore.ts` does (§8): a missing,
// unparseable or unusable record is treated as "no name yet", and a browser
// that refuses the write keeps the name for the session rather than breaking.

import {
  DISPLAY_NAME_DEFAULT_DIGITS,
  DISPLAY_NAME_DEFAULT_PREFIX,
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  DISPLAY_NAME_RENAME_INTERVAL_DAYS,
  DISPLAY_NAME_STORAGE_KEY,
} from '../config/index';

// ---------------------------------------------------------------------------
// Units — not tunables
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The rename interval in the unit a clock reading is in. */
export const DISPLAY_NAME_RENAME_INTERVAL_MS = DISPLAY_NAME_RENAME_INTERVAL_DAYS * MS_PER_DAY;

// ---------------------------------------------------------------------------
// What a name may be — §15.1
// ---------------------------------------------------------------------------

/** Why a name was refused. The HUD owns the sentence each of these becomes. */
export type NameRejection = 'too-short' | 'too-long' | 'bad-character' | 'double-space';

export type NameCheck =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: NameRejection };

/** The characters a name is made of, outside of the single internal spaces. */
const NAME_CHARACTER = /^[A-Za-z0-9]$/u;
const NAME_BODY = /^[A-Za-z0-9 ]+$/u;
const DOUBLE_SPACE = / {2}/u;

/** Whether one typed character is one a name may contain at all. */
export function isNameCharacter(character: string): boolean {
  return NAME_CHARACTER.test(character);
}

/**
 * Leading and trailing spaces are removed rather than refused: a space at
 * either end is almost always a typing artefact, and refusing the keystroke
 * that makes one would be the editor arguing with the player over a character
 * it is about to throw away anyway.
 */
export function normalizeDisplayName(raw: string): string {
  return raw.trim();
}

/** The §15.1 rules, in the order that gives the most specific complaint. */
export function checkDisplayName(raw: string): NameCheck {
  const name = normalizeDisplayName(raw);

  if (name.length < DISPLAY_NAME_MIN_LENGTH) {
    return { ok: false, reason: 'too-short' };
  }

  if (name.length > DISPLAY_NAME_MAX_LENGTH) {
    return { ok: false, reason: 'too-long' };
  }

  if (DOUBLE_SPACE.test(name)) {
    return { ok: false, reason: 'double-space' };
  }

  if (!NAME_BODY.test(name)) {
    return { ok: false, reason: 'bad-character' };
  }

  return { ok: true, name };
}

/**
 * A name for a player who has not chosen one — `Vigil 7421`.
 *
 * Four digits with no leading zero: the figure is part of how one anonymous
 * lamp is told from another on a board, and `Vigil 0007` reads as a rank rather
 * than as a name. Ten characters, so it is inside the bounds it has to pass.
 */
export function generateDisplayName(random: () => number = Math.random): string {
  const span = 9 * 10 ** (DISPLAY_NAME_DEFAULT_DIGITS - 1);
  const floor = 10 ** (DISPLAY_NAME_DEFAULT_DIGITS - 1);
  const draw = Math.floor(Math.min(Math.max(random(), 0), 0.999999) * span) + floor;

  return `${DISPLAY_NAME_DEFAULT_PREFIX} ${draw}`;
}

// ---------------------------------------------------------------------------
// The stored record — §15.7
// ---------------------------------------------------------------------------

export interface DisplayNameRecord {
  readonly name: string;
  /**
   * When the player last chose a name, as a clock reading, or null if the name
   * they are carrying is the generated default.
   *
   * Being given a default does not spend the weekly rename: the player never
   * asked for it, and starting a new player on a cooldown for a name they did
   * not pick is the kind of rule that reads as a bug.
   */
  readonly renamedAt: number | null;
}

/** The slice of `localStorage` this module uses, so a test can hand it one. */
export interface NameStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The browser's store, or null where there is not one. Private-mode browsers
 * throw on access as well as on write, so even reaching for it is wrapped.
 */
export function browserStorage(): NameStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Reads the stored record, or null if there is not a usable one. */
export function readDisplayNameRecord(
  storage: NameStorage | null = browserStorage(),
): DisplayNameRecord | null {
  if (storage === null) {
    return null;
  }

  try {
    const raw = storage.getItem(DISPLAY_NAME_STORAGE_KEY);
    if (raw === null || raw === undefined) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    const record = parsed as { name?: unknown; renamedAt?: unknown };
    if (typeof record.name !== 'string') {
      return null;
    }

    // A stored name that no longer passes the rules is treated as no name at
    // all, so the player is given a valid default rather than carrying a name
    // the board would refuse.
    const checked = checkDisplayName(record.name);
    if (!checked.ok) {
      return null;
    }

    const renamedAt =
      typeof record.renamedAt === 'number' && Number.isFinite(record.renamedAt)
        ? record.renamedAt
        : null;

    return { name: checked.name, renamedAt };
  } catch {
    return null;
  }
}

/**
 * Writes the record the moment the player commits a name. Returns false if the
 * write was refused, in which case the caller keeps the name for the session.
 */
export function writeDisplayNameRecord(
  record: DisplayNameRecord,
  storage: NameStorage | null = browserStorage(),
): boolean {
  if (storage === null) {
    return false;
  }

  try {
    storage.setItem(DISPLAY_NAME_STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/**
 * The record this device plays under: the stored one, or a freshly generated
 * default which is persisted on the spot.
 *
 * Called once, when the scene starts. Never on the restart path — pillar 3
 * (`docs/vision.md` §3, condition C3.2) allows nothing between the lose state
 * and the next playable frame, and that includes a storage read.
 */
export function ensureDisplayName(options: {
  readonly storage?: NameStorage | null;
  readonly random?: () => number;
}): DisplayNameRecord {
  const storage = options.storage === undefined ? browserStorage() : options.storage;

  const stored = readDisplayNameRecord(storage);
  if (stored !== null) {
    return stored;
  }

  const fresh: DisplayNameRecord = { name: generateDisplayName(options.random), renamedAt: null };
  writeDisplayNameRecord(fresh, storage);

  return fresh;
}

// ---------------------------------------------------------------------------
// The weekly rename — §15.3
// ---------------------------------------------------------------------------

/**
 * Milliseconds left before this record may be renamed again, 0 when it may be
 * renamed now.
 *
 * A reading from the future — a clock that moved backwards — is clamped to the
 * full interval rather than trusted, and a device clock wound forward unlocks
 * the rename early. Both are fine: the server owns the real rule, and this is
 * the convenience copy of it.
 */
export function renameLockRemainingMs(record: DisplayNameRecord, now: number): number {
  if (record.renamedAt === null || !Number.isFinite(now)) {
    return 0;
  }

  const elapsed = now - record.renamedAt;
  if (elapsed < 0) {
    return DISPLAY_NAME_RENAME_INTERVAL_MS;
  }

  return Math.max(0, DISPLAY_NAME_RENAME_INTERVAL_MS - elapsed);
}

/**
 * Whole days left before the next rename, rounded up, and 0 when the rename is
 * available. Rounded up because "0 days" on screen beside a locked editor would
 * be the screen contradicting itself.
 */
export function renameLockDays(record: DisplayNameRecord, now: number): number {
  const remaining = renameLockRemainingMs(record, now);
  return remaining <= 0 ? 0 : Math.ceil(remaining / MS_PER_DAY);
}

/** Whether the title screen may offer the rename key at all. */
export function canRename(record: DisplayNameRecord, now: number): boolean {
  return renameLockRemainingMs(record, now) <= 0;
}

/**
 * Applies a committed name, and persists it.
 *
 * Committing the name you already had is not a rename and does not start the
 * cooldown: a player who opens the editor, reads the rule and presses ENTER
 * without changing anything has not used their change, and taking it from them
 * would make opening the editor at all a risk.
 */
export function commitDisplayName(
  record: DisplayNameRecord,
  name: string,
  now: number,
  storage: NameStorage | null = browserStorage(),
): DisplayNameRecord {
  if (name === record.name) {
    return record;
  }

  const next: DisplayNameRecord = { name, renamedAt: now };
  writeDisplayNameRecord(next, storage);

  return next;
}
