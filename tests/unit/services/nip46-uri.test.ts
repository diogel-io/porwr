import { describe, expect, it } from 'vitest';

import { BUNKER_URI_NO_RELAYS, parseBunkerUri } from '@/services/nip46-uri';

const SIGNER = 'ab'.repeat(32);

describe('parseBunkerUri (#138)', () => {
  it('reads the signer key, its relays and the secret', () => {
    expect(
      parseBunkerUri(
        `bunker://${SIGNER}?relay=wss%3A%2F%2Frelay.one.example&relay=wss://relay.two.example/&secret=abc`,
      ),
    ).toEqual({
      remoteSignerPubkey: SIGNER,
      relays: ['wss://relay.one.example', 'wss://relay.two.example'],
      secret: 'abc',
    });
  });

  it('accepts a URI with no secret, and an upper-case key', () => {
    expect(parseBunkerUri(`  bunker://${SIGNER.toUpperCase()}?relay=wss://r.example  `)).toEqual({
      remoteSignerPubkey: SIGNER,
      relays: ['wss://r.example'],
    });
  });

  it('allows plaintext ws:// to a loopback relay only', () => {
    expect(parseBunkerUri(`bunker://${SIGNER}?relay=ws://localhost:7777`).relays).toEqual([
      'ws://localhost:7777',
    ]);
    expect(
      parseBunkerUri(`bunker://${SIGNER}?relay=ws://relay.example&relay=wss://ok.example`).relays,
    ).toEqual(['wss://ok.example']);
  });

  it('refuses a URI left with no relay Porwr may contact', () => {
    expect(() => parseBunkerUri(`bunker://${SIGNER}?relay=ws://relay.example`)).toThrow(
      BUNKER_URI_NO_RELAYS,
    );
    expect(() => parseBunkerUri(`bunker://${SIGNER}`)).toThrow(BUNKER_URI_NO_RELAYS);
  });

  it('refuses anything that is not a bunker URI with a hex key', () => {
    expect(() => parseBunkerUri('')).toThrow('required');
    expect(() => parseBunkerUri('not a uri')).toThrow('not a valid');
    expect(() => parseBunkerUri(`nostrconnect://${SIGNER}?relay=wss://r.example`)).toThrow(
      'bunker://',
    );
    expect(() => parseBunkerUri('bunker://npub1abc?relay=wss://r.example')).toThrow('hex key');
  });

  it('keeps a literal + in the secret, and still decodes percent-encoding', () => {
    expect(parseBunkerUri(`bunker://${SIGNER}?relay=wss://r.example&secret=ab+cd`).secret).toBe(
      'ab+cd',
    );
    expect(
      parseBunkerUri(`bunker://${SIGNER}?relay=wss://r.example&secret=ab%2Bcd%20e`).secret,
    ).toBe('ab+cd e');
  });

  it('refuses an empty or oversized secret', () => {
    expect(() => parseBunkerUri(`bunker://${SIGNER}?relay=wss://r.example&secret=`)).toThrow(
      'secret',
    );
    expect(() =>
      parseBunkerUri(`bunker://${SIGNER}?relay=wss://r.example&secret=${'x'.repeat(300)}`),
    ).toThrow('secret');
  });
});
