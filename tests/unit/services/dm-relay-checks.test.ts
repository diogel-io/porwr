import { describe, it, expect } from 'vitest';

import { summariseDmRelayChecks } from '@/services/dm-relay-checks';

describe('summariseDmRelayChecks', () => {
  it('passes a list where every relay keeps messages', () => {
    expect(
      summariseDmRelayChecks([
        { url: 'wss://a', status: 'keeps' },
        { url: 'wss://b', status: 'keeps' },
      ]),
    ).toEqual({ dropping: [], allDrop: false });
  });

  it('names the dropping relays in list order, without blocking, when another keeps messages', () => {
    expect(
      summariseDmRelayChecks([
        { url: 'wss://b', status: 'drops' },
        { url: 'wss://a', status: 'keeps' },
        { url: 'wss://c', status: 'drops' },
      ]),
    ).toEqual({ dropping: ['wss://b', 'wss://c'], allDrop: false });
  });

  it('blocks a list where every relay drops messages', () => {
    expect(summariseDmRelayChecks([{ url: 'wss://damus', status: 'drops' }])).toEqual({
      dropping: ['wss://damus'],
      allDrop: true,
    });
  });

  it('does not count a relay it could not check as dropping', () => {
    expect(
      summariseDmRelayChecks([
        { url: 'wss://damus', status: 'drops' },
        { url: 'wss://down', status: 'unchecked' },
      ]),
    ).toEqual({ dropping: ['wss://damus'], allDrop: false });
  });

  it('does not block an empty list', () => {
    expect(summariseDmRelayChecks([])).toEqual({ dropping: [], allDrop: false });
  });
});
