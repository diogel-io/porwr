import { describe, it, expect } from 'vitest';

import {
  BLOSSOM_SERVER_PROTOCOL_ERROR,
  BLOSSOM_SERVER_TRAILING_SLASH_ERROR,
  normalizeBlossomServer,
  validateBlossomServerInput,
} from '@/services/blossom-server';

describe('normalizeBlossomServer', () => {
  it.each([
    ['https://threenine.blossom.band', 'https://threenine.blossom.band'],
    ['https://threenine.blossom.band/', 'https://threenine.blossom.band'],
    ['  https://Blossom.Example.COM  ', 'https://blossom.example.com'],
    ['https://example.com/blossom/', 'https://example.com/blossom'],
    ['https://example.com:8443', 'https://example.com:8443'],
  ])('serialises %s without a trailing slash (porwr#417)', (input, url) => {
    expect(normalizeBlossomServer(input)).toMatchObject({ valid: true, url });
  });

  it('gives the bare lowercase hostname for the BUD-11 server tag', () => {
    expect(normalizeBlossomServer('https://Blossom.Example.COM/media')).toMatchObject({
      hostname: 'blossom.example.com',
    });
  });

  it('refuses a server that is not https://', () => {
    expect(normalizeBlossomServer('http://blossom.example.com')).toEqual({
      valid: false,
      error: BLOSSOM_SERVER_PROTOCOL_ERROR,
    });
  });
});

describe('validateBlossomServerInput (porwr#417)', () => {
  it('refuses typed input that ends in a slash', () => {
    expect(validateBlossomServerInput('https://threenine.blossom.band/')).toEqual({
      valid: false,
      error: BLOSSOM_SERVER_TRAILING_SLASH_ERROR,
    });
  });

  it('accepts the same server without the slash', () => {
    expect(validateBlossomServerInput('https://threenine.blossom.band')).toMatchObject({
      valid: true,
      url: 'https://threenine.blossom.band',
    });
  });

  it.each(['', 'not a url', 'http://media.example.org', 'https://user:pass@media.example.org'])(
    'keeps the other rules for %j',
    (input) => {
      expect(validateBlossomServerInput(input).valid).toBe(false);
    },
  );
});
