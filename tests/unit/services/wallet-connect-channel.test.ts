import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  WALLET_CONNECT_CHANNEL,
  listenForWalletConnectOutcome,
  postWalletConnectOutcome,
  type WalletConnectOutcome,
} from '@/services/wallet-connect-channel';

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('wallet connect channel (workspace#76)', () => {
  const stops: (() => void)[] = [];
  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
  });

  it('delivers an outcome to the listener for the same request', async () => {
    const received = vi.fn();
    stops.push(listenForWalletConnectOutcome('request-1', received));

    postWalletConnectOutcome('request-1', { status: 'no-response' });
    await tick();

    expect(received).toHaveBeenCalledExactlyOnceWith({ status: 'no-response' });
  });

  it('ignores outcomes for another request', async () => {
    const received = vi.fn();
    stops.push(listenForWalletConnectOutcome('request-1', received));

    postWalletConnectOutcome('request-2', { status: 'no-response' });
    await tick();

    expect(received).not.toHaveBeenCalled();
  });

  it('ignores messages that are not an outcome', async () => {
    const received = vi.fn();
    stops.push(listenForWalletConnectOutcome('request-1', received));

    const other = new BroadcastChannel(WALLET_CONNECT_CHANNEL);
    other.postMessage({ requestId: 'request-1', outcome: { status: 'connected-everything' } });
    other.postMessage('request-1');
    other.close();
    await tick();

    expect(received).not.toHaveBeenCalled();
  });

  it('reports only the first outcome', async () => {
    const received = vi.fn();
    stops.push(listenForWalletConnectOutcome('request-1', received));

    const first: WalletConnectOutcome = { status: 'error', message: 'Vault is locked' };
    postWalletConnectOutcome('request-1', first);
    postWalletConnectOutcome('request-1', { status: 'no-response' });
    await tick();

    expect(received).toHaveBeenCalledExactlyOnceWith(first);
  });
});
