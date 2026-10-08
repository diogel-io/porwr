import { finalizeEvent } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';
import type { Event, UnsignedEvent } from 'nostr-tools';
import { NIP57_ZAP_REQUEST_KIND, type BuildZapRequestInput, type SignedZapRequest } from '@/types/nip57';

function uniqueRelays(relays: string[]): string[] {
  return [...new Set(relays.map((relay) => relay.trim()).filter((relay) => relay.length > 0))];
}

export function buildUnsignedZapRequest(input: BuildZapRequestInput): UnsignedEvent & { kind: typeof NIP57_ZAP_REQUEST_KIND } {
  const relays = uniqueRelays(input.relays);
  if (relays.length === 0) {
    throw new Error('At least one receipt relay is required');
  }

  const tags: string[][] = [
    ['relays', ...relays],
    ['amount', String(input.amountMsat)],
    ['lnurl', input.lnurl],
    ['p', input.recipientPubkey],
  ];

  if (input.target.type === 'event') {
    tags.push(['e', input.target.eventId]);
    tags.push(['k', String(input.target.eventKind)]);
  }

  if (input.target.type === 'addressable') {
    tags.push(['a', input.target.coordinate]);
    tags.push(['k', String(input.target.eventKind)]);
  }

  return {
    kind: NIP57_ZAP_REQUEST_KIND,
    pubkey: input.senderPubkey,
    created_at: Math.floor(Date.now() / 1000),
    content: input.comment?.trim() ?? '',
    tags,
  };
}

export function signZapRequest(input: BuildZapRequestInput, privateKeyHex: string): SignedZapRequest {
  const unsigned = buildUnsignedZapRequest(input);
  const signed = finalizeEvent(unsigned, hexToBytes(privateKeyHex));
  return signed as Event & { kind: typeof NIP57_ZAP_REQUEST_KIND };
}
