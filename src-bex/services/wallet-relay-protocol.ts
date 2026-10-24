/**
 * The messages between the background and Porwr's content script on a wallet's approval page
 * (workspace#85). See `wallet-connect-popup.ts` for the background and `../wallet-relay.ts` for the
 * content script.
 */

/** The port the content script relays the wallet's `nwc:success` details over. */
export const WALLET_RELAY_PORT_NAME = 'porwr:wallet-relay';

/** Sent by the background, and only to the tab it opened for a pending wallet authorization. */
export const WALLET_RELAY_ARM = 'porwr:wallet-relay.arm';

export interface WalletRelayArmMessage {
  type: typeof WALLET_RELAY_ARM;
}

export function isWalletRelayArmMessage(message: unknown): message is WalletRelayArmMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as Record<string, unknown>).type === WALLET_RELAY_ARM
  );
}
