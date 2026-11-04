// The display name's rules and its record (`docs/design.md` §15.1, §15.7).
//
// These are the same bounds the server will enforce once D4 lands, held here as
// a convenience so a name is never typed, sent and then refused. That makes
// them worth proving at a node prompt: the client half failing open would show
// a player a name they are about to lose.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  DISPLAY_NAME_STORAGE_KEY,
} from '../config/index';
import {
  DISPLAY_NAME_RENAME_INTERVAL_MS,
  canRename,
  checkDisplayName,
  commitDisplayName,
  ensureDisplayName,
  generateDisplayName,
  isNameCharacter,
  normalizeDisplayName,
  readDisplayNameRecord,
  renameLockDays,
  renameLockRemainingMs,
  writeDisplayNameRecord,
  type DisplayNameRecord,
  type NameStorage,
} from './displayName';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A `localStorage` that works, so the record can be proved without a browser. */
function fakeStorage(seed: Record<string, string> = {}): NameStorage & {
  readonly entries: Map<string, string>;
} {
  const entries = new Map<string, string>(Object.entries(seed));

  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

/** A browser in private mode: present, and throws on everything. */
const refusingStorage: NameStorage = {
  getItem: () => {
    throw new Error('refused');
  },
  setItem: () => {
    throw new Error('refused');
  },
};

describe('what a name may be (§15.1)', () => {
  it('accepts the shapes the rules describe', () => {
    for (const name of ['Vigil 7421', 'abc', '777', 'Lamp Keep 9', 'ZZZ']) {
      assert.equal(checkDisplayName(name).ok, true, `${name} is a legal name`);
    }
  });

  it('refuses a name that is too short or too long, after trimming', () => {
    const short = 'a'.repeat(DISPLAY_NAME_MIN_LENGTH - 1);
    const long = 'a'.repeat(DISPLAY_NAME_MAX_LENGTH + 1);

    assert.deepEqual(checkDisplayName(short), { ok: false, reason: 'too-short' });
    assert.deepEqual(checkDisplayName(long), { ok: false, reason: 'too-long' });
    assert.deepEqual(checkDisplayName('   '), { ok: false, reason: 'too-short' });
    assert.deepEqual(checkDisplayName(''), { ok: false, reason: 'too-short' });
  });

  it('measures the length after trimming, not before', () => {
    const atMax = 'a'.repeat(DISPLAY_NAME_MAX_LENGTH);
    const padded = `  ${atMax}  `;

    const checked = checkDisplayName(padded);
    assert.equal(checked.ok, true, 'the spaces are not part of the name');
    assert.equal(checked.ok === true ? checked.name : '', atMax);
  });

  it('refuses anything outside letters, digits and spaces', () => {
    for (const name of ['Vigil-7421', 'über 9', 'name!', 'tab\there', '🙂 lamp']) {
      assert.deepEqual(
        checkDisplayName(name),
        { ok: false, reason: 'bad-character' },
        `${name} is refused`,
      );
    }
  });

  it('refuses two spaces in a row, and keeps single internal ones', () => {
    assert.deepEqual(checkDisplayName('a  b'), { ok: false, reason: 'double-space' });
    assert.equal(checkDisplayName('a b c').ok, true);
  });

  it('trims, and says so in the accepted name', () => {
    assert.equal(normalizeDisplayName('  Lamp  '), 'Lamp');

    const checked = checkDisplayName(' Lamp ');
    assert.equal(checked.ok === true ? checked.name : null, 'Lamp');
  });

  it('knows which single characters a name may be built from', () => {
    assert.equal(isNameCharacter('a'), true);
    assert.equal(isNameCharacter('Z'), true);
    assert.equal(isNameCharacter('7'), true);
    assert.equal(isNameCharacter(' '), false, 'the space has a position rule of its own');
    assert.equal(isNameCharacter('-'), false);
  });
});

describe('the generated default (§15.1)', () => {
  it('always passes the rules it will be checked against', () => {
    for (const draw of [0, 0.0001, 0.25, 0.5, 0.75, 0.999999, 1]) {
      const name = generateDisplayName(() => draw);
      assert.equal(checkDisplayName(name).ok, true, `${name} passes`);
    }
  });

  it('is a word and four digits, with no leading zero', () => {
    assert.equal(generateDisplayName(() => 0), 'Vigil 1000');
    assert.match(generateDisplayName(() => 0.5), /^Vigil [1-9][0-9]{3}$/u);
    assert.match(generateDisplayName(() => 1), /^Vigil [1-9][0-9]{3}$/u);
  });
});

describe('the stored record (§15.7)', () => {
  it('round-trips a committed name', () => {
    const storage = fakeStorage();
    const record: DisplayNameRecord = { name: 'Lampkeeper', renamedAt: 1234 };

    assert.equal(writeDisplayNameRecord(record, storage), true);
    assert.deepEqual(readDisplayNameRecord(storage), record);
  });

  it('treats a missing, unparseable or malformed record as no name at all', () => {
    assert.equal(readDisplayNameRecord(fakeStorage()), null);
    assert.equal(
      readDisplayNameRecord(fakeStorage({ [DISPLAY_NAME_STORAGE_KEY]: 'not json' })),
      null,
    );
    assert.equal(readDisplayNameRecord(fakeStorage({ [DISPLAY_NAME_STORAGE_KEY]: '7' })), null);
    assert.equal(
      readDisplayNameRecord(fakeStorage({ [DISPLAY_NAME_STORAGE_KEY]: '{"renamedAt":1}' })),
      null,
    );
  });

  it('treats a stored name that no longer passes the rules as no name at all', () => {
    // The bounds are the server's and may tighten. A player carrying a name the
    // board would refuse is given a fresh default rather than a future refusal.
    const storage = fakeStorage({
      [DISPLAY_NAME_STORAGE_KEY]: JSON.stringify({ name: 'way too long a name', renamedAt: 1 }),
    });

    assert.equal(readDisplayNameRecord(storage), null);
  });

  it('reads a renamedAt that is not a number as "never renamed"', () => {
    const storage = fakeStorage({
      [DISPLAY_NAME_STORAGE_KEY]: JSON.stringify({ name: 'Lamp', renamedAt: 'yesterday' }),
    });

    assert.deepEqual(readDisplayNameRecord(storage), { name: 'Lamp', renamedAt: null });
  });

  it('survives a browser that refuses storage, on both sides', () => {
    assert.equal(readDisplayNameRecord(refusingStorage), null);
    assert.equal(writeDisplayNameRecord({ name: 'Lamp', renamedAt: 1 }, refusingStorage), false);
    assert.equal(readDisplayNameRecord(null), null);
    assert.equal(writeDisplayNameRecord({ name: 'Lamp', renamedAt: 1 }, null), false);
  });
});

describe('the name this device plays under (§15.7)', () => {
  it('generates and persists a default when there is none', () => {
    const storage = fakeStorage();
    const record = ensureDisplayName({ storage, random: () => 0.5 });

    assert.equal(checkDisplayName(record.name).ok, true);
    assert.equal(record.renamedAt, null, 'a default is not a rename');
    assert.deepEqual(readDisplayNameRecord(storage), record, 'and it is kept');
  });

  it('keeps the stored name when there is one', () => {
    const storage = fakeStorage({
      [DISPLAY_NAME_STORAGE_KEY]: JSON.stringify({ name: 'Lampkeeper', renamedAt: 99 }),
    });

    assert.deepEqual(ensureDisplayName({ storage }), { name: 'Lampkeeper', renamedAt: 99 });
  });

  it('still returns a usable name when storage refuses the write', () => {
    const record = ensureDisplayName({ storage: refusingStorage, random: () => 0.25 });
    assert.equal(checkDisplayName(record.name).ok, true, 'the session has a name regardless');
  });
});

describe('the weekly rename (§15.3)', () => {
  const now = 1_000_000_000_000;

  it('is available to a player who has never chosen a name', () => {
    const record: DisplayNameRecord = { name: 'Vigil 7421', renamedAt: null };

    assert.equal(canRename(record, now), true);
    assert.equal(renameLockDays(record, now), 0);
  });

  it('locks for the interval after a rename, and unlocks on the nose', () => {
    const record: DisplayNameRecord = { name: 'Lampkeeper', renamedAt: now };

    assert.equal(canRename(record, now), false);
    assert.equal(renameLockRemainingMs(record, now), DISPLAY_NAME_RENAME_INTERVAL_MS);
    assert.equal(
      canRename(record, now + DISPLAY_NAME_RENAME_INTERVAL_MS - 1),
      false,
      'a millisecond short is still short',
    );
    assert.equal(canRename(record, now + DISPLAY_NAME_RENAME_INTERVAL_MS), true);
  });

  it('counts the days left up, never down to a zero it does not mean', () => {
    const record: DisplayNameRecord = { name: 'Lampkeeper', renamedAt: now };

    assert.equal(renameLockDays(record, now), 7);
    assert.equal(renameLockDays(record, now + MS_PER_DAY), 6);
    assert.equal(
      renameLockDays(record, now + DISPLAY_NAME_RENAME_INTERVAL_MS - 1),
      1,
      'the last hours still read as a day, because the editor is still shut',
    );
    assert.equal(renameLockDays(record, now + DISPLAY_NAME_RENAME_INTERVAL_MS), 0);
  });

  it('does not unlock because the device clock moved backwards', () => {
    const record: DisplayNameRecord = { name: 'Lampkeeper', renamedAt: now };

    assert.equal(canRename(record, now - MS_PER_DAY), false);
    assert.equal(renameLockRemainingMs(record, now - MS_PER_DAY), DISPLAY_NAME_RENAME_INTERVAL_MS);
  });

  it('starts the cooldown on a change, and not on a re-commit of the same name', () => {
    const storage = fakeStorage();
    const start: DisplayNameRecord = { name: 'Vigil 7421', renamedAt: null };

    const same = commitDisplayName(start, 'Vigil 7421', now, storage);
    assert.deepEqual(same, start, 'committing the name you had is not a rename');
    assert.equal(canRename(same, now), true);

    const changed = commitDisplayName(start, 'Lampkeeper', now, storage);
    assert.deepEqual(changed, { name: 'Lampkeeper', renamedAt: now });
    assert.equal(canRename(changed, now), false);
    assert.deepEqual(readDisplayNameRecord(storage), changed, 'and it is written at once');
  });
});
