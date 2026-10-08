import { getPublicKey } from 'nostr-tools';

import type { DmRelayList, DmRelayPublishRequest, DmRelayPublishResult } from '@/types/messaging';
import type { HandlerResult } from '../types/background';
import { getActiveSecretKey } from './active-key';
import { messagingRelays, validateDmRelays } from '../services/messaging-relays';

/**
 * NIP-17 messaging actions for the extension's own pages.
 *
 * These sign with the active account's key inside the background. The key never leaves it: a page
 * gets relay URLs and publish outcomes back, nothing else. They are not origin-scoped, so a website
 * cannot reach them through the provider.
 */

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
