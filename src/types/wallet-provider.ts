/**
 * A wallet Porwr can connect to without the user pasting a connection string (#110).
 *
 * Each provider hosts an `/apps/new` page that takes the public key of a client secret Porwr
 * generated, asks the user to approve it, and posts the wallet service's public details back to the
 * window that opened it (`nwc:success`). This is a convention Alby Hub and Coinos share, not part of
 * NIP-47, so it is modelled per provider rather than assumed for any wallet.
 */
export const WALLET_PROVIDER_IDS = ['alby-hub', 'coinos'] as const;

export type WalletProviderId = (typeof WALLET_PROVIDER_IDS)[number];

export interface KnownWalletService {
  readonly walletServicePubkey: string;
  readonly relay: string;
}

export interface WalletProvider {
  readonly id: WalletProviderId;
  readonly name: string;
  readonly defaultOrigin: string;
  readonly authorizationPath: string;
  /** Whether the user may point Porwr at their own instance, such as a self-hosted Alby Hub. */
  readonly allowsCustomOrigin: boolean;
  /**
   * A wallet service whose pubkey and relay are fixed and published. When the popup's message is
   * lost, Porwr can still prove the connection was approved by asking this service directly.
   */
  readonly knownWalletService?: KnownWalletService;
}

export const WALLET_PROVIDERS: Readonly<Record<WalletProviderId, WalletProvider>> = {
  'alby-hub': {
    id: 'alby-hub',
    name: 'Alby Hub',
    defaultOrigin: 'https://my.albyhub.com',
    authorizationPath: '/apps/new',
    allowsCustomOrigin: true,
  },
  coinos: {
    id: 'coinos',
    name: 'Coinos',
    defaultOrigin: 'https://coinos.io',
    authorizationPath: '/apps/new',
    allowsCustomOrigin: false,
    knownWalletService: {
      walletServicePubkey: 'ba80990666ef0b6f4ba5059347beb13242921e54669e680064ca755256a1e3a6',
      relay: 'wss://relay.coinos.io',
    },
  },
};

/**
 * @returns The provider id, or `null` when `input` names no provider Porwr supports.
 */
export function createWalletProviderId(input: unknown): WalletProviderId | null {
  return typeof input === 'string' && (WALLET_PROVIDER_IDS as readonly string[]).includes(input)
    ? (input as WalletProviderId)
    : null;
}

function isPrivateIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!match) {
    return false;
  }
  const a = Number(match[1]);
  const b = Number(match[2]);
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function isPrivateIpv6(host: string): boolean {
  if (!host.startsWith('[') || !host.endsWith(']')) {
    return false;
  }
  const address = host.slice(1, -1);
  if (address === '::1') {
    return true;
  }
  // `URL` serialises IPv6 compressed and lower-case, so the first hextet is everything before the
  // first colon, and is empty when the address starts with `::`.
  const first = Number.parseInt(address.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

/**
 * Whether `hostname`, as `URL.hostname` gives it, names a machine on the user's own network:
 * loopback, a single-label `.local` mDNS name such as `umbrel.local`, a `.home.arpa` name, or a
 * private, loopback or link-local IP address (workspace#149).
 *
 * Home servers such as Umbrel serve Alby Hub over plain `http:`, which Porwr accepts only for these.
 */
export function isLocalNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    /^[a-z0-9-]+\.local$/.test(host) ||
    host.endsWith('.home.arpa') ||
    isPrivateIpv4(host) ||
    isPrivateIpv6(host)
  );
}

/**
 * Whether Porwr would reach the wallet at `origin` without encryption, so the user should be told.
 */
export function isUnencryptedWalletOrigin(origin: string): boolean {
  try {
    return new URL(origin).protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Resolves the origin Porwr opens and accepts the `nwc:success` message from.
 *
 * A custom origin is honoured only for a provider that allows one, and is reduced to its origin so a
 * path or query in the user's input cannot change where the popup goes. It must be `https:`, or
 * `http:` for a host on the user's own network (`isLocalNetworkHost`), such as a Hub on Umbrel.
 *
 * @returns The origin, or `null` when `customOrigin` is not acceptable for this provider.
 */
export function resolveWalletProviderOrigin(
  provider: WalletProvider,
  customOrigin?: string | null,
): string | null {
  const trimmed = customOrigin?.trim();
  if (!trimmed) {
    return provider.defaultOrigin;
  }
  if (!provider.allowsCustomOrigin) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    const allowedScheme =
      url.protocol === 'https:' || (url.protocol === 'http:' && isLocalNetworkHost(url.hostname));
    return allowedScheme && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}
