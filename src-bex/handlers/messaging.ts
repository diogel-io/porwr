import { getPublicKey } from 'nostr-tools';

import type { VaultData } from '@/types/bridge';
import type {
  DmRelayCheckRequest,
  DmRelayCheckResult,
  DmRelayList,
  DmRelayPublishRequest,
  DmRelayPublishResult,
  FetchMessagesRequest,
  FetchMessagesResult,
  MarkReadRequest,
  MessagingReadState,
  MessagingSavedPeers,
  SavedPeerRequest,
  SendMessageRequest,
  SendMessageResult,
} from '@/types/messaging';
import type { HandlerResult } from '../types/background';
import { getVaultData, onVaultLocked } from '../vault';
import { NOSTR_ACTIVE, storageService } from '@/services/storage-service';
import { mutateVault } from '../services/vault-mutation';
import { getActiveSecretKey } from './active-key';
import { messagingRelays, validateDmRelays } from '../services/messaging-relays';
import { nip17Messaging } from '../services/nip17-messaging';
import { dmRelayProbe } from '../services/dm-relay-probe';
import { markConversationRead, readStateFor } from '../services/messaging-read-state-store';
import {
  addSavedPeer,
  removeSavedPeer,
  savedPeersFor,
} from '../services/messaging-saved-peers-store';

/**
 * NIP-17 messaging actions for the extension's own pages.
 *
 * These sign, encrypt and decrypt with the active account's key inside the background. The key never
 * leaves it: a page gets relay URLs, publish outcomes and decrypted message text back, nothing else.
 * They are not origin-scoped, so a website cannot reach them through the provider.
 */

/** Long enough for any real message; a ceiling so a page cannot ask the background to wrap megabytes. */
const MAX_MESSAGE_LENGTH = 16_000;
const HEX_64 = /^[0-9a-f]{64}$/;
const CLIENT_MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

// Decrypted messages are held in memory only, and go with the key.
onVaultLocked(() => nip17Messaging.clear());

/**
 * Drops other accounts' decrypted messages as soon as the active account changes, rather than at the
 * next messaging call: one account's conversations are not kept in memory while another is in use
 * (diogel-io/workspace#142). Messages are kept by public key, so renaming the active account, which
 * rewrites `nostr:active` to the new alias, keeps its own. If the active account can't be resolved,
 * everything is dropped.
 */
export async function retainActiveAccountMessages(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
): Promise<void> {
  if (areaName !== 'local' || !(NOSTR_ACTIVE in changes)) return;
  try {
    nip17Messaging.keepOnly(getPublicKey(await getActiveSecretKey()));
  } catch {
    nip17Messaging.clear();
  }
}
storageService.onChanged((changes, areaName) => {
  void retainActiveAccountMessages(changes, areaName);
});

export async function handleDmRelaysGet(): Promise<HandlerResult<DmRelayList>> {
  const pubkey = getPublicKey(await getActiveSecretKey());
  return { success: true, data: await messagingRelays.fetchDmRelays(pubkey) };
}

export async function handleDmRelaysPublish(
  payload: DmRelayPublishRequest,
): Promise<HandlerResult<DmRelayPublishResult>> {
  const validation = validateDmRelays(Array.isArray(payload?.relays) ? payload.relays : []);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const result = await messagingRelays.publishDmRelays(
    await getActiveSecretKey(),
    validation.relays,
  );
  if (result.accepted.length === 0) {
    return {
      success: false,
      error: 'No relay accepted the direct message relay list',
      metadata: { rejected: result.rejected },
    };
  }
  return { success: true, data: result };
}

/**
 * Tests whether each relay keeps gift wraps, before the user publishes them as their inbox (#277).
 * The test uses throwaway keys, so it needs no unlocked account.
 */
export async function handleDmRelaysCheck(
  payload: DmRelayCheckRequest,
): Promise<HandlerResult<DmRelayCheckResult>> {
  const validation = validateDmRelays(Array.isArray(payload?.relays) ? payload.relays : []);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  return { success: true, data: await dmRelayProbe.check(validation.relays) };
}

export async function handleMessagesSend(
  payload: SendMessageRequest,
): Promise<HandlerResult<SendMessageResult>> {
  if (
    !payload ||
    typeof payload.clientMessageId !== 'string' ||
    !CLIENT_MESSAGE_ID.test(payload.clientMessageId)
  ) {
    return { success: false, error: 'A message needs a client message id' };
  }
  if (typeof payload.recipient !== 'string' || !HEX_64.test(payload.recipient)) {
    return { success: false, error: 'The recipient must be a hex public key' };
  }
  if (typeof payload.content !== 'string' || payload.content.trim().length === 0) {
    return { success: false, error: 'The message is empty' };
  }
  if (payload.content.length > MAX_MESSAGE_LENGTH) {
    return { success: false, error: 'The message is too long' };
  }

  const secretKey = await getActiveSecretKey();
  if (payload.recipient === getPublicKey(secretKey)) {
    return { success: false, error: 'Cannot send a message to yourself' };
  }

  const result = await nip17Messaging.send(secretKey, {
    clientMessageId: payload.clientMessageId,
    recipient: payload.recipient,
    content: payload.content,
  });
  return { success: true, data: result };
}

export async function handleMessagesFetch(
  payload: FetchMessagesRequest,
): Promise<HandlerResult<FetchMessagesResult>> {
  const since =
    typeof payload?.since === 'number' && Number.isFinite(payload.since)
      ? payload.since
      : undefined;
  const result = await nip17Messaging.fetch(
    await getActiveSecretKey(),
    since === undefined ? {} : { since },
  );
  return { success: true, data: result };
}

async function requireUnlockedVaultData(): Promise<VaultData> {
  const result = await getVaultData();
  if (!result.success || !result.vaultData) {
    throw new Error(result.error || 'Vault is locked. Unlock Porwr before reading messages.');
  }
  return result.vaultData as VaultData;
}

export async function handleMessagesReadState(): Promise<HandlerResult<MessagingReadState>> {
  const me = getPublicKey(await getActiveSecretKey());
  return { success: true, data: readStateFor(await requireUnlockedVaultData(), me) };
}

export async function handleMessagesMarkRead(
  payload: MarkReadRequest,
): Promise<HandlerResult<MessagingReadState>> {
  if (!payload || typeof payload.peer !== 'string' || !HEX_64.test(payload.peer)) {
    return { success: false, error: 'The conversation must be a hex public key' };
  }
  if (
    typeof payload.readAt !== 'number' ||
    !Number.isFinite(payload.readAt) ||
    payload.readAt < 0
  ) {
    return { success: false, error: 'readAt must be a timestamp' };
  }

  const me = getPublicKey(await getActiveSecretKey());
  const readAt = Math.floor(payload.readAt);

  // Through the shared vault queue, so a read and a saved-peer change cannot each load the vault and
  // overwrite the other's update. An unchanged vault is not written.
  const readState = await mutateVault((vaultData) => {
    const next = markConversationRead(vaultData, me, payload.peer, readAt);
    return { vault: next, result: readStateFor(next, me) };
  });
  return { success: true, data: readState };
}

function checkPeer(payload: SavedPeerRequest | undefined): string | null {
  return payload && typeof payload.peer === 'string' && HEX_64.test(payload.peer)
    ? payload.peer
    : null;
}

/** The contacts this account added to Chats through search (#258). */
export async function handleSavedPeersGet(): Promise<HandlerResult<MessagingSavedPeers>> {
  const me = getPublicKey(await getActiveSecretKey());
  return { success: true, data: savedPeersFor(await requireUnlockedVaultData(), me) };
}

export async function handleSavedPeersAdd(
  payload: SavedPeerRequest,
): Promise<HandlerResult<MessagingSavedPeers>> {
  const peer = checkPeer(payload);
  if (!peer) return { success: false, error: 'The conversation must be a hex public key' };

  const me = getPublicKey(await getActiveSecretKey());
  if (peer === me) return { success: false, error: 'Cannot start a conversation with yourself' };

  try {
    const peers = await mutateVault((vaultData) => {
      const next = addSavedPeer(vaultData, me, peer);
      return { vault: next, result: savedPeersFor(next, me) };
    });
    return { success: true, data: peers };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Takes a contact off Chats. Only hides a conversation with no messages: one with history is listed
 * because of its messages, whatever is saved here.
 */
export async function handleSavedPeersRemove(
  payload: SavedPeerRequest,
): Promise<HandlerResult<MessagingSavedPeers>> {
  const peer = checkPeer(payload);
  if (!peer) return { success: false, error: 'The conversation must be a hex public key' };

  const me = getPublicKey(await getActiveSecretKey());
  const peers = await mutateVault((vaultData) => {
    const next = removeSavedPeer(vaultData, me, peer);
    return { vault: next, result: savedPeersFor(next, me) };
  });
  return { success: true, data: peers };
}
