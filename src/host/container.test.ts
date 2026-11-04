import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { prepareContainer, resolveContainer, type HostContainer } from './container';

/**
 * The slice of an element the mount touches, and nothing else. The point of the
 * structural typing in `container.ts` is that this is enough to assert the
 * whole restore contract without a DOM.
 */
class FakeElement extends EventTarget implements HostContainer {
  public readonly style = { overflow: '' };
  public focused = 0;

  private readonly attributes = new Map<string, string>();

  public hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public focus(): void {
    this.focused += 1;
  }
}

describe('resolveContainer', () => {
  it('passes an element straight through', () => {
    const element = new FakeElement();
    const lookup = { getElementById: (): FakeElement | null => null };

    assert.equal(resolveContainer(element, lookup), element);
  });

  it('looks an id up', () => {
    const element = new FakeElement();
    const lookup = { getElementById: (id: string): FakeElement | null => (id === 'game' ? element : null) };

    assert.equal(resolveContainer('game', lookup), element);
  });

  it('throws on an id that is not there, rather than taking over the page', () => {
    const lookup = { getElementById: (): FakeElement | null => null };

    assert.throws(() => resolveContainer('typo', lookup), /no element with id "typo"/);
  });
});

describe('prepareContainer', () => {
  it('clips the container and makes it focusable', () => {
    const element = new FakeElement();

    prepareContainer(element);

    assert.equal(element.style.overflow, 'hidden');
    assert.equal(element.getAttribute('tabindex'), '0');
  });

  it('puts both back on restore', () => {
    const element = new FakeElement();

    prepareContainer(element)();

    assert.equal(element.style.overflow, '');
    assert.equal(element.hasAttribute('tabindex'), false);
  });

  it('restores a pre-existing inline overflow rather than clearing it', () => {
    const element = new FakeElement();
    element.style.overflow = 'scroll';

    prepareContainer(element)();

    assert.equal(element.style.overflow, 'scroll');
  });

  it("leaves the host's own tabindex alone, and does not remove it on restore", () => {
    const element = new FakeElement();
    element.setAttribute('tabindex', '-1');

    const restore = prepareContainer(element);
    assert.equal(element.getAttribute('tabindex'), '-1');

    restore();
    assert.equal(element.getAttribute('tabindex'), '-1');
  });

  it('is idempotent, so a double destroy cannot undo a later mount', () => {
    const element = new FakeElement();
    const restore = prepareContainer(element);

    restore();
    element.style.overflow = 'auto';
    restore();

    assert.equal(element.style.overflow, 'auto');
  });

  it('never focuses the container by itself', () => {
    const element = new FakeElement();

    prepareContainer(element)();

    assert.equal(element.focused, 0);
  });
});
