import { describe, it, expect } from 'vitest';
import {
  WALLET_PROVIDERS,
  createWalletProviderId,
  isLocalNetworkHost,
  isUnencryptedWalletOrigin,
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
    ['http://umbrel.local', 'http://umbrel.local'],
    ['http://umbrel.local:59000/apps', 'http://umbrel.local:59000'],
    ['http://192.168.0.37:59000', 'http://192.168.0.37:59000'],
    ['http://localhost:8080', 'http://localhost:8080'],
    ['http://[fd12:3456::7]:59000', 'http://[fd12:3456::7]:59000'],
  ])('accepts the home-network http address %s (workspace#149)', (input, origin) => {
    expect(resolveWalletProviderOrigin(alby, input)).toBe(origin);
  });

  it.each([
    ['http://hub.example.com'],
    ['http://8.8.8.8'],
    ['http://user:pass@umbrel.local'],
    ['ws://umbrel.local'],
    ['javascript:alert(1)'],
    ['not a url'],
    ['https://user:pass@hub.example.com'],
  ])('rejects the custom address %s', (input) => {
    expect(resolveWalletProviderOrigin(alby, input)).toBeNull();
  });

  it('refuses a custom origin for a provider that does not allow one', () => {
    expect(resolveWalletProviderOrigin(coinos, 'https://evil.example.com')).toBeNull();
    expect(resolveWalletProviderOrigin(coinos, 'http://umbrel.local')).toBeNull();
  });

  it('publishes a known wallet service only for Coinos', () => {
    expect(coinos.knownWalletService?.walletServicePubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(coinos.knownWalletService?.relay).toBe('wss://relay.coinos.io');
    expect(alby.knownWalletService).toBeUndefined();
  });
});

describe('isLocalNetworkHost (workspace#149)', () => {
  it.each([
    'localhost',
    'hub.localhost',
    'umbrel.local',
    'UMBREL.LOCAL',
    'nas.home.arpa',
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.37',
    '169.254.10.20',
    '[::1]',
    '[fd12:3456::7]',
    '[fc00::1]',
    '[fe80::1]',
  ])('treats %s as local', (host) => {
    expect(isLocalNetworkHost(host)).toBe(true);
  });

  it.each([
    'hub.example.com',
    'umbrel.local.example.com',
    'a.b.local',
    'local',
    '8.8.8.8',
    '172.15.0.1',
    '172.32.0.1',
    '192.169.0.1',
    '[2001:db8::1]',
    '[::ffff:c0a8:1]',
    '',
  ])('treats %s as not local', (host) => {
    expect(isLocalNetworkHost(host)).toBe(false);
  });
});

describe('isUnencryptedWalletOrigin', () => {
  it('is true only for http', () => {
    expect(isUnencryptedWalletOrigin('http://umbrel.local:59000')).toBe(true);
    expect(isUnencryptedWalletOrigin('https://my.albyhub.com')).toBe(false);
    expect(isUnencryptedWalletOrigin('not a url')).toBe(false);
  });
});
