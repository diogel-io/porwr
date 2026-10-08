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
import { LogLevel, logService } from '@/services/log-service';
import {
  NOSTR_ACTIVE,
  storageService,
} from '@/services/storage-service';
import {
  startAutoLockTimer,
  resetAutoLockTimer,
  restoreLastActivity,
  checkAutoLock,
} from './services/auto-lock';
import { initializePanelSurface, resolvePanelSurface } from './services/panel-surface';
import {
  getCurrentRequest,
  getPendingCount,
  getRequestContent,
  listPendingRequests,
  markPresented,
  pruneResolvedRequests,
  onQueueChange,
  reconcileInterruptedRequests,
  requeuePresented,
  submitDecision,
} from './services/request-queue';
import {
  notifyPanelsOfQueueChange,
  observePanelConnections,
  reconcilePanelPresence,
} from './services/panel-presence';
import { refreshAttention } from './services/attention-badge';
import { requestApproval, trimApprovalContentDescription } from './services/approval-flow';
import type { ApprovalRequestDetails } from './services/approval-flow';
import { originHostname } from './services/origin';
import { decideRouting, type RawMessage } from './services/message-routing';
import { reconcileAbandonedRequests } from './services/page-reconciliation';
import {
  countSitesHoldingGrantsFor,
  disconnectSite,
  listConnectedSites,
} from './services/connected-sites';
import { getSiteAccount, switchSiteToActiveAccount } from './services/site-account';
import {
  getPageOrigin,
  observePageConnections,
  onPageOriginChange,
  restorePageOrigins,
} from './services/page-origin-registry';
import type { ApprovalDuration } from './types/background';
import type {
  BridgeAction,
  BridgeRequestMap,
  BridgeResponsePayload,
  VaultData,
  GetPublicKeyRequest,
  GetPublicKeyResponse,
  SignEventRequest,
  SignEventResponse,
  BridgeError,
  StoredKey,
} from '@/types/bridge';
import type { SendZapRequest } from '@/types/nip57';
import type { WebLnSendPaymentRequest } from '@/types/webln';
import {
  handleVaultIsUnlocked,
  handleVaultGetData,
  restoreVaultState,
} from './handlers/vault-handler';
import {
} from './handlers/permission-handler';
import {
  handleGetPublicKey,
  handleSignEvent,
} from './handlers/nip07';
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

async function getActiveAlias(): Promise<string | null> {
  return (await storageService.get<string>(NOSTR_ACTIVE)) ?? null;
}

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

declare module '@quasar/app-vite' {
  interface BexEventMap {
    'nostr.getPublicKey': [GetPublicKeyRequest, GetPublicKeyResponse];
    'nostr.signEvent': [SignEventRequest, SignEventResponse];
    'nostr.getRelays': [{ origin: string }, BridgeResponsePayload<'nostr.getRelays'>];
    'nostr.nip04.encrypt': [
      { pubkey: string; plaintext: string; origin: string },
      BridgeResponsePayload<'nostr.nip04.encrypt'>,
    ];
    'nostr.nip04.decrypt': [
      { pubkey: string; ciphertext: string; origin: string },
      BridgeResponsePayload<'nostr.nip04.decrypt'>,
    ];
    'nostr.nip44.encrypt': [
      { pubkey: string; plaintext: string; origin: string },
      BridgeResponsePayload<'nostr.nip44.encrypt'>,
    ];
    'nostr.nip44.decrypt': [
      { pubkey: string; ciphertext: string; origin: string },
      BridgeResponsePayload<'nostr.nip44.decrypt'>,
    ];
    'nostr.requests.list': [undefined, BridgeResponsePayload<'nostr.requests.list'>];
    'nostr.requests.current': [undefined, BridgeResponsePayload<'nostr.requests.current'>];
    'nostr.requests.count': [undefined, BridgeResponsePayload<'nostr.requests.count'>];
    'pages.originForTab': [{ tabId: number }, BridgeResponsePayload<'pages.originForTab'>];
    'sites.list': [undefined, BridgeResponsePayload<'sites.list'>];
    'sites.revoke': [{ origin: string }, BridgeResponsePayload<'sites.revoke'>];
    'sites.binding': [{ origin: string }, BridgeResponsePayload<'sites.binding'>];
    'sites.useActiveAccount': [{ origin: string }, BridgeResponsePayload<'sites.useActiveAccount'>];
    'sites.countForAccount': [
      { accountPubkey: string },
      BridgeResponsePayload<'sites.countForAccount'>,
    ];
    'nostr.requests.present': [{ requestId: string }, BridgeResponsePayload<'nostr.requests.present'>];
    'nostr.requests.respond': [
      { requestId: string; approved: boolean; duration: ApprovalDuration },
      BridgeResponsePayload<'nostr.requests.respond'>,
    ];
    'nostr.requests.content': [{ requestId: string }, BridgeResponsePayload<'nostr.requests.content'>];
    'nostr.requests.requeuePresented': [undefined, BridgeResponsePayload<'nostr.requests.requeuePresented'>];
    'vault.unlock': [{ password: string }, BridgeResponsePayload<'vault.unlock'>];
    'vault.lock': [undefined, BridgeResponsePayload<'vault.lock'>];
    'vault.create': [
      { password: string; vaultData: VaultData },
      BridgeResponsePayload<'vault.create'>,
    ];
    'vault.isUnlocked': [undefined, BridgeResponsePayload<'vault.isUnlocked'>];
    'activity.mark': [undefined, BridgeResponsePayload<'activity.mark'>];
    'vault.getData': [undefined, BridgeResponsePayload<'vault.getData'>];
    'vault.updateData': [{ vaultData: VaultData }, BridgeResponsePayload<'vault.updateData'>];
    'vault.export': [undefined, BridgeResponsePayload<'vault.export'>];
    'vault.import': [{ encryptedData: string }, BridgeResponsePayload<'vault.import'>];
    'blossom.upload': [
      {
        base64Data: string;
        fileType: string;
        blossomServer: string;
        uploadId?: string;
      },
      BridgeResponsePayload<'blossom.upload'>,
    ];
    'relay.browser.list': [undefined, BridgeResponsePayload<'relay.browser.list'>];
    'relay.browser.getStatus': [undefined, BridgeResponsePayload<'relay.browser.getStatus'>];
    'relay.browser.refresh': [{ force?: boolean }, BridgeResponsePayload<'relay.browser.refresh'>];
    'nip47.connections.list': [undefined, BridgeResponsePayload<'nip47.connections.list'>];
    'nip47.connections.import': [
      { uri: string; label?: string; identityId?: string },
      BridgeResponsePayload<'nip47.connections.import'>,
    ];
    'nip47.connections.remove': [{ connectionId: string }, BridgeResponsePayload<'nip47.connections.remove'>];
    'nip47.connections.setActive': [{ connectionId: string }, BridgeResponsePayload<'nip47.connections.setActive'>];
    'nip47.getInfo': [{ connectionId: string }, BridgeResponsePayload<'nip47.getInfo'>];
    'nip47.getBalance': [{ connectionId: string }, BridgeResponsePayload<'nip47.getBalance'>];
    'nip47.payInvoice': [
      { connectionId: string; invoice: string },
      BridgeResponsePayload<'nip47.payInvoice'>,
    ];
    'nip47.payments.list': [undefined, BridgeResponsePayload<'nip47.payments.list'>];
    'nip57.getCapabilities': [{ origin: string }, BridgeResponsePayload<'nip57.getCapabilities'>];
    'nip57.sendZap': [
      { origin: string; request: SendZapRequest; approved?: boolean },
      BridgeResponsePayload<'nip57.sendZap'>,
    ];
    'nip57.zaps.list': [undefined, BridgeResponsePayload<'nip57.zaps.list'>];
    'webln.enable': [{ origin: string; approved?: boolean }, BridgeResponsePayload<'webln.enable'>];
    'webln.getInfo': [{ origin: string }, BridgeResponsePayload<'webln.getInfo'>];
    'webln.sendPayment': [WebLnSendPaymentRequest, BridgeResponsePayload<'webln.sendPayment'>];
  }
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
      await logService.logException(event.message || 'Unknown error', activeAlias, 'background');
    })();
  });

  self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    void (async () => {
      const activeAlias = await getActiveAlias();
      await logService.logException(
        event.reason instanceof Error ? event.reason.message : String(event.reason),
        activeAlias,
        'background',
      );
    })();
  });
}

// Auto-lock activity is deliberately not reset by site-initiated requests (ADR D15). A page
// making periodic requests must not hold the vault unlocked past the user's configured
// interval; only interaction with a Porwr surface counts as activity.
bridge.on('nostr.requests.list', () => {
  return listPendingRequests() as unknown as BridgeResponsePayload<'nostr.requests.list'>;
});

bridge.on('nostr.requests.current', () => {
  return getCurrentRequest() as unknown as BridgeResponsePayload<'nostr.requests.current'>;
});

bridge.on('nostr.requests.count', () => {
  return getPendingCount() as unknown as BridgeResponsePayload<'nostr.requests.count'>;
});

// The panel can read a tab's id but never its url (NFR-18 rules out the permission that would
// expose it), so the origin is resolved here from what the content script's port already told us.
bridge.on('pages.originForTab', ({ payload }) => {
  return getPageOrigin(payload.tabId) ?? null;
});

// What each site currently holds, and disconnecting one. The handlers behind these have existed
// since the permission model was written, with no bridge event and no caller, so no user has ever
// been able to see or revoke a grant (#116).
bridge.on('sites.list', () => {
  return listConnectedSites() as unknown as BridgeResponsePayload<'sites.list'>;
});

bridge.on('sites.revoke', ({ payload }) => {
  return disconnectSite(payload.origin) as unknown as BridgeResponsePayload<'sites.revoke'>;
});

// Which account a site is connected as, and moving it to the active one. Only Porwr's own panel and
// dashboard send these: a site never moves itself (diogel-io/workspace#23).
bridge.on('sites.binding', ({ payload }) => {
  return getSiteAccount(payload.origin) as unknown as BridgeResponsePayload<'sites.binding'>;
});

bridge.on('sites.useActiveAccount', ({ payload }) => {
  return switchSiteToActiveAccount(
    payload.origin,
  ) as unknown as BridgeResponsePayload<'sites.useActiveAccount'>;
});

bridge.on('sites.countForAccount', ({ payload }) => {
  return countSitesHoldingGrantsFor(
    payload.accountPubkey,
  ) as unknown as BridgeResponsePayload<'sites.countForAccount'>;
});

bridge.on('nostr.requests.present', ({ payload }) => {
  return markPresented(payload.requestId) as unknown as BridgeResponsePayload<'nostr.requests.present'>;
});

// Decisions name a request id. The queue refuses unknown, already-terminal, and expired ids, so
// a panel acting on stale state changes nothing (ADR D5).
bridge.on('nostr.requests.respond', ({ payload }) => {
  return submitDecision(payload.requestId, {
    approved: payload.approved,
    duration: payload.duration,
  }) as unknown as BridgeResponsePayload<'nostr.requests.respond'>;
});

// Reviewable content is read from the live worker, never from storage. A restarted worker has
// none, which matches the request being interrupted anyway (D6, D7).
bridge.on('nostr.requests.content', ({ payload }) => {
  return getRequestContent(payload.requestId);
});

bridge.on('nostr.requests.requeuePresented', () => {
  return requeuePresented() as unknown as BridgeResponsePayload<'nostr.requests.requeuePresented'>;
});

bridge.on('vault.unlock', ({ payload }) => {
  return dispatchMessage('vault.unlock', createBridgeRequest('vault.unlock', payload), '') as unknown as BridgeResponsePayload<'vault.unlock'>;
});

bridge.on('vault.lock', () => {
  return dispatchMessage('vault.lock', createBridgeRequest('vault.lock', {}), '') as unknown as BridgeResponsePayload<'vault.lock'>;
});

bridge.on('vault.create', ({ payload }) => {
  return dispatchMessage('vault.create', createBridgeRequest('vault.create', payload), '') as unknown as BridgeResponsePayload<'vault.create'>;
});

bridge.on('vault.isUnlocked', () => {
  return dispatchMessage('vault.isUnlocked', createBridgeRequest('vault.isUnlocked', {}), '') as unknown as BridgeResponsePayload<'vault.isUnlocked'>;
});

bridge.on('activity.mark', () => {
  return dispatchMessage('activity.mark', createBridgeRequest('activity.mark', {}), '') as unknown as BridgeResponsePayload<'activity.mark'>;
});

bridge.on('vault.getData', () => {
  return dispatchMessage('vault.getData', createBridgeRequest('vault.getData', {}), '') as unknown as BridgeResponsePayload<'vault.getData'>;
});

bridge.on('vault.updateData', ({ payload }) => {
  return dispatchMessage('vault.updateData', createBridgeRequest('vault.updateData', payload), '') as unknown as BridgeResponsePayload<'vault.updateData'>;
});

bridge.on('vault.export', () => {
  return dispatchMessage('vault.export', createBridgeRequest('vault.export', {}), '') as unknown as BridgeResponsePayload<'vault.export'>;
});

bridge.on('vault.import', ({ payload }) => {
  return dispatchMessage('vault.import', createBridgeRequest('vault.import', payload), '') as unknown as BridgeResponsePayload<'vault.import'>;
});

bridge.on('nip47.connections.list', () => {
  return dispatchMessage('nip47.connections.list', createBridgeRequest('nip47.connections.list', {}), '') as unknown as BridgeResponsePayload<'nip47.connections.list'>;
});

bridge.on('nip47.connections.import', ({ payload }) => {
  return dispatchMessage('nip47.connections.import', createBridgeRequest('nip47.connections.import', payload), '') as unknown as BridgeResponsePayload<'nip47.connections.import'>;
});

bridge.on('nip47.connections.remove', ({ payload }) => {
  return dispatchMessage('nip47.connections.remove', createBridgeRequest('nip47.connections.remove', payload), '') as unknown as BridgeResponsePayload<'nip47.connections.remove'>;
});

bridge.on('nip47.connections.setActive', ({ payload }) => {
  return dispatchMessage('nip47.connections.setActive', createBridgeRequest('nip47.connections.setActive', payload), '') as unknown as BridgeResponsePayload<'nip47.connections.setActive'>;
});

bridge.on('nip47.getInfo', ({ payload }) => {
  return dispatchMessage('nip47.getInfo', createBridgeRequest('nip47.getInfo', payload), '') as unknown as BridgeResponsePayload<'nip47.getInfo'>;
});

bridge.on('nip47.getBalance', ({ payload }) => {
  return dispatchMessage('nip47.getBalance', createBridgeRequest('nip47.getBalance', payload), '') as unknown as BridgeResponsePayload<'nip47.getBalance'>;
});

bridge.on('nip47.payInvoice', ({ payload }) => {
  return dispatchMessage('nip47.payInvoice', createBridgeRequest('nip47.payInvoice', payload), '') as unknown as BridgeResponsePayload<'nip47.payInvoice'>;
});

bridge.on('nip47.payments.list', () => {
  return dispatchMessage('nip47.payments.list', createBridgeRequest('nip47.payments.list', {}), '') as unknown as BridgeResponsePayload<'nip47.payments.list'>;
});

// The vault's raw AES key is persisted to chrome.storage.session so it survives
// service worker restarts. Explicitly restrict that storage area to extension
// pages/background (never content scripts or web pages), regardless of the
// browser's default access level.
async function lockDownSessionStorage(): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session?.setAccessLevel) {
      await chrome.storage.session.setAccessLevel({
        accessLevel: 'TRUSTED_CONTEXTS',
      });
    }
  } catch (error: unknown) {
    logService.log(LogLevel.ERROR, '[BEX] Failed to set session storage access level', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function initialize(): Promise<void> {
  try {
    await lockDownSessionStorage();
    await restoreLastActivity();
    const restored = await restoreVaultState();
    if (restored) {
      startAutoLockTimer();
      await checkAutoLock();
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

void initialize();

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

// Signing/encryption actions are scoped to the requesting page's origin for
// permission checks. This raw listener has no reliable origin of its own, so
// these actions must carry a non-empty `payload.origin` rather than falling
// back to '' (which could otherwise match a permission record with no origin).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const decision = decideRouting(message as RawMessage);

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

bridge.on('nostr.getPublicKey', ({ payload: { origin } }) => (
  (async () => {
    const result = await handleGetPublicKey({}, origin);
    if (!result.success) {
      throw new BackgroundBridgeError(
        result.error === 'Vault is locked' ? 'VAULT_LOCKED' : 'NOT_FOUND',
        result.error,
      );
    }
    const activeStoredKey = await getActiveStoredKey();
    void logService.logApproval('get_public_key', originHostname(origin), activeStoredKey?.alias);
    const approved = await requestApproval(origin, -1, { requestType: 'get_public_key' });
    if (!approved) {
      throw new BackgroundBridgeError('PERMISSION_DENIED', 'User rejected the request');
    }
    return result.data;
  })() as unknown as BridgeResponsePayload<'nostr.getPublicKey'>
));

bridge.on('nostr.signEvent', ({ payload: { event, origin } }) => (
  (async () => {
    const activeStoredKey = await getActiveStoredKey();
    void logService.logApproval(event.kind, originHostname(origin), activeStoredKey?.alias);
    const contentDescription = trimApprovalContentDescription(event.content);
    const approvalDetails: ApprovalRequestDetails = contentDescription
      ? { requestType: 'sign_event', contentDescription, event }
      : { requestType: 'sign_event', event };
    const approved = await requestApproval(origin, event.kind, approvalDetails);
    if (!approved) {
      const unlockedStatus = await handleVaultIsUnlocked({}, '');
      if (!unlockedStatus.success || !unlockedStatus.data) {
        throw new BackgroundBridgeError('VAULT_LOCKED', 'Vault is locked. Open the extension to unlock.');
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
  })() as unknown as BridgeResponsePayload<'nostr.signEvent'>
));

bridge.on('nostr.getRelays', ({ payload: { origin } }) => (
  (async () => {
    const activeStoredKey = await getActiveStoredKey();
    void logService.logApproval('get_relays', originHostname(origin), activeStoredKey?.alias);
    const approved = await requestApproval(origin, -1, { requestType: 'get_relays' });
    if (!approved) {
      const unlockedStatus = await handleVaultIsUnlocked({}, '');
      if (!unlockedStatus.success || !unlockedStatus.data) throw new Error('Vault is locked. Open the extension to unlock.');
      throw new Error('User rejected the request');
    }
    return await dispatchMessage('nostr.getRelays', createBridgeRequest('nostr.getRelays', { origin }), origin) ?? {};
  })() as unknown as BridgeResponsePayload<'nostr.getRelays'>
));

bridge.on('nostr.nip04.encrypt', ({ payload }) => (
  (async () => {
    const activeStoredKey = await getActiveStoredKey();
    void logService.logApproval('nip04_encrypt', originHostname(payload.origin), activeStoredKey?.alias);
    const approved = await requestApproval(payload.origin, -1, { requestType: 'nip04_encrypt', counterpartyPubkey: payload.pubkey });
    if (!approved) {
      const unlockedStatus = await handleVaultIsUnlocked({}, '');
      if (!unlockedStatus.success || !unlockedStatus.data) throw new Error('Vault is locked. Open the extension to unlock.');
      throw new Error('User rejected the request');
    }
    return await dispatchMessage('nostr.nip04.encrypt', createBridgeRequest('nostr.nip04.encrypt', payload), payload.origin) ?? '';
  })() as unknown as BridgeResponsePayload<'nostr.nip04.encrypt'>
));

bridge.on('nostr.nip04.decrypt', ({ payload }) => (
  (async () => {
    const activeStoredKey = await getActiveStoredKey();
    void logService.logApproval('nip04_decrypt', originHostname(payload.origin), activeStoredKey?.alias);
    const approved = await requestApproval(payload.origin, -1, { requestType: 'nip04_decrypt', counterpartyPubkey: payload.pubkey });
    if (!approved) {
      const unlockedStatus = await handleVaultIsUnlocked({}, '');
      if (!unlockedStatus.success || !unlockedStatus.data) throw new Error('Vault is locked. Open the extension to unlock.');
      throw new Error('User rejected the request');
    }
    return await dispatchMessage('nostr.nip04.decrypt', createBridgeRequest('nostr.nip04.decrypt', payload), payload.origin) ?? '';
  })() as unknown as BridgeResponsePayload<'nostr.nip04.decrypt'>
));

bridge.on('nostr.nip44.encrypt', ({ payload }) => (
  (async () => {
    const activeStoredKey = await getActiveStoredKey();
    void logService.logApproval('nip44_encrypt', originHostname(payload.origin), activeStoredKey?.alias);
    const approved = await requestApproval(payload.origin, -1, { requestType: 'nip44_encrypt', counterpartyPubkey: payload.pubkey });
    if (!approved) {
      const unlockedStatus = await handleVaultIsUnlocked({}, '');
      if (!unlockedStatus.success || !unlockedStatus.data) throw new Error('Vault is locked. Open the extension to unlock.');
      throw new Error('User rejected the request');
    }
    return await dispatchMessage('nostr.nip44.encrypt', createBridgeRequest('nostr.nip44.encrypt', payload), payload.origin) ?? '';
  })() as unknown as BridgeResponsePayload<'nostr.nip44.encrypt'>
));

bridge.on('nostr.nip44.decrypt', ({ payload }) => (
  (async () => {
    const activeStoredKey = await getActiveStoredKey();
    void logService.logApproval('nip44_decrypt', originHostname(payload.origin), activeStoredKey?.alias);
    const approved = await requestApproval(payload.origin, -1, { requestType: 'nip44_decrypt', counterpartyPubkey: payload.pubkey });
    if (!approved) {
      const unlockedStatus = await handleVaultIsUnlocked({}, '');
      if (!unlockedStatus.success || !unlockedStatus.data) throw new Error('Vault is locked. Open the extension to unlock.');
      throw new Error('User rejected the request');
    }
    return await dispatchMessage('nostr.nip44.decrypt', createBridgeRequest('nostr.nip44.decrypt', payload), payload.origin) ?? '';
  })() as unknown as BridgeResponsePayload<'nostr.nip44.decrypt'>
));

bridge.on('blossom.upload', ({ payload }) => {
  void resetAutoLockTimer();
  return dispatchMessage('blossom.upload', createBridgeRequest('blossom.upload', payload), '') as unknown as BridgeResponsePayload<'blossom.upload'>;
});

bridge.on('relay.browser.list', () => {
  return dispatchMessage('relay.browser.list', createBridgeRequest('relay.browser.list', {}), '') as unknown as BridgeResponsePayload<'relay.browser.list'>;
});

bridge.on('relay.browser.getStatus', () => {
  return dispatchMessage('relay.browser.getStatus', createBridgeRequest('relay.browser.getStatus', {}), '') as unknown as BridgeResponsePayload<'relay.browser.getStatus'>;
});

bridge.on('relay.browser.refresh', ({ payload }) => {
  return dispatchMessage('relay.browser.refresh', createBridgeRequest('relay.browser.refresh', payload), '') as unknown as BridgeResponsePayload<'relay.browser.refresh'>;
});

bridge.on('nip57.getCapabilities', ({ payload }) => {
  return dispatchMessage(
    'nip57.getCapabilities',
    createBridgeRequest('nip57.getCapabilities', { origin: payload.origin }),
    payload.origin,
  ) as unknown as BridgeResponsePayload<'nip57.getCapabilities'>;
});

bridge.on('nip57.sendZap', ({ payload }) => (
  (async () => {
    const amountMsat = payload.request.amountMsat ?? (payload.request.amountSats !== undefined ? payload.request.amountSats * 1000 : 0);
    const amountSatsLabel = amountMsat > 0 ? `${amountMsat / 1000} sats` : 'unknown amount';
    const contentDescription = trimApprovalContentDescription(
      `Zap ${amountSatsLabel} to ${payload.request.target.recipientPubkey}${payload.request.comment ? ` — ${payload.request.comment}` : ''}`,
    );
    const approved = await requestApproval(payload.origin, 9734, {
      requestType: 'send_zap',
      ...(contentDescription ? { contentDescription } : {}),
      allowRemember: false,
      skipPermissionCheck: true,
    });
    if (!approved) {
      return {
        status: 'cancelled',
        amountMsat,
        recipientPubkey: payload.request.target.recipientPubkey,
        error: 'User rejected the zap payment',
        code: 'USER_REJECTED',
      };
    }
    return await dispatchMessage(
      'nip57.sendZap',
      createBridgeRequest('nip57.sendZap', { origin: payload.origin, request: payload.request, approved: true }),
      payload.origin,
    );
  })() as unknown as BridgeResponsePayload<'nip57.sendZap'>
));

bridge.on('nip57.zaps.list', () => {
  return dispatchMessage('nip57.zaps.list', createBridgeRequest('nip57.zaps.list', {}), '') as unknown as BridgeResponsePayload<'nip57.zaps.list'>;
});

bridge.on('webln.enable', ({ payload }) => (
  (async () => {
    const approved = await requestApproval(payload.origin, -1, {
      requestType: 'webln_enable',
      contentDescription: 'Allow this site to use Porwr as a WebLN wallet provider. Payments will still require separate approval.',
      allowRemember: true,
      skipPermissionCheck: true,
    });
    if (!approved) {
      throw new BackgroundBridgeError('PERMISSION_DENIED', 'User rejected WebLN access');
    }
    return await dispatchMessage(
      'webln.enable',
      createBridgeRequest('webln.enable', { origin: payload.origin, approved: true }),
      payload.origin,
    );
  })() as unknown as BridgeResponsePayload<'webln.enable'>
));

bridge.on('webln.getInfo', ({ payload }) => {
  return dispatchMessage(
    'webln.getInfo',
    createBridgeRequest('webln.getInfo', { origin: payload.origin }),
    payload.origin,
  ) as unknown as BridgeResponsePayload<'webln.getInfo'>;
});

bridge.on('webln.sendPayment', ({ payload }) => (
  (async () => {
    const amountMsat = parseBolt11AmountMsat(payload.paymentRequest);
    const amountDescription = amountMsat !== undefined ? `${amountMsat / 1000} sats` : 'unknown amount';
    const approved = await requestApproval(payload.origin, -1, {
      requestType: 'webln_send_payment',
      contentDescription: `Pay Lightning invoice for ${amountDescription}: ${previewInvoice(payload.paymentRequest)}`,
      allowRemember: false,
      skipPermissionCheck: true,
    });
    if (!approved) {
      throw new BackgroundBridgeError('PERMISSION_DENIED', 'User rejected the WebLN payment');
    }
    return await dispatchMessage(
      'webln.sendPayment',
      createBridgeRequest('webln.sendPayment', {
        origin: payload.origin,
        paymentRequest: payload.paymentRequest,
        approved: true,
      }),
      payload.origin,
    );
  })() as unknown as BridgeResponsePayload<'webln.sendPayment'>
));
