// src/host owns the boundary between the game and the page it is embedded in.
// This file is everything the mount does to the host's own element.
//
// The rule it follows: touch as little as possible, record what you touched,
// and put it back on `destroy()`. An embedded game that leaves styles or
// attributes behind has not really been destroyed.
//
// Two changes are unavoidable, and they are the only two.
//
//  1. **`tabindex`.** Keyboard input is scoped to this element (see `mount.ts`),
//     and an element that cannot hold focus never receives a key event. Without
//     a tabindex the game would simply never hear the keyboard. It is only added
//     when the host has not set one, so a host that made its own arrangements
//     keeps them.
//  2. **`overflow: hidden`.** The acceptance criterion is that the game never
//     paints outside its container. Phaser's FIT mode sizes the canvas to fit
//     the parent, so this should never be load-bearing — but "should" is not
//     what the criterion asks for, and a one-line clip is cheaper than trusting
//     a rounding mode.
//
// Note what is *not* here: the element is never focused, sized, positioned or
// scrolled into view by the mount itself. Stealing focus from the page that
// embedded you is the rudest thing a widget can do. `mount()` returns a
// `focus()` the host can call when it means it, and focuses the container on a
// pointer press inside the game, which is the player asking for it.
//
// Typed against structural slices of the DOM so the whole file can be asserted
// on against a plain object in a Node test.

/** The slice of `HTMLElement` the mount reads or writes. */
export interface HostContainer extends EventTarget {
  readonly style: { overflow: string };
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  focus(): void;
}

/**
 * The slice of `document` used to resolve a container passed by id. Generic in
 * the element type so the lookup can be a stand-in in a test; `document`
 * satisfies it with `Element = HTMLElement`.
 */
export interface ContainerLookup<Element> {
  getElementById(id: string): Element | null;
}

const TABINDEX = 'tabindex';

/**
 * Focusable in tab order. Not `-1`: a player who navigates the page with the
 * keyboard has to be able to reach the game the same way they reach anything
 * else on it.
 */
const TABINDEX_FOCUSABLE = '0';

const OVERFLOW_CLIPPED = 'hidden';

/**
 * Finds the element to mount into.
 *
 * Throws rather than falling back to `document.body`, which is what Phaser does
 * with an unresolvable parent: a game that silently takes over the whole page
 * because of a typo in an id is worse than a game that does not start.
 */
export function resolveContainer<Element>(
  parent: string | Element,
  lookup: ContainerLookup<Element>,
): Element {
  if (typeof parent !== 'string') {
    return parent;
  }

  const found = lookup.getElementById(parent);
  if (found === null) {
    throw new Error(`mount(): no element with id "${parent}" to mount into.`);
  }

  return found;
}

/**
 * Applies the two changes above and returns the undo.
 *
 * The undo restores the *inline* values that were there before, including the
 * empty string, so a container whose overflow came from a stylesheet goes back
 * to inheriting it rather than being pinned to whatever it computed to.
 */
export function prepareContainer(container: HostContainer): () => void {
  const previousOverflow = container.style.overflow;
  const addedTabindex = !container.hasAttribute(TABINDEX);

  container.style.overflow = OVERFLOW_CLIPPED;

  if (addedTabindex) {
    container.setAttribute(TABINDEX, TABINDEX_FOCUSABLE);
  }

  let restored = false;

  return (): void => {
    if (restored) {
      return;
    }

    restored = true;
    container.style.overflow = previousOverflow;

    if (addedTabindex) {
      container.removeAttribute(TABINDEX);
    }
  };
}
