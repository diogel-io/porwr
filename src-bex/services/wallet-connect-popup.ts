import {
  handleNip47AuthorizationPopupClosed,
  handleNip47AuthorizationRelay,
} from '../handlers/nip47';
import { armWalletRelay } from './wallet-relay-arm';
import { WALLET_RELAY_PORT_NAME } from './wallet-relay-protocol';
import { describeError, LogLevel, logService } from '@/services/log-service';

/**
 * The background's side of a wallet popup it opened itself (workspace#85).
 *
 * - When the popup's tab finishes loading a page, Porwr's content script in that tab, and only
 *   there, is told to watch for the wallet's `nwc:success`.
 * - The content script relays what it saw over a `porwr:wallet-relay` port. The browser-supplied
 *   sender decides whether it counts (`handleNip47AuthorizationRelay`).
 * - When the popup's window closes first, the authorization is settled without it
 *   (`handleNip47AuthorizationPopupClosed`).
 *
 * The general runtime channel still refuses content scripts (#240); this port carries one message
 * and nothing else.
 */
export function observeWalletConnectPopups(extensionId: string): void {
  chrome.windows?.onRemoved?.addListener((windowId) => {
    void handleNip47AuthorizationPopupClosed(windowId).catch(logFailure);
  });

  chrome.tabs?.onUpdated?.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete') {
      void armWalletRelay(tabId);
    }
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== WALLET_RELAY_PORT_NAME) return;
    serveWalletRelayPort(port, extensionId);
  });
}

function serveWalletRelayPort(port: chrome.runtime.Port, extensionId: string): void {
  const sender = port.sender;
  const tabId = sender?.tab?.id;
  if (
    sender?.id !== extensionId ||
    typeof tabId !== 'number' ||
    typeof sender.frameId !== 'number' ||
    typeof sender.url !== 'string'
  ) {
    port.disconnect();
    return;
  }
  const { frameId, url } = sender;

  const onMessage = (message: unknown): void => {
    port.onMessage.removeListener(onMessage);
    void handleNip47AuthorizationRelay({ tabId, frameId, url }, message)
      .catch(logFailure)
      .finally(() => port.disconnect());
  };
  port.onMessage.addListener(onMessage);
}

function logFailure(error: unknown): void {
  logService.log(LogLevel.WARN, '[NIP-47] Wallet popup authorization failed', {
    error: describeError(error),
  });
}
