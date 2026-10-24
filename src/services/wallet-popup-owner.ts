/**
 * Whether the background, rather than a Porwr page, opens a wallet's approval popup (workspace#85).
 *
 * Firefox replaces the browsing context of a window an extension page opens once it loads a web
 * page, which severs `window.opener` and leaves the extension holding a dead object (Mozilla bugs
 * 1947632, 1966088). Told apart by the extension's own URL scheme rather than the user agent.
 *
 * Shared by Wallet Connections and the background, so it depends on nothing but `chrome.runtime`.
 */
export function opensWalletPopupInBackground(): boolean {
  try {
    return chrome.runtime.getURL('').startsWith('moz-extension:');
  } catch {
    return false;
  }
}
