import { getPublicKey } from 'nostr-tools';

import type { VaultData } from '@/types/bridge';
import type {
  DmRelayList,
  DmRelayPublishRequest,
  DmRelayPublishResult,
  FetchMessagesRequest,
  FetchMessagesResult,
  MarkReadRequest,
  MessagingReadState,
  SendMessageRequest,
  SendMessageResult,
} from '@/types/messaging';
import type { HandlerResult } from '../types/background';
import { getVaultData, onVaultLocked, updateVaultData } from '../vault';
import { getActiveSecretKey } from './active-key';
import { messagingRelays, validateDmRelays } from '../services/messaging-relays';
import { nip17Messaging } from '../services/nip17-messaging';
import { markConversationRead, readStateFor } from '../services/messaging-read-state-store';

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

  const result = await messagingRelays.publishDmRelays(await getActiveSecretKey(), validation.relays);
  if (result.accepted.length === 0) {
    return {
      success: false,
      error: 'No relay accepted the direct message relay list',
      metadata: { rejected: result.rejected },
    };
  }
  return { success: true, data: result };
}

export async function handleMessagesSend(payload: SendMessageRequest): Promise<HandlerResult<SendMessageResult>> {
  if (!payload || typeof payload.clientMessageId !== 'string' || !CLIENT_MESSAGE_ID.test(payload.clientMessageId)) {
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

export async function handleMessagesFetch(payload: FetchMessagesRequest): Promise<HandlerResult<FetchMessagesResult>> {
  const since = typeof payload?.since === 'number' && Number.isFinite(payload.since) ? payload.since : undefined;
  const result = await nip17Messaging.fetch(await getActiveSecretKey(), since === undefined ? {} : { since });
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

let readStateWrites: Promise<void> = Promise.resolve();

export async function handleMessagesMarkRead(payload: MarkReadRequest): Promise<HandlerResult<MessagingReadState>> {
  if (!payload || typeof payload.peer !== 'string' || !HEX_64.test(payload.peer)) {
    return { success: false, error: 'The conversation must be a hex public key' };
  }
  if (typeof payload.readAt !== 'number' || !Number.isFinite(payload.readAt) || payload.readAt < 0) {
    return { success: false, error: 'readAt must be a timestamp' };
  }

  const me = getPublicKey(await getActiveSecretKey());

  // Serialised so two quick reads cannot each load the vault and overwrite the other's update.
  const write = readStateWrites.then(async () => {
    const vaultData = await requireUnlockedVaultData();
    const next = markConversationRead(vaultData, me, payload.peer, Math.floor(payload.readAt));
    if (next !== vaultData) {
      const saved = await updateVaultData(next);
      if (!saved.success) throw new Error(saved.error || 'Failed to save read state');
    }
    return readStateFor(next, me);
  });
  readStateWrites = write.then(
    () => undefined,
    () => undefined,
  );
  return { success: true, data: await write };
}
