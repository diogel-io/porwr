import type { WalletAuthorizationResult } from '@/composables/useWalletAuthorization';

/**
 * How the wallet connect window tells Wallet Connections how a connection ended (workspace#76).
 *
 * The two are separate windows with no opener between them, by design, so they talk over a
 * `BroadcastChannel`. Only Porwr's own pages share its origin, so a wallet page can neither post to
 * nor listen on it. It carries the same public summary `useWalletAuthorization` returns, never a
 * secret.
 */
export const WALLET_CONNECT_CHANNEL = 'porwr:wallet-connect';

export type WalletConnectOutcome = WalletAuthorizationResult | { status: 'error'; message: string };

export interface WalletConnectOutcomeMessage {
  /** Ties the outcome to the one connect window Wallet Connections opened. */
  requestId: string;
  outcome: WalletConnectOutcome;
}

const OUTCOME_STATUSES: readonly string[] = ['connected', 'no-response', 'popup-blocked', 'error'];

function isOutcomeMessage(data: unknown): data is WalletConnectOutcomeMessage {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const { requestId, outcome } = data as Record<string, unknown>;
  return (
    typeof requestId === 'string' &&
    typeof outcome === 'object' &&
    outcome !== null &&
    OUTCOME_STATUSES.includes(String((outcome as Record<string, unknown>).status))
  );
}

export function postWalletConnectOutcome(requestId: string, outcome: WalletConnectOutcome): void {
  const channel = new BroadcastChannel(WALLET_CONNECT_CHANNEL);
  const message: WalletConnectOutcomeMessage = { requestId, outcome };
  channel.postMessage(message);
  channel.close();
}

/**
 * Calls `onOutcome` once, for the first outcome posted for `requestId`.
 *
 * @returns A function that stops listening.
 */
export function listenForWalletConnectOutcome(
  requestId: string,
  onOutcome: (outcome: WalletConnectOutcome) => void,
): () => void {
  const channel = new BroadcastChannel(WALLET_CONNECT_CHANNEL);
  const stop = (): void => {
    channel.removeEventListener('message', onMessage);
    channel.close();
  };
  const onMessage = (event: MessageEvent): void => {
    if (isOutcomeMessage(event.data) && event.data.requestId === requestId) {
      stop();
      onOutcome(event.data.outcome);
    }
  };
  channel.addEventListener('message', onMessage);
  return stop;
}
