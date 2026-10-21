import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import { isSignableEventKind, MAX_EVENT_KIND } from '@/../src-bex/services/event-kind';

/** A site's event kind reaches the risk class and the grant key, so it must be a real kind (#139). */
describe('isSignableEventKind', () => {
  it.each([0, 1, 9734, 30_023, MAX_EVENT_KIND])('accepts %s', (kind) => {
    expect(isSignableEventKind(kind)).toBe(true);
  });

  it.each([
    ['a wildcard string', 'any'],
    ['a numeric string', '1'],
    ['a negative number', -1],
    ['a fraction', 1.5],
    ['a kind out of range', MAX_EVENT_KIND + 1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['nothing', undefined],
    ['null', null],
  ])('refuses %s', (_label, kind) => {
    expect(isSignableEventKind(kind)).toBe(false);
  });

  // `background.ts` cannot be imported, so this reads its source, as other boundary tests do.
  it('is checked before a signing request does anything else', () => {
    const source = readFileSync(resolve(__dirname, '../../../src-bex/background.ts'), 'utf8');
    const handler = /'nostr\.signEvent': async \(\{ event \}, origin\) => \{\s*([^\n]+)/.exec(
      source,
    );

    expect(handler?.[1]).toBe('if (!isSignableEventKind(event?.kind)) {');
  });
});
