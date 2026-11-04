// One editing session on the title screen (`docs/design.md` §15.3).
//
// The session is the whole of what typing into the game does, so it is proved
// here rather than by typing into a browser: every refusal, the character the
// refusal was about, and what the field still holds afterwards.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DISPLAY_NAME_MAX_LENGTH,
  INPUT_FREE_PLAY_KEY,
  INPUT_RENAME_KEY,
  INPUT_RESTART_KEY,
} from '../config/index';
import {
  KEY_ACTION,
  backspaceName,
  commitName,
  keyAction,
  openNameEdit,
  typeIntoName,
  type NameEditState,
} from './nameEdit';

/** Types a whole string in, one keystroke at a time. */
function type(state: NameEditState, characters: string): NameEditState {
  return [...characters].reduce((next, character) => typeIntoName(next, character), state);
}

describe('where a keystroke goes (§15.4, §15.5)', () => {
  const PRINTABLE = [...'abcdefghijklmnopqrstuvwxyz0123456789 '];
  const offTitle = { onTitle: false, editing: false, renameAvailable: true };

  it('sends every key to the run when the game is not on the title screen', () => {
    // Condition C3.2, as an assertion: from GAME_OVER there is no key — not the
    // rename key, not the Free Play key, not any other — that reaches the name
    // or chooses a mode. This is what keeps a name step and a mode step out of
    // the path between dying and playing again, in both modes (criterion 29).
    for (const key of [
      ...PRINTABLE,
      INPUT_RENAME_KEY,
      INPUT_FREE_PLAY_KEY,
      INPUT_RESTART_KEY,
      'Enter',
      'Escape',
    ]) {
      assert.equal(keyAction(offTitle, key), KEY_ACTION.RUN_INPUT, `${key} goes to the run`);
    }
  });

  it('offers the rename key on the title screen, and only there', () => {
    const onTitle = { onTitle: true, editing: false, renameAvailable: true };

    assert.equal(keyAction(onTitle, INPUT_RENAME_KEY), KEY_ACTION.OPEN_NAME_EDITOR);
    assert.equal(
      keyAction(onTitle, INPUT_RENAME_KEY.toLowerCase()),
      KEY_ACTION.OPEN_NAME_EDITOR,
      'the key is the key, shifted or not',
    );
    assert.equal(keyAction(offTitle, INPUT_RENAME_KEY), KEY_ACTION.RUN_INPUT);
  });

  it('starts a run on every other key while the editor is shut', () => {
    const onTitle = { onTitle: true, editing: false, renameAvailable: true };
    const offered = new Set([INPUT_RENAME_KEY, INPUT_FREE_PLAY_KEY]);

    for (const key of PRINTABLE.filter((key) => !offered.has(key.toUpperCase()))) {
      assert.equal(keyAction(onTitle, key), KEY_ACTION.RUN_INPUT, `${key} begins a run`);
    }
  });

  it('offers the Free Play key on the title screen, and only there (§14.8)', () => {
    // The mode choice is one key press, and it lives on the title screen
    // only — GAM-16 condition C3.2. Every key that is not this one begins the
    // weekly vigil, which is what the title prompt names.
    const onTitle = { onTitle: true, editing: false, renameAvailable: true };

    assert.equal(keyAction(onTitle, INPUT_FREE_PLAY_KEY), KEY_ACTION.START_FREE_PLAY);
    assert.equal(
      keyAction(onTitle, INPUT_FREE_PLAY_KEY.toLowerCase()),
      KEY_ACTION.START_FREE_PLAY,
      'the key is the key, shifted or not',
    );
    assert.equal(
      keyAction(offTitle, INPUT_FREE_PLAY_KEY),
      KEY_ACTION.RUN_INPUT,
      'from GAME_OVER it is inert: R restarts the mode just played, and nothing asks again',
    );
  });

  it('keeps the two offered keys distinct', () => {
    // A single binding doing both jobs would make one of them unreachable, and
    // the title screen names both on rows of their own.
    assert.notEqual(INPUT_FREE_PLAY_KEY, INPUT_RENAME_KEY);
    assert.notEqual(INPUT_FREE_PLAY_KEY, INPUT_RESTART_KEY);
  });

  it('still begins Free Play while a rename is on cooldown', () => {
    // The two exceptions are independent: the rename key stops being offered,
    // the mode choice never does.
    const locked = { onTitle: true, editing: false, renameAvailable: false };

    assert.equal(keyAction(locked, INPUT_FREE_PLAY_KEY), KEY_ACTION.START_FREE_PLAY);
  });

  it('gives the rename key back to the run while a rename is on cooldown', () => {
    // Which is why the prompt goes back to "any key" then: the exception is on
    // screen for exactly as long as the exception is real (§15.4).
    const locked = { onTitle: true, editing: false, renameAvailable: false };

    assert.equal(keyAction(locked, INPUT_RENAME_KEY), KEY_ACTION.RUN_INPUT);
  });

  it('gives every key to the field while the editor is open', () => {
    const editing = { onTitle: true, editing: true, renameAvailable: true };

    for (const key of [
      ...PRINTABLE,
      INPUT_RENAME_KEY,
      INPUT_FREE_PLAY_KEY,
      INPUT_RESTART_KEY,
      'Enter',
      'Escape',
    ]) {
      assert.equal(keyAction(editing, key), KEY_ACTION.EDIT_NAME, `${key} is typing, not playing`);
    }
  });
});

describe('opening the editor (§15.3)', () => {
  it('starts on the name the player is carrying, so a rename is an edit', () => {
    const state = openNameEdit('Vigil 7421');

    assert.equal(state.draft, 'Vigil 7421');
    assert.equal(state.committed, 'Vigil 7421', 'and ESC has somewhere to go back to');
    assert.equal(state.notice, null);
  });
});

describe('typing (§15.3)', () => {
  it('takes letters, digits and single internal spaces', () => {
    const typed = type({ committed: 'Vigil 7421', draft: '', notice: null }, 'Lamp 9');

    assert.equal(typed.draft, 'Lamp 9');
    assert.equal(typed.notice, null);
  });

  it('refuses a character a name may not contain, and keeps the draft', () => {
    const state = typeIntoName({ committed: 'Lamp', draft: 'Lamp', notice: null }, '-');

    assert.equal(state.draft, 'Lamp', 'the refused character is not in the field');
    assert.equal(state.notice, 'bad-character');
  });

  it('refuses a leading space and a double space, each in its own words', () => {
    const empty: NameEditState = { committed: 'Lamp', draft: '', notice: null };
    assert.equal(typeIntoName(empty, ' ').notice, 'no-leading-space');
    assert.equal(typeIntoName(empty, ' ').draft, '');

    const spaced = type(empty, 'Lamp ');
    assert.equal(spaced.draft, 'Lamp ');
    assert.equal(typeIntoName(spaced, ' ').notice, 'double-space');
    assert.equal(typeIntoName(spaced, ' ').draft, 'Lamp ', 'and the second space is not taken');
  });

  it('stops at the maximum length and says that is what happened', () => {
    const full = type({ committed: 'Lamp', draft: '', notice: null }, 'a'.repeat(20));

    assert.equal(full.draft.length, DISPLAY_NAME_MAX_LENGTH);
    assert.equal(full.notice, 'full');
  });

  it('clears the last complaint as soon as a keystroke is accepted', () => {
    const refused = typeIntoName({ committed: 'Lamp', draft: 'Lamp', notice: null }, '!');
    assert.equal(refused.notice, 'bad-character');
    assert.equal(typeIntoName(refused, 'x').notice, null);
  });

  it('ignores anything that is not a single character', () => {
    const state: NameEditState = { committed: 'Lamp', draft: 'Lamp', notice: null };

    assert.deepEqual(typeIntoName(state, ''), state);
    assert.deepEqual(typeIntoName(state, 'ArrowLeft'), state);
  });
});

describe('backspace (§15.3)', () => {
  it('takes one character off the end', () => {
    assert.equal(backspaceName({ committed: 'x', draft: 'Lamp', notice: null }).draft, 'Lam');
  });

  it('empties the field without complaining about it', () => {
    const empty = backspaceName({ committed: 'x', draft: '', notice: 'bad-character' });

    assert.equal(empty.draft, '');
    assert.equal(empty.notice, null, 'backspacing is not an error, even at the start');
  });
});

describe('committing (§15.3)', () => {
  it('accepts a legal name, trimmed', () => {
    const result = commitName({ committed: 'Vigil 7421', draft: 'Lampkeeper ', notice: null });

    assert.equal(result.name, 'Lampkeeper');
    assert.equal(result.state.draft, 'Lampkeeper', 'the field shows what was saved');
    assert.equal(result.state.notice, null);
  });

  it('refuses a draft that is too short, and keeps it on screen to fix', () => {
    const result = commitName({ committed: 'Vigil 7421', draft: 'ab', notice: null });

    assert.equal(result.name, null, 'nothing is committed');
    assert.equal(result.state.draft, 'ab', 'and the player does not retype it');
    assert.equal(result.state.notice, 'too-short');
  });

  it('refuses an empty field as too short rather than silently keeping the old name', () => {
    const result = commitName({ committed: 'Vigil 7421', draft: '', notice: null });

    assert.equal(result.name, null);
    assert.equal(result.state.notice, 'too-short');
  });

  it('accepts the name it opened on, so ENTER on an untouched field is not a trap', () => {
    const result = commitName(openNameEdit('Vigil 7421'));
    assert.equal(result.name, 'Vigil 7421');
  });
});
