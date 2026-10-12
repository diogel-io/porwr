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

/**
 * Resolves the origin Porwr opens and accepts the `nwc:success` message from.
 *
 * A custom origin is honoured only for a provider that allows one, must be `https:`, and is reduced
 * to its origin so a path or query in the user's input cannot change where the popup goes.
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
    return url.protocol === 'https:' && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}
