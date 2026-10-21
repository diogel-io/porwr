import { describe, it, expect } from 'vitest';
import {
  RELAY_PROTOCOL_ERROR,
  isAllowedRelayProtocol,
  isRestrictedHostname,
  normalizeRelayUrl,
} from '@/services/relay-url';

describe('normalizeRelayUrl', () => {
  it('should validate a valid wss:// URL', () => {
    const result = normalizeRelayUrl('wss://relay.damus.io');
    expect(result.valid).toBe(true);
    expect(result.url).toBe('wss://relay.damus.io');
    expect(result.hostname).toBe('relay.damus.io');
    expect(result.error).toBeUndefined();
  });

  it('should validate a valid ws:// URL', () => {
    const result = normalizeRelayUrl('ws://localhost:8080');
    expect(result.valid).toBe(true);
    expect(result.url).toBe('ws://localhost:8080');
    expect(result.hostname).toBe('localhost');
  });

  it('should trim whitespace', () => {
    const result = normalizeRelayUrl('  wss://relay.damus.io  ');
    expect(result.valid).toBe(true);
    expect(result.url).toBe('wss://relay.damus.io');
  });

  it('should normalize uppercase hostname to lowercase', () => {
    const result = normalizeRelayUrl('WSS://RELAY.DAMUS.IO');
    expect(result.valid).toBe(true);
    expect(result.url).toBe('wss://relay.damus.io');
    expect(result.hostname).toBe('relay.damus.io');
  });

  it('should normalize trailing slash (remove it if path is empty)', () => {
    const result = normalizeRelayUrl('wss://relay.damus.io/');
    expect(result.valid).toBe(true);
    expect(result.url).toBe('wss://relay.damus.io');
  });

  it('should normalize trailing slash even if there is a path', () => {
    const result = normalizeRelayUrl('wss://relay.damus.io/path/');
    expect(result.valid).toBe(true);
    expect(result.url).toBe('wss://relay.damus.io/path');
  });

  it('should reject empty string', () => {
    const result = normalizeRelayUrl('');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('URL cannot be empty');
  });

  it('should reject string with only whitespace', () => {
    const result = normalizeRelayUrl('   ');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('URL cannot be empty');
  });

  it('should reject null or undefined', () => {
    expect(normalizeRelayUrl(null).valid).toBe(false);
    expect(normalizeRelayUrl(undefined).valid).toBe(false);
  });

  it('should reject non-websocket schemes', () => {
    const result = normalizeRelayUrl('https://relay.damus.io');
    expect(result.valid).toBe(false);
    expect(result.error).toBe(RELAY_PROTOCOL_ERROR);
  });

  describe('plaintext ws:// (diogel-io/workspace#142, T19)', () => {
    it.each(['ws://relay.damus.io', 'ws://relay.example.com:7777/path', 'ws://192.168.1.10:8080'])(
      'rejects ws:// to a non-loopback host: %s',
      (url) => {
        const result = normalizeRelayUrl(url);
        expect(result.valid).toBe(false);
        expect(result.error).toBe(RELAY_PROTOCOL_ERROR);
      },
    );

    // The extension CSP cannot name an IPv6 address, so [::1] is refused too (manifest-csp.ts).
    it.each(['ws://0.0.0.0:8080', 'ws://[::]:8080', 'ws://[::1]:7000'])(
      'rejects ws:// to a wildcard address: %s',
      (url) => {
        expect(normalizeRelayUrl(url).valid).toBe(false);
      },
    );

    it.each(['ws://localhost:8080', 'ws://LOCALHOST:8080', 'ws://127.0.0.1:7000'])(
      'accepts ws:// to a loopback host: %s',
      (url) => {
        expect(normalizeRelayUrl(url).valid).toBe(true);
      },
    );

    it('accepts wss:// to any host', () => {
      expect(normalizeRelayUrl('wss://relay.damus.io').valid).toBe(true);
      expect(normalizeRelayUrl('wss://192.168.1.10').valid).toBe(true);
    });
  });

  describe('isAllowedRelayProtocol', () => {
    it('allows wss: and loopback ws: only', () => {
      expect(isAllowedRelayProtocol(new URL('wss://relay.example'))).toBe(true);
      expect(isAllowedRelayProtocol(new URL('ws://localhost'))).toBe(true);
      expect(isAllowedRelayProtocol(new URL('ws://relay.example'))).toBe(false);
      expect(isAllowedRelayProtocol(new URL('https://relay.example'))).toBe(false);
    });
  });

  it('should reject malformed URLs', () => {
    const result = normalizeRelayUrl('not-a-url');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid URL format');
  });

  it('should handle URLs with ports correctly', () => {
    const result = normalizeRelayUrl('wss://relay.pro:443/');
    expect(result.valid).toBe(true);
    expect(result.url).toBe('wss://relay.pro'); // URL constructor might strip default port
    expect(result.hostname).toBe('relay.pro');
  });

  it('should handle custom paths', () => {
    const result = normalizeRelayUrl('wss://relay.damus.io/v1');
    expect(result.valid).toBe(true);
    expect(result.url).toBe('wss://relay.damus.io/v1');
  });

  it('should reject excessively long URLs', () => {
    const longUrl = 'wss://' + 'a'.repeat(250) + '.com';
    const result = normalizeRelayUrl(longUrl);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('maximum length');
  });

  it('should reject malformed hostnames', () => {
    expect(normalizeRelayUrl('wss://.com').valid).toBe(false);
    expect(normalizeRelayUrl('wss://').valid).toBe(false);
    expect(normalizeRelayUrl('wss://.').valid).toBe(false);
  });

  it('should reject URLs with a fragment', () => {
    const result = normalizeRelayUrl('wss://relay.damus.io/#fragment');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('fragment');
  });

  it('should reject URLs with a fragment even when otherwise well-formed with a path', () => {
    const result = normalizeRelayUrl('wss://relay.damus.io/path#section');
    expect(result.valid).toBe(false);
  });
});

describe('isRestrictedHostname', () => {
  it('should identify localhost and loopback as restricted', () => {
    expect(isRestrictedHostname('localhost')).toBe(true);
    expect(isRestrictedHostname('127.0.0.1')).toBe(true);
    expect(isRestrictedHostname('[::1]')).toBe(true);
    expect(isRestrictedHostname('0.0.0.0')).toBe(true);
    expect(isRestrictedHostname('::')).toBe(true);
  });

  it('should identify IPv4 addresses as restricted', () => {
    expect(isRestrictedHostname('8.8.8.8')).toBe(true);
    expect(isRestrictedHostname('192.168.1.1')).toBe(true);
    expect(isRestrictedHostname('1.2.3.4')).toBe(true);
  });

  it('should identify IPv6 addresses as restricted', () => {
    expect(isRestrictedHostname('2001:db8::1')).toBe(true);
    expect(isRestrictedHostname('[2001:db8::1]')).toBe(true);
  });

  it('should identify normal hostnames as not restricted', () => {
    expect(isRestrictedHostname('relay.damus.io')).toBe(false);
    expect(isRestrictedHostname('nos.lol')).toBe(false);
    expect(isRestrictedHostname('my-relay.com')).toBe(false);
  });
});
