import { getPublicKey } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';
import type { ParsedNwcUri } from '@/types/nip47';

const HEX_64 = /^[0-9a-fA-F]{64}$/;

function assertHex64(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!HEX_64.test(normalized)) {
    throw new Error(`${label} must be a 64-character hex value`);
  }
  return normalized;
}

function normalizeRelay(relay: string): string {
  const trimmed = relay.trim();
  if (!trimmed) {
    throw new Error('Relay URL cannot be empty');
  }

  const url = new URL(trimmed);
  if (url.protocol !== 'wss:' && url.protocol !== 'ws:') {
    throw new Error(`Relay URL must use ws:// or wss://: ${trimmed}`);
  }
  url.hash = '';
  return url.toString();
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function parseNwcUri(input: string): ParsedNwcUri {
  const raw = input.trim();
  if (!raw) {
    throw new Error('NWC URI is required');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('NWC URI is not a valid URL');
  }

  if (url.protocol !== 'nostr+walletconnect:') {
    throw new Error('NWC URI must start with nostr+walletconnect://');
  }

  const walletServicePubkey = assertHex64(url.hostname || url.pathname.replace(/^\/\//, ''), 'Wallet service pubkey');
  const clientSecret = assertHex64(url.searchParams.get('secret') ?? '', 'NWC secret');
  const relays = dedupe(url.searchParams.getAll('relay').map(normalizeRelay));
  const lud16 = url.searchParams.get('lud16')?.trim() || undefined;

  if (relays.length === 0) {
    throw new Error('NWC URI must include at least one relay parameter');
  }

  // Validate the secret is a usable secp256k1 private key by deriving a pubkey.
  getPublicKey(hexToBytes(clientSecret));

  return {
    walletServicePubkey,
    clientSecret,
    relays,
    ...(lud16 ? { lud16 } : {}),
  };
}

export function buildNip47ConnectionId(walletServicePubkey: string, clientPubkey: string): string {
  return `nip47:${walletServicePubkey}:${clientPubkey}`;
}
