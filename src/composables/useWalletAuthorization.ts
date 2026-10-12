import { ref, type Ref } from 'vue';

import { parseAuthorizationMessage } from '@/services/nip47-authorization';
import {
  beginNip47Authorization,
  completeNip47Authorization,
  probeNip47Authorization,
} from '@/services/nip47-service';
import type { Nip47AuthorizedWalletService, Nip47ConnectionSummary } from '@/types/nip47';
import type { WalletProviderId } from '@/types/wallet-provider';

export type WalletAuthorizationResult =
  | { status: 'connected'; connection: Nip47ConnectionSummary }
  /** The popup closed and the wallet did not confirm the connection. */
  | { status: 'no-response' }
  | { status: 'popup-blocked' };

export interface WalletAuthorizationOptions {
  /** The window that opens the popup and receives its message. Defaults to `window`. */
  host?: Window;
  /** How often to check whether the user closed the popup. */
  pollIntervalMs?: number;
  /** How long to wait for the user before giving up. Matches the background's pending expiry. */
  timeoutMs?: number;
}

export interface UseWalletAuthorizationResult {
  /** The provider being connected, or `null` when no connection is in progress. */
  connecting: Ref<WalletProviderId | null>;
  connect: (provider: WalletProviderId, customOrigin?: string) => Promise<WalletAuthorizationResult>;
}

const POPUP_FEATURES = 'popup,width=420,height=680';

type PopupOutcome = { kind: 'message'; service: Nip47AuthorizedWalletService } | { kind: 'closed' };

function waitForPopup(
  host: Window,
  popup: Window,
  origin: string,
  pollIntervalMs: number,
  timeoutMs: number,
): Promise<PopupOutcome> {
  return new Promise((resolve) => {
    const finish = (outcome: PopupOutcome): void => {
      host.removeEventListener('message', onMessage);
      clearInterval(poll);
      clearTimeout(timeout);
      resolve(outcome);
    };

    const onMessage = (event: MessageEvent): void => {
      if (event.source !== popup) {
        return;
      }
      const service = parseAuthorizationMessage(event.origin, event.data, origin);
      if (service) {
        finish({ kind: 'message', service });
      }
    };

    const poll = setInterval(() => {
      if (popup.closed) {
        finish({ kind: 'closed' });
      }
    }, pollIntervalMs);
    const timeout = setTimeout(() => finish({ kind: 'closed' }), timeoutMs);

    host.addEventListener('message', onMessage);
  });
}

/**
 * Connects a wallet by having the user approve Porwr in the wallet's own page (#110).
 *
 * The background creates the client secret and returns only its public key. This opens the wallet's
 * `/apps/new` page in a popup and waits for its `nwc:success` message, which carries only public
 * values. If the popup closes without one, the background checks with the wallet directly where it
 * can (Coinos), so a lost message does not lose an approved connection.
 *
 * Call `connect` from a click handler in a full-tab page: the popup is opened before anything is
 * awaited so the click still counts as the user gesture browsers require.
 */
export function useWalletAuthorization(options: WalletAuthorizationOptions = {}): UseWalletAuthorizationResult {
  const connecting = ref<WalletProviderId | null>(null);
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;

  const connect = async (
    provider: WalletProviderId,
    customOrigin?: string,
  ): Promise<WalletAuthorizationResult> => {
    const host = options.host ?? window;
    // No `noopener`: the wallet posts its result to `window.opener`.
    const popup = host.open('about:blank', 'porwr-wallet-connect', POPUP_FEATURES);
    if (!popup) {
      return { status: 'popup-blocked' };
    }

    connecting.value = provider;
    try {
      const start = await beginNip47Authorization({
        provider,
        ...(customOrigin?.trim() ? { customOrigin: customOrigin.trim() } : {}),
      });
      popup.location.href = start.authorizationUrl;

      const outcome = await waitForPopup(host, popup, start.origin, pollIntervalMs, timeoutMs);
      if (!popup.closed) {
        popup.close();
      }

      if (outcome.kind === 'message') {
        const connection = await completeNip47Authorization({ pendingId: start.pendingId, ...outcome.service });
        return { status: 'connected', connection };
      }

      const connection = await probeNip47Authorization(start.pendingId);
      return connection ? { status: 'connected', connection } : { status: 'no-response' };
    } catch (error: unknown) {
      if (!popup.closed) {
        popup.close();
      }
      throw error;
    } finally {
      connecting.value = null;
    }
  };

  return { connecting, connect };
}
