import { describe, it, expect } from 'vitest';
import {
  WALLET_PROVIDERS,
  createWalletProviderId,
  resolveWalletProviderOrigin,
} from '@/types/wallet-provider';

describe('createWalletProviderId', () => {
  it('accepts the supported providers', () => {
    expect(createWalletProviderId('alby-hub')).toBe('alby-hub');
    expect(createWalletProviderId('coinos')).toBe('coinos');
  });

  it.each([['mutiny'], [''], [undefined], [null], [42], [{}]])('rejects %j', (input) => {
    expect(createWalletProviderId(input)).toBeNull();
  });
});

describe('resolveWalletProviderOrigin', () => {
  const alby = WALLET_PROVIDERS['alby-hub'];
  const coinos = WALLET_PROVIDERS.coinos;

  it('uses the default origin when no custom one is given', () => {
    expect(resolveWalletProviderOrigin(alby)).toBe('https://my.albyhub.com');
    expect(resolveWalletProviderOrigin(alby, '   ')).toBe('https://my.albyhub.com');
    expect(resolveWalletProviderOrigin(coinos, null)).toBe('https://coinos.io');
  });

  it('reduces a custom Alby Hub address to its origin', () => {
    expect(resolveWalletProviderOrigin(alby, ' https://hub.example.com/apps?x=1#y ')).toBe(
      'https://hub.example.com',
    );
    expect(resolveWalletProviderOrigin(alby, 'https://hub.example.com:8443/')).toBe(
      'https://hub.example.com:8443',
    );
  });

  it.each([
    ['http://hub.example.com'],
    ['javascript:alert(1)'],
    ['not a url'],
    ['https://user:pass@hub.example.com'],
  ])('rejects the custom address %s', (input) => {
    expect(resolveWalletProviderOrigin(alby, input)).toBeNull();
  });

  it('refuses a custom origin for a provider that does not allow one', () => {
    expect(resolveWalletProviderOrigin(coinos, 'https://evil.example.com')).toBeNull();
  });

  it('publishes a known wallet service only for Coinos', () => {
    expect(coinos.knownWalletService?.walletServicePubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(coinos.knownWalletService?.relay).toBe('wss://relay.coinos.io');
    expect(alby.knownWalletService).toBeUndefined();
  });
});
