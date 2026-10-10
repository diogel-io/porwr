import type {
  BridgeAction,
  BridgeRequestMap,
  BridgeResponsePayload,
} from '@/types/bridge';
import {
  handleVaultUnlock,
  handleVaultLock,
  handleVaultIsUnlocked,
  handleVaultCreate,
  handleVaultExport,
  handleVaultImport,
} from './handlers/vault-handler';
import {
  resetAutoLockTimer,
  startAutoLockTimer,
  stopAutoLockTimer,
} from './services/auto-lock';
import { handleGetPublicKey, handleSignEvent } from './handlers/nip07';
import {
  getCurrentRequest,
  getPendingCount,
  getRequestContent,
  listPendingRequests,
  markPresented,
  requeuePresented,
  submitDecision,
} from './services/request-queue';
import { getPageOrigin } from './services/page-origin-registry';
import {
  countSitesHoldingGrantsFor,
  disconnectSite,
  listConnectedSites,
} from './services/connected-sites';
import { getSiteAccount, switchSiteToActiveAccount } from './services/site-account';
import { handleBlossomUpload } from './handlers/blossom-handler';
import { handleNip04Encrypt, handleNip04Decrypt } from './handlers/nip04';
import { handleNip44Encrypt, handleNip44Decrypt } from './handlers/nip44';
import { handleRelayBrowserList, handleRelayBrowserGetStatus, handleRelayBrowserRefresh } from './handlers/relay-browser-handler';
import {
  handleDmRelaysGet,
  handleDmRelaysPublish,
  handleMessagesFetch,
  handleMessagesMarkRead,
  handleMessagesReadState,
  handleMessagesSend,
} from './handlers/messaging';
import { handleAccountSignEvent } from './handlers/account-signing';
import {
  handleAccountsAdd,
  handleAccountsRemove,
  handleAccountsRename,
  handleAccountsRevealSecret,
  handleVaultGetView,
} from './handlers/accounts';
import {
  handleNip47ConnectionImport,
  handleNip47ConnectionRemove,
  handleNip47ConnectionSetActive,
  handleNip47ConnectionsList,
  handleNip47GetBalance,
  handleNip47GetInfo,
  handleNip47PayInvoice,
  handleNip47PaymentHistoryList,
} from './handlers/nip47';
import {
  handleNip57GetCapabilities,
  handleNip57SendZap,
  handleNip57ZapHistoryList,
} from './handlers/nip57';
import {
  handleWebLnEnable,
  handleWebLnGetInfo,
  handleWebLnSendPayment,
} from './handlers/webln';

/**
 * Dispatches messages to the appropriate handlers.
 * This is used by both the Quasar BEX bridge and the direct chrome.runtime.onMessage listener.
 *
 * @param type The message type/event name
 * @param payload The message payload
 * @param origin The origin of the request (if applicable)
 * @returns The response payload
 */
export async function dispatchMessage<K extends BridgeAction>(
  type: K,
  payload: BridgeRequestMap[K],
  origin: string = '',
): Promise<BridgeResponsePayload<K> | null | undefined> {
  switch (type) {
    case 'ping':
      return 'pong' as BridgeResponsePayload<K>;

    case 'nostr.getPublicKey': {
      const result = await handleGetPublicKey(payload, origin);
      if (result.success) {
        return result.data as BridgeResponsePayload<K>;
      }
      return { success: false, error: result.error, code: result.code } as unknown as BridgeResponsePayload<K>;
    }

    case 'nostr.signEvent': {
      const signPayload = payload as BridgeRequestMap['nostr.signEvent'];
      const result = await handleSignEvent({ event: signPayload.event }, origin);
      if (result.success) {
        return result.data as BridgeResponsePayload<K>;
      }
      return { success: false, error: result.error, code: result.code } as unknown as BridgeResponsePayload<K>;
    }

    case 'nostr.getRelays': {
      return {} as BridgeResponsePayload<K>;
    }

    case 'nostr.nip04.encrypt': {
      const result = await handleNip04Encrypt(payload as BridgeRequestMap['nostr.nip04.encrypt'], origin);
      if (result.success) {
        return result.data as BridgeResponsePayload<K>;
      }
      throw new Error(result.error);
    }

    case 'nostr.nip04.decrypt': {
      const result = await handleNip04Decrypt(payload as BridgeRequestMap['nostr.nip04.decrypt'], origin);
      if (result.success) {
        return result.data as BridgeResponsePayload<K>;
      }
      throw new Error(result.error);
    }

    case 'nostr.nip44.encrypt': {
      const result = await handleNip44Encrypt(payload as BridgeRequestMap['nostr.nip44.encrypt'], origin);
      if (result.success) {
        return result.data as BridgeResponsePayload<K>;
      }
      throw new Error(result.error);
    }

    case 'nostr.nip44.decrypt': {
      const result = await handleNip44Decrypt(payload as BridgeRequestMap['nostr.nip44.decrypt'], origin);
      if (result.success) {
        return result.data as BridgeResponsePayload<K>;
      }
      throw new Error(result.error);
    }

    case 'vault.isUnlocked': {
      const result = await handleVaultIsUnlocked({}, origin);
      return (result.success ? result.data : false) as BridgeResponsePayload<K>;
    }

    case 'vault.unlock': {
      const unlockPayload = payload as BridgeRequestMap['vault.unlock'];
      const result = await handleVaultUnlock({ password: unlockPayload.password }, origin);
      if (result.success) {
        await resetAutoLockTimer();
        startAutoLockTimer();
        // The decrypted vault stays here; a page learns only that unlocking worked (#240).
        return { success: true } as BridgeResponsePayload<K>;
      }
      return { success: false, error: result.error, code: result.code } as unknown as BridgeResponsePayload<K>;
    }

    case 'vault.lock': {
      await handleVaultLock({}, origin);
      stopAutoLockTimer();
      return { success: true } as BridgeResponsePayload<K>;
    }

    case 'vault.create': {
      const createPayload = payload as BridgeRequestMap['vault.create'];
      const result = await handleVaultCreate({
        password: createPayload.password,
        vaultData: createPayload.vaultData,
      }, origin);
      if (result.success) {
        return {
          success: true,
          ...(result.data.encryptedVault ? { encryptedVault: result.data.encryptedVault } : {}),
        } as BridgeResponsePayload<K>;
      }
      return { success: false, error: result.error, code: result.code } as unknown as BridgeResponsePayload<K>;
    }

    /**
     * The panel's own actions.
     *
     * These were registered only on the Quasar bridge, which `sendBexMessage` looks for at
     * `window.bridge` or `$q.bex` and does not find in an extension page — so every call fell back
     * to this dispatcher, hit no case, and returned null. The panel silently showed no requests at
     * all while the queue held them and the toolbar badge counted them (#177).
     */
    case 'nostr.requests.list':
      return (await listPendingRequests()) as BridgeResponsePayload<K>;

    case 'nostr.requests.current':
      return (await getCurrentRequest()) as BridgeResponsePayload<K>;

    case 'nostr.requests.count':
      return (await getPendingCount()) as BridgeResponsePayload<K>;

    case 'nostr.requests.content': {
      const contentPayload = payload as BridgeRequestMap['nostr.requests.content'];
      return getRequestContent(contentPayload.requestId) as BridgeResponsePayload<K>;
    }

    case 'nostr.requests.present': {
      const presentPayload = payload as BridgeRequestMap['nostr.requests.present'];
      return (await markPresented(presentPayload.requestId)) as BridgeResponsePayload<K>;
    }

    case 'nostr.requests.respond': {
      const respondPayload = payload as BridgeRequestMap['nostr.requests.respond'];
      return (await submitDecision(respondPayload.requestId, {
        approved: respondPayload.approved,
        duration: respondPayload.duration,
      })) as BridgeResponsePayload<K>;
    }

    case 'nostr.requests.requeuePresented':
      await requeuePresented();
      return null;

    case 'pages.originForTab': {
      const tabPayload = payload as BridgeRequestMap['pages.originForTab'];
      return (getPageOrigin(tabPayload.tabId) ?? null) as BridgeResponsePayload<K>;
    }

    case 'sites.list':
      return (await listConnectedSites()) as BridgeResponsePayload<K>;

    case 'sites.revoke': {
      const revokePayload = payload as BridgeRequestMap['sites.revoke'];
      return (await disconnectSite(revokePayload.origin)) as BridgeResponsePayload<K>;
    }

    case 'sites.binding': {
      const bindingPayload = payload as BridgeRequestMap['sites.binding'];
      return (await getSiteAccount(bindingPayload.origin)) as BridgeResponsePayload<K>;
    }

    case 'sites.useActiveAccount': {
      const switchPayload = payload as BridgeRequestMap['sites.useActiveAccount'];
      return (await switchSiteToActiveAccount(switchPayload.origin)) as BridgeResponsePayload<K>;
    }

    case 'sites.countForAccount': {
      const countPayload = payload as BridgeRequestMap['sites.countForAccount'];
      return (await countSitesHoldingGrantsFor(
        countPayload.accountPubkey,
      )) as BridgeResponsePayload<K>;
    }

    case 'vault.getView': {
      try {
        const result = await handleVaultGetView();
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'accounts.add': {
      try {
        const result = await handleAccountsAdd(payload as BridgeRequestMap['accounts.add']);
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'accounts.rename': {
      try {
        const result = await handleAccountsRename(payload as BridgeRequestMap['accounts.rename']);
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'accounts.remove': {
      try {
        const result = await handleAccountsRemove(payload as BridgeRequestMap['accounts.remove']);
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'accounts.revealSecret': {
      try {
        const result = await handleAccountsRevealSecret(payload as BridgeRequestMap['accounts.revealSecret']);
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'vault.export': {
      const result = await handleVaultExport({}, origin);
      if (result.success) {
        return { success: true, encryptedData: result.data.encryptedData } as BridgeResponsePayload<K>;
      }
      return { success: false, error: result.error, code: result.code } as unknown as BridgeResponsePayload<K>;
    }

    case 'vault.import': {
      const importPayload = payload as BridgeRequestMap['vault.import'];
      const encryptedData = importPayload.encryptedData || importPayload.payload?.encryptedData;
      if (!encryptedData) {
        return { success: false, error: 'Missing encrypted data', code: 'NOT_FOUND' } as unknown as BridgeResponsePayload<K>;
      }
      const result = await handleVaultImport({ encryptedData }, origin);
      if (result.success) {
        return { success: true } as BridgeResponsePayload<K>;
      }
      return { success: false, error: result.error, code: result.code } as unknown as BridgeResponsePayload<K>;
    }

    case 'blossom.upload': {
      const blossomPayload = payload as BridgeRequestMap['blossom.upload'];
      const result = await handleBlossomUpload({
        base64Data: blossomPayload.base64Data || '',
        fileType: blossomPayload.fileType || '',
        blossomServer: blossomPayload.blossomServer || '',
        ...(blossomPayload.uploadId ? { uploadId: blossomPayload.uploadId } : {}),
      }, origin);
      if (result.success) {
        return { success: true, url: result.data } as unknown as BridgeResponsePayload<K>;
      }
      return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
    }

    case 'activity.mark': {
      await resetAutoLockTimer();
      return true as BridgeResponsePayload<K>;
    }

    case 'relay.browser.list': {
      const result = await handleRelayBrowserList();
      if (result.success) {
        return result.data as BridgeResponsePayload<K>;
      }
      return [] as unknown as BridgeResponsePayload<K>;
    }

    case 'relay.browser.getStatus': {
      const result = await handleRelayBrowserGetStatus();
      if (result.success) {
        return result.data as BridgeResponsePayload<K>;
      }
      return null;
    }

    case 'relay.browser.refresh': {
      const result = await handleRelayBrowserRefresh(payload as BridgeRequestMap['relay.browser.refresh']);
      if (result.success) {
        return true as BridgeResponsePayload<K>;
      }
      return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
    }

    case 'nip47.connections.list': {
      const result = await handleNip47ConnectionsList();
      if (result.success) {
        return result.data as BridgeResponsePayload<K>;
      }
      return [] as unknown as BridgeResponsePayload<K>;
    }

    case 'nip47.connections.import': {
      try {
        const result = await handleNip47ConnectionImport(payload as BridgeRequestMap['nip47.connections.import']);
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'nip47.connections.remove': {
      try {
        const result = await handleNip47ConnectionRemove(payload as BridgeRequestMap['nip47.connections.remove']);
        if (result.success) {
          return true as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'nip47.connections.setActive': {
      try {
        const result = await handleNip47ConnectionSetActive(payload as BridgeRequestMap['nip47.connections.setActive']);
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'nip47.getInfo': {
      try {
        const result = await handleNip47GetInfo(payload as BridgeRequestMap['nip47.getInfo']);
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'nip47.getBalance': {
      try {
        const result = await handleNip47GetBalance(payload as BridgeRequestMap['nip47.getBalance']);
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'nip47.payInvoice': {
      try {
        const result = await handleNip47PayInvoice(payload as BridgeRequestMap['nip47.payInvoice']);
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'nip47.payments.list': {
      try {
        const result = await handleNip47PaymentHistoryList();
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'messaging.dmRelays.get': {
      try {
        const result = await handleDmRelaysGet();
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'messaging.dmRelays.publish': {
      try {
        const result = await handleDmRelaysPublish(payload as BridgeRequestMap['messaging.dmRelays.publish']);
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'messaging.send': {
      try {
        const result = await handleMessagesSend(payload as BridgeRequestMap['messaging.send']);
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'messaging.fetch': {
      try {
        const result = await handleMessagesFetch(payload as BridgeRequestMap['messaging.fetch']);
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'messaging.readState': {
      try {
        const result = await handleMessagesReadState();
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'account.signEvent': {
      try {
        const result = await handleAccountSignEvent(payload as BridgeRequestMap['account.signEvent']);
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'messaging.markRead': {
      try {
        const result = await handleMessagesMarkRead(payload as BridgeRequestMap['messaging.markRead']);
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'nip57.getCapabilities': {
      try {
        const result = await handleNip57GetCapabilities();
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'nip57.sendZap': {
      try {
        const result = await handleNip57SendZap(payload as BridgeRequestMap['nip57.sendZap']);
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'nip57.zaps.list': {
      try {
        const result = await handleNip57ZapHistoryList();
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'webln.enable': {
      try {
        const result = await handleWebLnEnable(payload as BridgeRequestMap['webln.enable']);
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'webln.getInfo': {
      try {
        const result = await handleWebLnGetInfo(payload as BridgeRequestMap['webln.getInfo']);
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    case 'webln.sendPayment': {
      try {
        const result = await handleWebLnSendPayment(payload as BridgeRequestMap['webln.sendPayment']);
        if (result.success) {
          return result.data as BridgeResponsePayload<K>;
        }
        return { success: false, error: result.error } as unknown as BridgeResponsePayload<K>;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) } as unknown as BridgeResponsePayload<K>;
      }
    }

    /**
     * Not an answer of `null` — no answer at all.
     *
     * These are different things and conflating them cost the panel its idle view. Several actions
     * legitimately answer `null`: the queue is empty, the tab has no known origin, the request
     * carries no content. `undefined` is reserved for "this router serves no such action", which is
     * the only case where the listener should stay silent (#195).
     */
    default:
      return undefined;
  }
}
