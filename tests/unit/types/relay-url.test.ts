import { describe, it, expect } from 'vitest';
import { createRelayUrl } from '@/types/relay-url';

describe('createRelayUrl', () => {
  it('accepts a valid wss:// URL', () => {
    expect(createRelayUrl('wss://relay.damus.io')).toBe('wss://relay.damus.io');
  });

  it('normalizes a trailing slash', () => {
    expect(createRelayUrl('wss://relay.damus.io/')).toBe('wss://relay.damus.io');
  });

  it('returns null for a non-websocket protocol', () => {
    expect(createRelayUrl('https://relay.damus.io')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(createRelayUrl('')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(createRelayUrl(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(createRelayUrl(undefined)).toBeNull();
  });

  it('returns null for a malformed URL', () => {
    expect(createRelayUrl('not a url')).toBeNull();
  });

  it('returns null for a URL with a fragment, since WebSocket() throws on those', () => {
    expect(createRelayUrl('wss://relay.damus.io/#fragment')).toBeNull();
  });
});
