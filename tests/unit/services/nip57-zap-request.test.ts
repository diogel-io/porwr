import { describe, expect, it } from 'vitest';

import { buildUnsignedZapRequest } from '@/services/nip57-zap-request';

const SENDER = 'a'.repeat(64);
const RECIPIENT = 'b'.repeat(64);

describe('nip57-zap-request', () => {
  it('builds a profile zap request with required NIP-57 tags', () => {
    const event = buildUnsignedZapRequest({
      senderPubkey: SENDER,
      recipientPubkey: RECIPIENT,
      amountMsat: 21000,
      lnurl: 'lnurl1abc',
      relays: ['wss://relay.example.com', 'wss://relay.example.com'],
      comment: 'Zap!',
      target: { type: 'profile', recipientPubkey: RECIPIENT },
    });

    expect(event.kind).toBe(9734);
    expect(event.pubkey).toBe(SENDER);
    expect(event.content).toBe('Zap!');
    expect(event.tags).toContainEqual(['relays', 'wss://relay.example.com']);
    expect(event.tags).toContainEqual(['amount', '21000']);
    expect(event.tags).toContainEqual(['lnurl', 'lnurl1abc']);
    expect(event.tags).toContainEqual(['p', RECIPIENT]);
  });

  it('adds event target tags for event zaps', () => {
    const event = buildUnsignedZapRequest({
      senderPubkey: SENDER,
      recipientPubkey: RECIPIENT,
      amountMsat: 1000,
      lnurl: 'lnurl1abc',
      relays: ['wss://relay.example.com'],
      target: {
        type: 'event',
        recipientPubkey: RECIPIENT,
        eventId: 'c'.repeat(64),
        eventKind: 1,
      },
    });

    expect(event.tags).toContainEqual(['e', 'c'.repeat(64)]);
    expect(event.tags).toContainEqual(['k', '1']);
  });

  it('adds addressable target tags for addressable event zaps', () => {
    const event = buildUnsignedZapRequest({
      senderPubkey: SENDER,
      recipientPubkey: RECIPIENT,
      amountMsat: 1000,
      lnurl: 'lnurl1abc',
      relays: ['wss://relay.example.com'],
      target: {
        type: 'addressable',
        recipientPubkey: RECIPIENT,
        coordinate: `30023:${RECIPIENT}:article`,
        eventKind: 30023,
      },
    });

    expect(event.tags).toContainEqual(['a', `30023:${RECIPIENT}:article`]);
    expect(event.tags).toContainEqual(['k', '30023']);
  });

  it('requires at least one receipt relay', () => {
    expect(() => buildUnsignedZapRequest({
      senderPubkey: SENDER,
      recipientPubkey: RECIPIENT,
      amountMsat: 1000,
      lnurl: 'lnurl1abc',
      relays: [],
      target: { type: 'profile', recipientPubkey: RECIPIENT },
    })).toThrow('At least one receipt relay is required');
  });
});
