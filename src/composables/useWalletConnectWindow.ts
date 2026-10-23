import { onBeforeUnmount, ref, type Ref } from 'vue';

import type { WalletAuthorizationResult } from '@/composables/useWalletAuthorization';
import {
  listenForWalletConnectOutcome,
  type WalletConnectOutcome,
} from '@/services/wallet-connect-channel';
import type { WalletProviderId } from '@/types/wallet-provider';
import { openNip47Authorization } from '@/services/nip47-service';

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
  /**
   * Whether the background opens the wallet's popup itself rather than a connect window doing it.
   * Defaults to Firefox, where a popup a Porwr page opens loses its opener (workspace#85).
   */
  backgroundPopup?: boolean;
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

/**
 * Firefox replaces the browsing context of a window an extension page opens once it loads a web
 * page, which severs `window.opener` and leaves the extension holding a dead object (Mozilla bugs
 * 1947632, 1966088). Told apart by the extension's own URL scheme rather than the user agent.
 */
export function opensWalletPopupInBackground(): boolean {
  try {
    return chrome.runtime.getURL('').startsWith('moz-extension:');
  } catch {
    return false;
  }
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
 *
 * Firefox is different: a popup an extension page opens loses its opener there, so the wallet's
 * message could never arrive. In Firefox the background opens the wallet's popup itself, Porwr's
 * content script relays the wallet's answer, and the background posts the outcome over the same
 * channel (workspace#85). There is no opener, so no connect window is needed.
 */
export function useWalletConnectWindow(
  options: WalletConnectWindowOptions = {},
): UseWalletConnectWindowResult {
  const connecting = ref<WalletProviderId | null>(null);
  const timeoutMs = options.timeoutMs ?? 11 * 60 * 1000;
  const backgroundPopup = options.backgroundPopup ?? opensWalletPopupInBackground();
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

          const fail = (error: unknown): void => {
            stopListening();
            chrome.windows.onRemoved.removeListener(onRemoved);
            clearTimeout(timeout);
            cancelPending = null;
            reject(error instanceof Error ? error : new Error(String(error)));
          };

          if (backgroundPopup) {
            // The background opens the wallet itself and posts the outcome, including when the
            // user closes the wallet's window (workspace#85).
            openNip47Authorization({
              accountPubkey,
              provider,
              requestId,
              ...(customOrigin?.trim() ? { customOrigin: customOrigin.trim() } : {}),
            }).catch(fail);
            return;
          }

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
            .catch(fail);
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
