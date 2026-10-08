import { sendBexMessage } from './vault-service';
import type {
  DmRelayList,
  DmRelayPublishResult,
  FetchMessagesResult,
  MessagingReadState,
  SendMessageRequest,
  SendMessageResult,
} from '@/types/messaging';

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

export async function sendMessage(request: SendMessageRequest): Promise<SendMessageResult> {
  const response = await sendBexMessage('messaging.send', request);
  const error = errorOf(response);
  if (error) throw new Error(error);
  if (!response || !('status' in response)) {
    throw new Error('Invalid send response');
  }
  return response;
}

export async function fetchMessages(since?: number): Promise<FetchMessagesResult> {
  const response = await sendBexMessage('messaging.fetch', since === undefined ? {} : { since });
  const error = errorOf(response);
  if (error) throw new Error(error);
  if (!response || !('inbox' in response) || !Array.isArray(response.messages)) {
    throw new Error('Invalid fetch response');
  }
  return response;
}

export async function getReadState(): Promise<MessagingReadState> {
  const response = await sendBexMessage('messaging.readState');
  const error = errorOf(response);
  if (error) throw new Error(error);
  return response && typeof response === 'object' ? (response as MessagingReadState) : {};
}

export async function markConversationRead(peer: string, readAt: number): Promise<MessagingReadState> {
  const response = await sendBexMessage('messaging.markRead', { peer, readAt });
  const error = errorOf(response);
  if (error) throw new Error(error);
  return response && typeof response === 'object' ? (response as MessagingReadState) : {};
}
