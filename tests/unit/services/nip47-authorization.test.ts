import { describe, it, expect } from 'vitest';
import {
  buildAuthorizationUrl,
  parseAuthorizationMessage,
  validateAuthorizedWalletService,
} from '@/services/nip47-authorization';
import { WALLET_PROVIDERS } from '@/types/wallet-provider';

const ORIGIN = 'https://coinos.io';
const WALLET = 'B'.repeat(64);
const CLIENT = 'c'.repeat(64);

const success = (over: Record<string, unknown> = {}) => ({
  type: 'nwc:success',
  walletPubkey: WALLET,
  relayUrl: 'wss://relay.coinos.io',
  lud16: 'alice@coinos.io',
  ...over,
});

describe('buildAuthorizationUrl', () => {
  it('sends the app name, the client pubkey and the default request methods, and no return_to', () => {
    const url = new URL(
      buildAuthorizationUrl(WALLET_PROVIDERS.coinos, ORIGIN, CLIENT, { name: 'Porwr' }),
    );

    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe('/apps/new');
    expect(url.searchParams.get('name')).toBe('Porwr');
    expect(url.searchParams.get('pubkey')).toBe(CLIENT);
    expect(url.searchParams.get('request_methods')).toBe('pay_invoice get_balance get_info');
    expect(url.searchParams.has('return_to')).toBe(false);
    expect(url.searchParams.has('secret')).toBe(false);
  });

  it('uses a custom origin and omits request_methods when none are asked for', () => {
    const url = new URL(
      buildAuthorizationUrl(WALLET_PROVIDERS['alby-hub'], 'https://hub.example.com', CLIENT, {
        name: 'Porwr',
        requestMethods: [],
      }),
    );

    expect(url.href.startsWith('https://hub.example.com/apps/new?')).toBe(true);
    expect(url.searchParams.has('request_methods')).toBe(false);
  });
});

describe('parseAuthorizationMessage', () => {
  it('reads the Coinos message, lower-casing the wallet pubkey', () => {
    expect(parseAuthorizationMessage(ORIGIN, success(), ORIGIN)).toEqual({
      walletServicePubkey: 'b'.repeat(64),
      relays: [expect.stringMatching(/^wss:\/\/relay\.coinos\.io\/?$/)],
      lud16: 'alice@coinos.io',
    });
  });

  it('prefers Alby Hub relayUrls, keeping only distinct wss relays', () => {
    const parsed = parseAuthorizationMessage(
      ORIGIN,
      success({
        relayUrl: 'wss://ignored.example.com',
        relayUrls: [
          'wss://a.example.com',
          'wss://a.example.com',
          'ws://insecure.example.com',
          7,
          'nope',
        ],
      }),
      ORIGIN,
    );

    expect(parsed?.relays).toHaveLength(1);
    expect(parsed?.relays[0]).toMatch(/^wss:\/\/a\.example\.com\/?$/);
  });

  it('drops an unusable lightning address rather than rejecting the connection', () => {
    expect(
      parseAuthorizationMessage(ORIGIN, success({ lud16: 'not an address' }), ORIGIN),
    ).not.toHaveProperty('lud16');
    expect(parseAuthorizationMessage(ORIGIN, success({ lud16: 42 }), ORIGIN)).not.toHaveProperty(
      'lud16',
    );
  });

  it('ignores a message from any other origin', () => {
    expect(parseAuthorizationMessage('https://evil.example.com', success(), ORIGIN)).toBeNull();
  });

  it.each([
    ['a non-object', 'nwc:success'],
    ['an array', [success()]],
    ['another message type', success({ type: 'nwc:other' })],
    ['a short wallet pubkey', success({ walletPubkey: 'abc' })],
    ['a missing wallet pubkey', success({ walletPubkey: undefined })],
    ['no relays', success({ relayUrl: undefined })],
    ['only insecure relays', success({ relayUrl: 'ws://relay.coinos.io' })],
  ])('rejects %s', (_label, data) => {
    expect(parseAuthorizationMessage(ORIGIN, data, ORIGIN)).toBeNull();
  });
});

describe('validateAuthorizedWalletService', () => {
  it('accepts details the page parsed', () => {
    expect(
      validateAuthorizedWalletService({
        walletServicePubkey: WALLET,
        relays: ['wss://relay.coinos.io'],
      }),
    ).toMatchObject({ walletServicePubkey: 'b'.repeat(64) });
  });

  it('rejects details the page should never have sent', () => {
    expect(validateAuthorizedWalletService({ walletServicePubkey: WALLET, relays: [] })).toBeNull();
    expect(validateAuthorizedWalletService({ walletServicePubkey: WALLET })).toBeNull();
    expect(validateAuthorizedWalletService({ relays: ['wss://relay.coinos.io'] })).toBeNull();
  });
});
