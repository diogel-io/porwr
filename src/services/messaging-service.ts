import { sendBexMessage } from './vault-service';
import type { DmRelayList, DmRelayPublishResult } from '@/types/messaging';

/**
 * Page-side access to NIP-17 messaging. Every call goes to the background, which holds the key;
 * nothing here signs or decrypts.
 */

function errorOf(value: unknown): string | null {
  if (value && typeof value === 'object' && 'success' in value && (value as { success?: unknown }).success === false) {
    const error = (value as { error?: unknown }).error;
    return typeof error === 'string' ? error : 'Request failed';
  }
  return null;
}

export async function getDmRelays(): Promise<DmRelayList> {
  const response = await sendBexMessage('messaging.dmRelays.get');
  const error = errorOf(response);
  if (error) throw new Error(error);
  if (!response || !('relays' in response) || !Array.isArray(response.relays)) {
    throw new Error('Invalid direct message relay response');
  }
  return response;
}

export async function publishDmRelays(relays: string[]): Promise<DmRelayPublishResult> {
  const response = await sendBexMessage('messaging.dmRelays.publish', { relays });
  const error = errorOf(response);
  if (error) throw new Error(error);
  if (!response || !('accepted' in response)) {
    throw new Error('Invalid direct message relay publish response');
  }
  return response;
}
