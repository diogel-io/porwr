import { createRelayUrl } from '@/types/relay-url';
import type { WalletProvider } from '@/types/wallet-provider';
import type { Nip47Command, Nip47AuthorizedWalletService } from '@/types/nip47';

/** The success message Alby Hub and Coinos post to the window that opened their `/apps/new` page. */
export const NWC_SUCCESS_MESSAGE_TYPE = 'nwc:success' as const;

export const DEFAULT_AUTHORIZATION_REQUEST_METHODS: readonly Nip47Command[] = [
  'pay_invoice',
  'get_balance',
  'get_info',
];

const HEX_64 = /^[0-9a-f]{64}$/;
const LUD16 = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LUD16_LENGTH = 320;
const MAX_RELAYS = 10;

/**
 * Builds the wallet page that asks the user to approve Porwr's client key.
 *
 * Only the public key goes into the URL. No `return_to` is sent: Coinos ignores it and Alby Hub
 * would redirect the popup away before the opener could read the message.
 */
export function buildAuthorizationUrl(
  provider: WalletProvider,
  origin: string,
  clientPubkey: string,
  options: { name: string; requestMethods?: readonly Nip47Command[] },
): string {
  const url = new URL(provider.authorizationPath, origin);
  url.searchParams.set('name', options.name);
  url.searchParams.set('pubkey', clientPubkey);
  const requestMethods = options.requestMethods ?? DEFAULT_AUTHORIZATION_REQUEST_METHODS;
  if (requestMethods.length > 0) {
    url.searchParams.set('request_methods', requestMethods.join(' '));
  }
  return url.toString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseRelays(record: Record<string, unknown>): string[] {
  const candidates = Array.isArray(record.relayUrls)
    ? record.relayUrls
    : typeof record.relayUrl === 'string'
      ? [record.relayUrl]
      : [];

  const relays = candidates
    .slice(0, MAX_RELAYS)
    .map((candidate) => (typeof candidate === 'string' ? createRelayUrl(candidate) : null))
    .filter(
      (relay): relay is NonNullable<typeof relay> => relay !== null && relay.startsWith('wss://'),
    );
  return Array.from(new Set<string>(relays));
}

function parseLud16(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length <= MAX_LUD16_LENGTH && LUD16.test(trimmed) ? trimmed : undefined;
}

function createAuthorizedWalletService(
  walletPubkey: unknown,
  relays: string[],
  lud16: unknown,
): Nip47AuthorizedWalletService | null {
  const walletServicePubkey =
    typeof walletPubkey === 'string' ? walletPubkey.trim().toLowerCase() : '';
  if (!HEX_64.test(walletServicePubkey) || relays.length === 0) {
    return null;
  }

  const address = parseLud16(lud16);
  return {
    walletServicePubkey,
    relays,
    ...(address ? { lud16: address } : {}),
  };
}

/**
 * Reads a wallet's `nwc:success` message.
 *
 * The message comes from a web page, so nothing in it is trusted: it is accepted only from the exact
 * origin Porwr opened, and only with a 64-hex wallet pubkey and at least one `wss:` relay.
 *
 * @returns The wallet service details, or `null` for any other message.
 */
export function parseAuthorizationMessage(
  messageOrigin: string,
  data: unknown,
  expectedOrigin: string,
): Nip47AuthorizedWalletService | null {
  if (messageOrigin !== expectedOrigin) {
    return null;
  }

  const record = asRecord(data);
  if (!record || record.type !== NWC_SUCCESS_MESSAGE_TYPE) {
    return null;
  }

  return createAuthorizedWalletService(record.walletPubkey, parseRelays(record), record.lud16);
}

/**
 * Re-checks wallet service details on arrival in the background.
 *
 * The page has already parsed them with `parseAuthorizationMessage`, but the background does not
 * rely on its caller having done so.
 *
 * @returns The validated details, or `null` when they are not acceptable.
 */
export function validateAuthorizedWalletService(
  input: Partial<Nip47AuthorizedWalletService>,
): Nip47AuthorizedWalletService | null {
  return createAuthorizedWalletService(
    input.walletServicePubkey,
    parseRelays({ relayUrls: Array.isArray(input.relays) ? input.relays : [] }),
    input.lud16,
  );
}
