import { describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils';
import { buildNip47ConnectionId, parseNwcUri } from '@/services/nip47-uri';

describe('parseNwcUri', () => {
  it('parses a valid NWC URI', () => {
    const walletSecret = generateSecretKey();
    const walletPubkey = getPublicKey(walletSecret);
    const clientSecret = bytesToHex(generateSecretKey());
    const uri = `nostr+walletconnect://${walletPubkey}?relay=${encodeURIComponent('wss://relay.example.com')}&secret=${clientSecret}&lud16=wallet@example.com`;

    const parsed = parseNwcUri(uri);

    expect(parsed.walletServicePubkey).toBe(walletPubkey);
    expect(parsed.clientSecret).toBe(clientSecret);
    expect(parsed.relays).toEqual(['wss://relay.example.com/']);
    expect(parsed.lud16).toBe('wallet@example.com');
  });

  it('rejects missing relay parameters', () => {
    const walletPubkey = getPublicKey(generateSecretKey());
    const clientSecret = bytesToHex(generateSecretKey());

    expect(() => parseNwcUri(`nostr+walletconnect://${walletPubkey}?secret=${clientSecret}`)).toThrow(
      'at least one relay',
    );
  });

  it('builds stable local connection ids', () => {
    const walletPubkey = getPublicKey(generateSecretKey());
    const clientPubkey = getPublicKey(generateSecretKey());

    expect(buildNip47ConnectionId(walletPubkey, clientPubkey)).toBe(`nip47:${walletPubkey}:${clientPubkey}`);
  });
});
