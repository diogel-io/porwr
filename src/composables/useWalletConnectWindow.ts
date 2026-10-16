import { onBeforeUnmount, ref, type Ref } from 'vue';

import type { WalletAuthorizationResult } from '@/composables/useWalletAuthorization';
import {
  listenForWalletConnectOutcome,
  type WalletConnectOutcome,
} from '@/services/wallet-connect-channel';
import type { WalletProviderId } from '@/types/wallet-provider';

export type WalletConnectWindowResult =
  | WalletAuthorizationResult
  /** The user closed the connect window, or it never reported back. */
  | { status: 'cancelled' };

export interface WalletConnectWindowOptions {
  /**
   * How long to wait for the connect window before giving up. Longer than the window's own
   * 10-minute wait, so its probe fallback has time to finish and report.
   */
  timeoutMs?: number;
}

export interface UseWalletConnectWindowResult {
  /** The provider being connected, or `null` when no connection is in progress. */
  connecting: Ref<WalletProviderId | null>;
  /** Connects a wallet for `accountPubkey`, the account the connection will belong to (#304). */
  connect: (
    provider: WalletProviderId,
    accountPubkey: string,
    customOrigin?: string,
  ) => Promise<WalletConnectWindowResult>;
}

const WINDOW_WIDTH = 420;
const WINDOW_HEIGHT = 680;

/**
 * Connects a wallet from a separate Porwr window rather than from the page holding the user's state
 * (workspace#76).
 *
 * The wallet's popup has to keep `window.opener`, because that is how it posts `nwc:success`. An
 * opener can also be navigated, so whichever page opens the wallet could be replaced with a
 * look-alike. Opening it from a throwaway connect window instead means only that window is
 * exposed. `chrome.windows.create` gives the connect window no opener of its own, so the wallet
 * cannot reach this page through `window.opener.opener` either.
 *
 * The connect window reports how it ended over `wallet-connect-channel`.
 */
export function useWalletConnectWindow(
  options: WalletConnectWindowOptions = {},
): UseWalletConnectWindowResult {
  const connecting = ref<WalletProviderId | null>(null);
  const timeoutMs = options.timeoutMs ?? 11 * 60 * 1000;
  let cancelPending: (() => void) | null = null;

  const connect = async (
    provider: WalletProviderId,
    accountPubkey: string,
    customOrigin?: string,
  ): Promise<WalletConnectWindowResult> => {
    const requestId = crypto.randomUUID();
    // The account's public key, not a secret: the connect window passes it to the background, which
    // fixes the new connection to that account before the wallet's popup opens (#304).
    const query = new URLSearchParams({ provider, request: requestId, account: accountPubkey });
    if (customOrigin?.trim()) {
      query.set('origin', customOrigin.trim());
    }

    connecting.value = provider;
    try {
      const outcome = await new Promise<WalletConnectOutcome | { status: 'cancelled' }>(
        (resolve, reject) => {
          let windowId: number | undefined;

          const finish = (result: WalletConnectOutcome | { status: 'cancelled' }): void => {
            stopListening();
            chrome.windows.onRemoved.removeListener(onRemoved);
            clearTimeout(timeout);
            cancelPending = null;
            resolve(result);
          };
          const onRemoved = (removedId: number): void => {
            if (removedId === windowId) {
              finish({ status: 'cancelled' });
            }
          };

          // Listen before the window exists, so even an instant outcome is not missed.
          const stopListening = listenForWalletConnectOutcome(requestId, finish);
          chrome.windows.onRemoved.addListener(onRemoved);
          const timeout = setTimeout(() => finish({ status: 'cancelled' }), timeoutMs);
          cancelPending = () => finish({ status: 'cancelled' });

          chrome.windows
            .create({
              url: chrome.runtime.getURL(`www/index.html#/wallet-connect?${query.toString()}`),
              type: 'popup',
              width: WINDOW_WIDTH,
              height: WINDOW_HEIGHT,
            })
            .then((created) => {
              windowId = created?.id;
            })
            .catch((error: unknown) => {
              stopListening();
              chrome.windows.onRemoved.removeListener(onRemoved);
              clearTimeout(timeout);
              cancelPending = null;
              reject(error instanceof Error ? error : new Error(String(error)));
            });
        },
      );

      if (outcome.status === 'error') {
        throw new Error(outcome.message);
      }
      return outcome;
    } finally {
      connecting.value = null;
    }
  };

  onBeforeUnmount(() => cancelPending?.());

  return { connecting, connect };
}
