import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installWalletRelay, readWalletSuccess } from '@/../src-bex/wallet-relay';
import {
  WALLET_RELAY_ARM,
  WALLET_RELAY_PORT_NAME,
} from '@/../src-bex/services/wallet-relay-protocol';

/**
 * The content script's half of the Firefox wallet relay (workspace#85).
 */

type ArmListener = (message: unknown, sender: { id?: string; tab?: unknown }) => unknown;

const WALLET = 'b'.repeat(64);
let armListeners: ArmListener[];
let postMessage: ReturnType<typeof vi.fn>;
let connect: ReturnType<typeof vi.fn>;

beforeEach(() => {
  armListeners = [];
  postMessage = vi.fn();
  connect = vi.fn(() => ({ postMessage }));
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'porwr',
      connect,
      onMessage: { addListener: (listener: ArmListener) => armListeners.push(listener) },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const arm = (sender: { id?: string; tab?: unknown } = { id: 'porwr' }): void => {
  for (const listener of armListeners) listener({ type: WALLET_RELAY_ARM }, sender);
};

const dispatchSuccess = (detail: unknown): void => {
  window.dispatchEvent(new CustomEvent('nwc:success', { detail }));
};

describe('readWalletSuccess', () => {
  it('copies out only the public connection details', () => {
    expect(
      readWalletSuccess({
        type: 'nwc:success',
        walletPubkey: WALLET,
        relayUrls: ['wss://relay.example.com', 42],
        lud16: 'alice@example.com',
        secret: 'not copied',
      }),
    ).toEqual({
      type: 'nwc:success',
      walletPubkey: WALLET,
      relayUrls: ['wss://relay.example.com'],
      lud16: 'alice@example.com',
    });
  });

  it('falls back to the single relayUrl Coinos sends', () => {
    expect(
      readWalletSuccess({ type: 'nwc:success', walletPubkey: WALLET, relayUrl: 'wss://r.example' }),
    ).toMatchObject({ relayUrls: ['wss://r.example'] });
  });

  it.each([
    ['another message type', { type: 'nwc:other', walletPubkey: WALLET }],
    ['no wallet pubkey', { type: 'nwc:success' }],
    ['a string', 'nwc:success'],
    ['null', null],
  ])('ignores %s', (_label, data) => {
    expect(readWalletSuccess(data)).toBeNull();
  });
});

describe('installWalletRelay', () => {
  it('relays nothing until the background arms the tab', () => {
    installWalletRelay();

    dispatchSuccess({ walletPubkey: WALLET, relayUrls: ['wss://relay.example.com'] });

    expect(connect).not.toHaveBeenCalled();
  });

  it.each([
    ['another extension', { id: 'other' }],
    ['a content script or page', { id: 'porwr', tab: { id: 3 } }],
  ])('cannot be armed by %s', (_label, sender) => {
    installWalletRelay();
    arm(sender);

    dispatchSuccess({ walletPubkey: WALLET, relayUrls: ['wss://relay.example.com'] });

    expect(connect).not.toHaveBeenCalled();
  });

  it('relays the Alby Hub event once armed, once only, over the relay port', () => {
    installWalletRelay();
    arm();

    dispatchSuccess({
      walletPubkey: WALLET,
      relayUrls: ['wss://relay.example.com'],
      lud16: 'a@b.c',
    });
    dispatchSuccess({ walletPubkey: 'c'.repeat(64), relayUrls: ['wss://relay.example.com'] });

    expect(connect).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledWith({ name: WALLET_RELAY_PORT_NAME });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'nwc:success',
      walletPubkey: WALLET,
      relayUrls: ['wss://relay.example.com'],
      lud16: 'a@b.c',
    });
  });

  it('forwards an answer the page gave before the tab was armed, once armed', () => {
    installWalletRelay();

    dispatchSuccess({ walletPubkey: WALLET, relayUrls: ['wss://relay.example.com'] });
    expect(connect).not.toHaveBeenCalled();

    arm();

    expect(connect).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ walletPubkey: WALLET }));
  });

  it('does not touch the opener outside Firefox', () => {
    const before: unknown = window.opener;
    installWalletRelay();
    arm();

    expect(window.opener).toBe(before);
  });
});
