// src/scenes owns the run and its bookkeeping. This is the typing half of
// `docs/design.md` §15: one editing session on the title screen, as data.
//
// It holds no Phaser and no strings a player ever sees. A rejected keystroke
// comes back as a *reason*, and `src/hud/strings.ts` owns the sentence it is
// said in — the same split the rest of the HUD already uses, and what lets the
// whole editor be proved at a node prompt rather than by typing into a browser.
//
// The session is a value, not a mutable object: every entry point returns the
// next state. The scene holds the current one and has exactly one place where
// an editing session can change, which is what makes "there is no name step on
// the restart path" something you can read rather than something you hope.

import { DISPLAY_NAME_MAX_LENGTH, INPUT_RENAME_KEY } from '../config/index';
import { checkDisplayName, isNameCharacter, type NameRejection } from './displayName';

// ---------------------------------------------------------------------------
// Where a keystroke goes — §15.4, §15.5
// ---------------------------------------------------------------------------

/** What the game does with one key press, before anything acts on it. */
export const KEY_ACTION = {
  /** Into the open name field. */
  EDIT_NAME: 'edit-name',
  /** Opens the name editor. TITLE only, and only while a rename is available. */
  OPEN_NAME_EDITOR: 'open-name-editor',
  /** On to the run: starts one from TITLE, lifts a §2.5 pause, or does nothing. */
  RUN_INPUT: 'run-input',
} as const;

export type KeyAction = (typeof KEY_ACTION)[keyof typeof KEY_ACTION];

export interface KeyContext {
  /** Whether the run state is TITLE. The name has no business in any other. */
  readonly onTitle: boolean;
  readonly editing: boolean;
  /** Whether the weekly rename is available, and so whether the key is offered. */
  readonly renameAvailable: boolean;
}

/**
 * The whole of what §15 does to the game's input, as one function.
 *
 * It is a function rather than three branches inside the scene so that
 * condition C3.2 — no name step between the lose state and the next playable
 * frame — is something a test asserts instead of something the scene is trusted
 * to keep doing. Off the title screen there is no key that reaches the name.
 */
export function keyAction(context: KeyContext, key: string): KeyAction {
  if (context.editing) {
    return KEY_ACTION.EDIT_NAME;
  }

  if (context.onTitle && context.renameAvailable && key.toUpperCase() === INPUT_RENAME_KEY) {
    return KEY_ACTION.OPEN_NAME_EDITOR;
  }

  return KEY_ACTION.RUN_INPUT;
}

/**
 * What the editor has to say about the last thing the player did, or null when
 * it has nothing to add and the screen shows the standing weekly rule instead.
 */
export type NameNotice = NameRejection | 'no-leading-space' | 'full';

export interface NameEditState {
  /** The name the editor opened on — what ESC goes back to. */
  readonly committed: string;
  /** What is in the field right now, exactly as typed. */
  readonly draft: string;
  readonly notice: NameNotice | null;
}

/** Opens a session on the name the player is currently carrying. */
export function openNameEdit(committed: string): NameEditState {
  return { committed, draft: committed, notice: null };
}

/**
 * One printable character.
 *
 * Spaces are the only character with a position rule, and both halves of it are
 * refused at the keystroke rather than at ENTER: a leading space is invisible,
 * and a second space in a row is nearly so. Finding out at ENTER that an
 * invisible character sank the name is the worst version of this screen.
 */
export function typeIntoName(state: NameEditState, character: string): NameEditState {
  if (character.length !== 1) {
    return state;
  }

  if (character === ' ') {
    if (state.draft.length === 0) {
      return { ...state, notice: 'no-leading-space' };
    }

    if (state.draft.endsWith(' ')) {
      return { ...state, notice: 'double-space' };
    }
  } else if (!isNameCharacter(character)) {
    return { ...state, notice: 'bad-character' };
  }

  if (state.draft.length >= DISPLAY_NAME_MAX_LENGTH) {
    return { ...state, notice: 'full' };
  }

  return { ...state, draft: state.draft + character, notice: null };
}

/** One character off the end. Backspacing an empty field is not a complaint. */
export function backspaceName(state: NameEditState): NameEditState {
  if (state.draft.length === 0) {
    return { ...state, notice: null };
  }

  return { ...state, draft: state.draft.slice(0, -1), notice: null };
}

export interface NameCommit {
  readonly state: NameEditState;
  /** The accepted name, or null when the draft was refused and the editor stays open. */
  readonly name: string | null;
}

/**
 * ENTER. The draft is trimmed and checked against the §15.1 rules; a refusal
 * keeps the editor open with the reason on screen, and keeps the draft, because
 * a field that empties itself when it rejects you is a field you type into
 * twice.
 */
export function commitName(state: NameEditState): NameCommit {
  const checked = checkDisplayName(state.draft);

  if (!checked.ok) {
    return { state: { ...state, notice: checked.reason }, name: null };
  }

  return { state: { ...state, draft: checked.name, notice: null }, name: checked.name };
}
