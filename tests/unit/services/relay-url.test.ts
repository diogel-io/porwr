import { describe, it, expect } from 'vitest';
import { normalizeRelayUrl, isRestrictedHostname } from '@/services/relay-url';

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
    expect(result.error).toBe('Only ws:// and wss:// protocols are supported');
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
