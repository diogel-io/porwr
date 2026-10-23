import { findPendingNip47AuthorizationByPopup } from './nip47-pending-authorization-store';
import { WALLET_RELAY_ARM } from './wallet-relay-protocol';

/**
 * Tells the content script in a bound popup tab to watch for the wallet's result. Also called right
 * after the popup is bound, in case its page finished loading first.
 */
export async function armWalletRelay(tabId: number): Promise<void> {
  if (!(await findPendingNip47AuthorizationByPopup({ tabId }))) {
    return;
  }
  try {
    await chrome.tabs.sendMessage(tabId, { type: WALLET_RELAY_ARM }, { frameId: 0 });
  } catch {
    // No content script there yet, or none at all (Firefox before 127 without host access). The
    // popup closing still settles the authorization.
  }
}
