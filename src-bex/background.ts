/**
 * Importing the file below initializes the extension background.
 *
 * Warnings:
 * 1. Do NOT remove the import statement below. It is required for the extension to work.
 *    If you don't need create Bridge(), leave it as "import '#q-app/bex/background'".
 * 2. Do NOT import this file in multiple background scripts. Only in one!
 * 3. Import it in your background service worker (if available for your target browser).
 */
import { createBridge } from '#q-app/bex/background';
import { describeError, LogLevel, logService } from '@/services/log-service';
import { FALLBACK_RELAYS, NOSTR_ACTIVE, storageService } from '@/services/storage-service';
import {
  checkAutoLock,
  isAutoLockOverdue,
  restoreLastActivity,
  startAutoLockTimer,
} from './services/auto-lock';
import { initializePanelSurface, resolvePanelSurface } from './services/panel-surface';
import {
  pruneResolvedRequests,
  onQueueChange,
  reconcileInterruptedRequests,
} from './services/request-queue';
import {
  notifyPanelsOfQueueChange,
  observePanelConnections,
  reconcilePanelPresence,
} from './services/panel-presence';
import { refreshAttention } from './services/attention-badge';
import {
  identifyWaitingRequests,
  requestApproval,
  requestApprovalDecision,
  trimApprovalContentDescription,
} from './services/approval-flow';
import type { ApprovalRequestDetails } from './services/approval-flow';
import { listAccounts } from './services/signing-account';
import { sweepSiteStateForRemovedAccounts } from './services/connected-sites';
import { decideRouting, type RawMessage } from './services/message-routing';
import { classifySender, originOf } from './services/sender-policy';
import { observePageRequests, type PageActionHandlers } from './services/page-channel';
import { observeWalletConnectPopups } from './services/wallet-connect-popup';
import { lockDownSessionStorage } from './services/session-storage-lock';
import { migrateProtectedStorage } from './services/protected-storage-migration';
import { isSignableEventKind, MAX_EVENT_KIND } from './services/event-kind';
import { INVALID_PUBKEY_MESSAGE, isHexPubkey } from './services/pubkey';
import { reconcileAbandonedRequests } from './services/page-reconciliation';
import {
  observePageConnections,
  onPageOriginChange,
  restorePageOrigins,
} from './services/page-origin-registry';
import type {
  BridgeAction,
  BridgeRequestMap,
  BridgeResponsePayload,
  BridgeError,
  StoredKey,
} from '@/types/bridge';
import {
  handleVaultIsUnlocked,
  handleVaultGetData,
  restoreVaultState,
} from './handlers/vault-handler';
import { onVaultUnlocked } from './vault';
import { refreshActiveAccountContacts } from './handlers/contacts';
import {} from './handlers/permission-handler';
import { handleGetPublicKey, handleSignEvent } from './handlers/nip07';
import { handleWebLnEnable } from './handlers/webln';
import { loadSeedRelays } from '@/services/relay-catalog';
import { parseBolt11AmountMsat, previewInvoice } from '@/services/nip47-invoice';
import { dispatchMessage } from './dispatcher';
import { createBridgeRequest } from '@/types/bridge';

class BackgroundBridgeError extends Error implements BridgeError {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BackgroundBridgeError';
    this.code = code;
  }
}

/** Refuses a malformed counterparty before a request is queued, as `signEvent` does a bad kind. */
function requireCounterpartyPubkey(pubkey: unknown): void {
  if (!isHexPubkey(pubkey))
    throw new BackgroundBridgeError('INVALID_PUBKEY', INVALID_PUBKEY_MESSAGE);
}

async function getActiveAlias(): Promise<string | null> {
  return (await storageService.get<string>(NOSTR_ACTIVE)) ?? null;
}

/**
 * The active account, choosing the first one as active when none is set yet.
 *
 * The page action handlers call it before asking for approval for that side effect alone:
 * `resolveSigningAccount` has no fallback of its own, so a vault whose active account was never set
 * would otherwise refuse every request.
 */
async function getActiveStoredKey(): Promise<StoredKey | null> {
  const isUnlockedResult = await handleVaultIsUnlocked({}, '');
  if (!isUnlockedResult.success || !isUnlockedResult.data) {
    return null;
  }
  const activeAlias = await getActiveAlias();

  if (!activeAlias) {
    const vaultDataRes = await handleVaultGetData({}, '');
    if (vaultDataRes.success && vaultDataRes.data.vaultData) {
      const vaultData = vaultDataRes.data.vaultData;
      const accounts = vaultData.accounts || [];
      if (accounts.length > 0) {
        const fallbackAccount = accounts[0];
        if (fallbackAccount) {
          await storageService.set(NOSTR_ACTIVE, fallbackAccount.alias);
          return fallbackAccount;
        }
      }
    }
    return null;
  }

  const vaultRes = await handleVaultGetData({}, '');
  if (!vaultRes.success || !vaultRes.data.vaultData) {
    return null;
  }

  const vaultData = vaultRes.data.vaultData;
  return (vaultData.accounts || []).find((acc) => acc.alias === activeAlias) || null;
}

type BexBridge = ReturnType<typeof createBridge>;

const bridgeHost = globalThis as typeof globalThis & {
  bridge?: BexBridge;
  $q?: { bex?: BexBridge };
};

let bridge: BexBridge;
try {
  bridge = createBridge({ debug: false });
  bridgeHost.bridge = bridge;
  if (bridgeHost.$q) {
    bridgeHost.$q.bex = bridge;
  }
} catch (error: unknown) {
  logService.log(LogLevel.ERROR, '[BEX] Failed to create bridge', {
    error: error instanceof Error ? error.message : String(error),
  });
  throw error;
}

bridge.on('ping', async (): Promise<BridgeResponsePayload<'ping'>> => {
  const result = await dispatchMessage('ping', createBridgeRequest('ping', {}), '');
  return result || 'pong';
});

if (typeof self !== 'undefined') {
  self.addEventListener('error', (event: ErrorEvent) => {
    void (async () => {
      const activeAlias = await getActiveAlias();
      await logService.logException('Unhandled error', event.error, activeAlias, 'background');
    })();
  });

  self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    void (async () => {
      const activeAlias = await getActiveAlias();
      await logService.logException('Unhandled rejection', event.reason, activeAlias, 'background');
    })();
  });
}

// Only `ping` is registered on the Quasar bridge. Its `content@…` ports still accept a connection
// from any content script, which runs in a website's renderer and is untrusted (#240), and a bridge
// handler cannot tell which port a message came from. So page actions use Porwr's own port instead
// (`services/page-channel.ts`, #246), and vault, queue, site, wallet, messaging and other
// extension-surface actions are reachable only from Porwr's own pages, through the raw
// `chrome.runtime.onMessage` listener, which checks the sender.

// Session storage is locked down first, before anything reads or writes it
// (`services/session-storage-lock.ts`).
async function initialize(): Promise<void> {
  try {
    await lockDownSessionStorage();
    // Before anything reads grants, bindings or auto-lock state: they now live where content
    // scripts cannot reach them, and the old copies are deleted (#140).
    await migrateProtectedStorage().catch((error: unknown) => {
      logService.log(
        LogLevel.ERROR,
        `[BEX] Failed to migrate protected storage: ${describeError(error)}`,
      );
    });
    // Bound history kept before the retention caps existed, or by a table that gets no new rows.
    void logService.enforceRetention().catch((error: unknown) => {
      logService.log(
        LogLevel.ERROR,
        `[BEX] Failed to enforce log retention: ${describeError(error)}`,
      );
    });
    await restoreLastActivity();
    const restored = await restoreVaultState(isAutoLockOverdue);
    if (restored) {
      startAutoLockTimer();
      await checkAutoLock();
      // A restarted worker with the vault still unlocked: fill the contact cache now (#257).
      void refreshActiveAccountContacts();
    }
    void loadSeedRelays().catch((error: unknown) => {
      logService.log(LogLevel.ERROR, '[BEX] Failed to seed relay catalog', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    await initializePanelSurface();
    await restorePageOrigins();
    // A restarted worker has lost every live callback, so anything still pending is interrupted
    // and can never be approved (ADR D7).
    await reconcileInterruptedRequests();
    await pruneResolvedRequests();
    // The toolbar is the only signal while the panel is closed, so it must be right from the
    // first moment a restarted worker is running (D4).
    await refreshAttention();
  } catch (error: unknown) {
    logService.log(LogLevel.ERROR, '[BEX] Initialization error:', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Kept so work an event can wake the background for waits until start-up is done (workspace#85).
const initialized = initialize();

// Keep the active account's contacts cached, so Contacts and Messaging open with them (#257). Unlock
// skips a cache that is still fresh; nothing is refreshed while the vault is locked.
onVaultUnlocked(() => {
  void refreshActiveAccountContacts();
});

// Grants and bindings for an account removed before removal cleaned them up are swept once the
// vault can say which accounts exist (#139).
onVaultUnlocked(() => {
  void listAccounts()
    .then((accounts) => sweepSiteStateForRemovedAccounts(accounts.map((account) => account.id)))
    .catch((error: unknown) => {
      logService.log(LogLevel.ERROR, `[BEX] Failed to sweep site state: ${describeError(error)}`);
    });
});

// A request that arrived while the vault was locked was queued without an account. Name it now, so
// the panel shows who is signing before the user decides (porwr#320).
onVaultUnlocked(() => {
  void identifyWaitingRequests().catch((error: unknown) => {
    logService.log(LogLevel.ERROR, '[BEX] Failed to name the account on waiting requests', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
});
storageService.onChanged((changes, areaName) => {
  if (areaName !== 'local') return;
  // Choosing an account, or new relays to read from, is a deliberate act: ask relays now, however
  // recently the cache was filled. Refreshes already running for that account are shared.
  if (FALLBACK_RELAYS in changes || NOSTR_ACTIVE in changes) {
    void refreshActiveAccountContacts({ force: true });
  }
});

// Registered at top level, not inside initialize(): a restarted worker must be watching before the
// first content script or panel reconnects, or it misses them and never learns they are there.
observePageConnections();
observePanelConnections();

// Every queue write mirrors onto the toolbar. Expiry is evaluated lazily on read, so a request can
// leave the queue with no caller involved; watching the write is the only way to catch that.
onQueueChange(() => {
  void refreshAttention();
  // The same write that moves the toolbar tells any open panel to re-read (#140). Expiry is
  // evaluated lazily, so this is also how a request leaving the queue with no caller involved
  // reaches the panel.
  notifyPanelsOfQueueChange();
});

/**
 * A page that has gone cannot be signed for.
 *
 * The content script's port dies on navigation, tab close, window close and crash, which is what
 * the page origin registry reports here. Requests name an origin and not a tab, so this waits
 * until no tab holds the origin at all before interrupting anything (D7).
 */
onPageOriginChange((_tabId, record) => {
  // Only a page going away can strand a request; one arriving cannot.
  if (record) return;

  void reconcileAbandonedRequests();
});

// A closed window takes its tabs with it; ports usually report that first, but not always.
chrome.windows?.onRemoved?.addListener((windowId) => {
  void refreshAttention();
  // Firefox can say whether a panel is still open in a window; Chromium cannot and abstains. This
  // catches a panel that went away without its port disconnecting (#113).
  void reconcilePanelPresence(windowId);
});

// Chromium reveals the panel through `openPanelOnActionClick`, so `action.onClicked` never
// fires there. Firefox has no equivalent, so the click is the user gesture that toggles the
// sidebar. Opening the panel is only ever attempted from inside this handler (ADR D4).
chrome.action?.onClicked?.addListener((tab) => {
  const surface = resolvePanelSurface();
  if (surface.kind !== 'firefox') return;

  void surface.openFromUserGesture(tab.windowId).catch((error: unknown) => {
    logService.log(LogLevel.ERROR, '[Panel] Failed to open panel from toolbar action', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
});

// The channel Porwr's own pages use. The browser fills in `sender`, so it — not anything in the
// payload — decides whether the message came from an extension page. Content scripts, which run in
// a website's renderer, and anything else are refused before dispatch (#240).
const EXTENSION_ORIGIN = originOf(chrome.runtime.getURL(''));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const decision = decideRouting(
    message as RawMessage,
    classifySender(sender, chrome.runtime.id, EXTENSION_ORIGIN),
  );

  if (!decision.dispatch) {
    sendResponse({ success: false, error: decision.error });
    return true;
  }

  // The untyped boundary. A raw runtime message is whatever the sender put on the wire, so the
  // payload is asserted into the dispatcher's shape here and nowhere deeper — the dispatcher's
  // switch is what actually decides whether the action is one we serve.
  void dispatchMessage(
    decision.type as BridgeAction,
    decision.payload as BridgeRequestMap[BridgeAction],
    decision.origin,
  )
    .then((response) => {
      /*
       * `undefined` means the dispatcher serves no such action, and staying silent is right —
       * the behaviour this listener has had since it replaced a chain of `message.type ===`
       * branches that simply fell through.
       *
       * `null` is an answer. The queue is empty, the tab has no known origin, the request carries
       * no content. Withholding those left the caller holding a promise that never settled: the
       * panel kept showing a request the user had already approved, because the read that would
       * have cleared it never came back (#195).
       */
      if (response !== undefined) {
        sendResponse(response);
      }
    })
    .catch((error: unknown) => {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  return true;
});

/**
 * A WebLN failure rejects the site's promise rather than resolving it (porwr#370).
 *
 * The dispatcher answers Porwr's own pages with `{ success: false, error }` as a value. Returned to
 * a site, that resolved `sendPayment()` for a payment that was never made. The error is already one
 * of the fixed messages the WebLN handlers give, never a wallet's or relay's own text.
 */
function rejectWebLnFailure<T>(result: T): T {
  if (
    result !== null &&
    typeof result === 'object' &&
    'success' in result &&
    (result as { success: unknown }).success === false
  ) {
    const error = (result as { error?: unknown }).error;
    throw new BackgroundBridgeError(
      'WEBLN_UNAVAILABLE',
      typeof error === 'string' ? error : 'WebLN request failed',
    );
  }
  return result;
}

// The actions a website may ask for. They arrive over the page channel, which hands each one the
// requesting site as the browser reports it, from the content script's port, never from anything the
// page or the content script wrote (#246).
const pageActionHandlers: PageActionHandlers = {
  'nostr.getPublicKey': async (_payload, origin, page) => {
    const toBridgeError = (error: string): BackgroundBridgeError =>
      new BackgroundBridgeError(error === 'Vault is locked' ? 'VAULT_LOCKED' : 'NOT_FOUND', error);

    // Refuse at once if no account could answer, rather than queueing a request nobody can approve.
    const available = await handleGetPublicKey({}, origin);
    if (!available.success) throw toBridgeError(available.error);

    await getActiveStoredKey();
    const approved = await requestApproval(origin, -1, {
      requestType: 'get_public_key',
      signal: page.signal,
    });
    if (!approved) {
      throw new BackgroundBridgeError('PERMISSION_DENIED', 'User rejected the request');
    }

    // Read again after approval: that is when the site was bound, and the key it is given must be
    // the account it is now bound to (#139).
    const result = await handleGetPublicKey({}, origin);
    if (!result.success) throw toBridgeError(result.error);
    return result.data;
  },

  'nostr.signEvent': async ({ event }, origin, page) => {
    if (!isSignableEventKind(event?.kind)) {
      throw new BackgroundBridgeError(
        'INVALID_EVENT',
        `Event kind must be a whole number from 0 to ${MAX_EVENT_KIND}`,
      );
    }
    await getActiveStoredKey();
    const contentDescription = trimApprovalContentDescription(event.content);
    const approvalDetails: ApprovalRequestDetails = contentDescription
      ? { requestType: 'sign_event', contentDescription, event }
      : { requestType: 'sign_event', event };
    const approved = await requestApproval(origin, event.kind, {
      ...approvalDetails,
      signal: page.signal,
    });
    if (!approved) {
      const unlockedStatus = await handleVaultIsUnlocked({}, '');
      if (!unlockedStatus.success || !unlockedStatus.data) {
        throw new BackgroundBridgeError(
          'VAULT_LOCKED',
          'Vault is locked. Open the extension to unlock.',
        );
      }
      throw new BackgroundBridgeError('PERMISSION_DENIED', 'User rejected the request');
    }
    const result = await handleSignEvent({ event }, origin, { skipPermissionCheck: true });
    if (!result.success) {
      throw new BackgroundBridgeError(
        result.error === 'Vault is locked'
          ? 'VAULT_LOCKED'
          : result.error === 'Permission denied'
            ? 'PERMISSION_DENIED'
            : 'SIGNING_FAILED',
        result.error,
      );
    }
    return result.data;
  },

  'nostr.getRelays': async (_payload, origin, page) => {
    await getActiveStoredKey();
    const approved = await requestApproval(origin, -1, {
      requestType: 'get_relays',
      signal: page.signal,
    });
    if (!approved) {
      const unlockedStatus = await handleVaultIsUnlocked({}, '');
      if (!unlockedStatus.success || !unlockedStatus.data)
        throw new Error('Vault is locked. Open the extension to unlock.');
      throw new Error('User rejected the request');
    }
    return (
      (await dispatchMessage(
        'nostr.getRelays',
        createBridgeRequest('nostr.getRelays', { origin }),
        origin,
      )) ?? {}
    );
  },

  'nostr.nip04.encrypt': async (payload, origin, page) => {
    requireCounterpartyPubkey(payload?.pubkey);
    await getActiveStoredKey();
    const approved = await requestApproval(origin, -1, {
      signal: page.signal,
      requestType: 'nip04_encrypt',
      counterpartyPubkey: payload.pubkey,
    });
    if (!approved) {
      const unlockedStatus = await handleVaultIsUnlocked({}, '');
      if (!unlockedStatus.success || !unlockedStatus.data)
        throw new Error('Vault is locked. Open the extension to unlock.');
      throw new Error('User rejected the request');
    }
    return (
      (await dispatchMessage(
        'nostr.nip04.encrypt',
        createBridgeRequest('nostr.nip04.encrypt', { ...payload, origin }),
        origin,
      )) ?? ''
    );
  },

  'nostr.nip04.decrypt': async (payload, origin, page) => {
    requireCounterpartyPubkey(payload?.pubkey);
    await getActiveStoredKey();
    const approved = await requestApproval(origin, -1, {
      signal: page.signal,
      requestType: 'nip04_decrypt',
      counterpartyPubkey: payload.pubkey,
    });
    if (!approved) {
      const unlockedStatus = await handleVaultIsUnlocked({}, '');
      if (!unlockedStatus.success || !unlockedStatus.data)
        throw new Error('Vault is locked. Open the extension to unlock.');
      throw new Error('User rejected the request');
    }
    return (
      (await dispatchMessage(
        'nostr.nip04.decrypt',
        createBridgeRequest('nostr.nip04.decrypt', { ...payload, origin }),
        origin,
      )) ?? ''
    );
  },

  'nostr.nip44.encrypt': async (payload, origin, page) => {
    requireCounterpartyPubkey(payload?.pubkey);
    await getActiveStoredKey();
    const approved = await requestApproval(origin, -1, {
      signal: page.signal,
      requestType: 'nip44_encrypt',
      counterpartyPubkey: payload.pubkey,
    });
    if (!approved) {
      const unlockedStatus = await handleVaultIsUnlocked({}, '');
      if (!unlockedStatus.success || !unlockedStatus.data)
        throw new Error('Vault is locked. Open the extension to unlock.');
      throw new Error('User rejected the request');
    }
    return (
      (await dispatchMessage(
        'nostr.nip44.encrypt',
        createBridgeRequest('nostr.nip44.encrypt', { ...payload, origin }),
        origin,
      )) ?? ''
    );
  },

  'nostr.nip44.decrypt': async (payload, origin, page) => {
    requireCounterpartyPubkey(payload?.pubkey);
    await getActiveStoredKey();
    const approved = await requestApproval(origin, -1, {
      signal: page.signal,
      requestType: 'nip44_decrypt',
      counterpartyPubkey: payload.pubkey,
    });
    if (!approved) {
      const unlockedStatus = await handleVaultIsUnlocked({}, '');
      if (!unlockedStatus.success || !unlockedStatus.data)
        throw new Error('Vault is locked. Open the extension to unlock.');
      throw new Error('User rejected the request');
    }
    return (
      (await dispatchMessage(
        'nostr.nip44.decrypt',
        createBridgeRequest('nostr.nip44.decrypt', { ...payload, origin }),
        origin,
      )) ?? ''
    );
  },

  'webln.enable': async (_payload, origin, page) => {
    const { approved, duration } = await requestApprovalDecision(origin, -1, {
      signal: page.signal,
      requestType: 'webln_enable',
      contentDescription:
        'Allow this site to use Porwr as a WebLN wallet provider. Payments will still require separate approval.',
      allowRemember: true,
      skipPermissionCheck: true,
    });
    if (!approved) {
      throw new BackgroundBridgeError('PERMISSION_DENIED', 'User rejected WebLN access');
    }
    // Called directly rather than through the dispatcher, as `signEvent` calls its handler: the
    // grant for "just this once" lasts while this page is open, so the handler needs its signal,
    // which is not something a bridge payload can carry (porwr#369). The duration comes from the
    // user's decision, never from the site.
    //
    // A failure is thrown, so `webln.enable()` rejects. Returned, it reached the page as a result,
    // and a site with no wallet behind it was told it had been enabled.
    let result: Awaited<ReturnType<typeof handleWebLnEnable>>;
    try {
      result = await handleWebLnEnable(
        createBridgeRequest('webln.enable', { origin, approved: true, duration }),
        page.signal,
      );
    } catch (error: unknown) {
      throw new BackgroundBridgeError(
        'WEBLN_UNAVAILABLE',
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!result.success) throw new BackgroundBridgeError('WEBLN_UNAVAILABLE', result.error);
    return result.data;
  },

  'webln.getInfo': async (_payload, origin) =>
    rejectWebLnFailure(
      await dispatchMessage(
        'webln.getInfo',
        createBridgeRequest('webln.getInfo', { origin }),
        origin,
      ),
    ),

  'webln.sendPayment': async (payload, origin, page) => {
    const amountMsat = parseBolt11AmountMsat(payload.paymentRequest);
    const amountDescription =
      amountMsat !== undefined ? `${amountMsat / 1000} sats` : 'unknown amount';
    const approved = await requestApproval(origin, -1, {
      signal: page.signal,
      requestType: 'webln_send_payment',
      contentDescription: `Pay Lightning invoice for ${amountDescription}: ${previewInvoice(payload.paymentRequest)}`,
      allowRemember: false,
      skipPermissionCheck: true,
    });
    if (!approved) {
      throw new BackgroundBridgeError('PERMISSION_DENIED', 'User rejected the WebLN payment');
    }
    return rejectWebLnFailure(
      await dispatchMessage(
        'webln.sendPayment',
        createBridgeRequest('webln.sendPayment', {
          origin,
          paymentRequest: payload.paymentRequest,
          approved: true,
        }),
        origin,
      ),
    );
  },
};

// Handlers wait for start-up, so a request cannot be queued while the queue is being reconciled.
observePageRequests(pageActionHandlers, chrome.runtime.id, EXTENSION_ORIGIN, initialized);

// Wallet popups the background opened itself, in Firefox (workspace#85).
observeWalletConnectPopups(chrome.runtime.id, initialized);
