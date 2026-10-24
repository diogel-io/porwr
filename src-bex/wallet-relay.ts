import { isWalletRelayArmMessage, WALLET_RELAY_PORT_NAME } from './services/wallet-relay-protocol';

/**
 * Relays a wallet's `nwc:success` from its approval page to the background (workspace#85).
 *
 * In Firefox the wallet popup has no `window.opener`, so the wallet's own way of answering reaches
 * nobody. This content script listens instead, but only in the one tab the background opened for a
 * pending authorization and armed (`wallet-relay-arm.ts`). Every other page is left alone.
 *
 * - Alby Hub dispatches a `nwc:success` `CustomEvent` on its own window, which is read directly.
 * - Coinos only calls `window.opener.postMessage`. A stand-in opener is placed in the page, whose
 *   `postMessage` forwards a `nwc:success` and nothing else. It uses Firefox's `exportFunction`, so
 *   it works from Firefox 115 without a MAIN-world script, and is skipped where a real opener exists.
 *
 * Only the public connection details cross over. The background decides whether they count, from
 * the browser-supplied sender, and checks them with the wallet before saving anything.
 */

interface RelayedSuccess {
  type: 'nwc:success';
  walletPubkey: string;
  relayUrls: string[];
  lud16?: string;
}

// Firefox content-script globals for sharing objects and functions with the page.
declare const exportFunction:
  | ((fn: (...args: unknown[]) => unknown, target: object, options: { defineAs: string }) => void)
  | undefined;
declare const cloneInto: ((value: object, target: object) => object) | undefined;

type MaybeWaived = { wrappedJSObject?: unknown };

/**
 * A page object as the content script can read it. Firefox hides a page object's properties behind
 * an Xray wrapper in some cases; reading through `wrappedJSObject` sees what the page set. Only
 * strings are copied out, so nothing the page controls is kept beyond them.
 */
function pageValue(value: unknown): unknown {
  try {
    const waived = (value as MaybeWaived | null)?.wrappedJSObject;
    return waived ?? value;
  } catch {
    return value;
  }
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  try {
    const value = record[key];
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

function readStrings(value: unknown): string[] {
  const list = pageValue(value);
  if (!Array.isArray(list)) {
    return [];
  }
  const strings: string[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const item: unknown = list[index];
    if (typeof item === 'string') {
      strings.push(item);
    }
  }
  return strings;
}

/**
 * @returns The `nwc:success` details as plain values, or `null` when `data` is not one.
 */
export function readWalletSuccess(data: unknown, assumeSuccess = false): RelayedSuccess | null {
  const raw = pageValue(data);
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (!assumeSuccess && readString(record, 'type') !== 'nwc:success') {
    return null;
  }
  const walletPubkey = readString(record, 'walletPubkey');
  if (!walletPubkey) {
    return null;
  }
  let relayUrls: string[] = [];
  try {
    relayUrls = readStrings(record.relayUrls);
  } catch {
    relayUrls = [];
  }
  const relayUrl = readString(record, 'relayUrl');
  if (relayUrls.length === 0 && relayUrl) {
    relayUrls = [relayUrl];
  }
  const lud16 = readString(record, 'lud16');
  return { type: 'nwc:success', walletPubkey, relayUrls, ...(lud16 ? { lud16 } : {}) };
}

function readEventDetail(event: Event): unknown {
  try {
    const waived = (event as Event & MaybeWaived).wrappedJSObject as CustomEvent | undefined;
    return waived?.detail ?? (event as CustomEvent).detail;
  } catch {
    return null;
  }
}

/**
 * Installs the relay. It forwards nothing until the background arms this tab.
 *
 * The `nwc:success` event is listened for from the start and the latest one kept, because the arm
 * message can arrive after the page has answered: the background's first attempt may come before
 * this script exists, and the next only once the tab reports `complete`. What was kept is forwarded
 * when the tab is armed, and never otherwise. The opener stand-in, which changes what the page
 * sees, is placed only once armed.
 */
export function installWalletRelay(): void {
  let armed = false;
  let relayed = false;
  let heard: RelayedSuccess | null = null;

  const relay = (success: RelayedSuccess | null): void => {
    if (relayed || !success) {
      return;
    }
    relayed = true;
    const port = chrome.runtime.connect({ name: WALLET_RELAY_PORT_NAME });
    port.postMessage(success);
  };

  window.addEventListener('nwc:success', (event) => {
    const success = readWalletSuccess(readEventDetail(event), true);
    if (armed) {
      relay(success);
    } else if (success) {
      heard = success;
    }
  });

  const arm = (): void => {
    if (armed) {
      return;
    }
    armed = true;
    relay(heard);
    installOpenerStandIn((data) => relay(readWalletSuccess(data)));
  };

  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    // Only the background can arm a tab: a message from another content script or page would
    // carry `sender.tab`.
    if (sender.id === chrome.runtime.id && !sender.tab && isWalletRelayArmMessage(message)) {
      arm();
    }
    return undefined;
  });
}

function installOpenerStandIn(forward: (data: unknown) => void): void {
  if (typeof exportFunction !== 'function' || typeof cloneInto !== 'function') {
    return;
  }
  if (window.opener) {
    return;
  }
  const page = (window as Window & MaybeWaived).wrappedJSObject as
    (Window & Record<string, unknown>) | undefined;
  if (!page) {
    return;
  }
  const standIn = cloneInto({}, window);
  exportFunction(
    (data: unknown) => {
      forward(data);
    },
    standIn,
    { defineAs: 'postMessage' },
  );
  page.opener = standIn as Window;
}
