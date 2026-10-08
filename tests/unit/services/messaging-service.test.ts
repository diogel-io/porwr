import { describe, it, expect, vi, beforeEach } from 'vitest';

const send = vi.hoisted(() => vi.fn());
vi.mock('@/services/vault-service', () => ({ sendBexMessage: send }));

import {
  fetchMessages,
  getDmRelays,
  getReadState,
  markConversationRead,
  publishDmRelays,
  sendMessage,
} from '@/services/messaging-service';

beforeEach(() => {
  send.mockReset();
});

describe('messaging-service', () => {
  it('reads the DM relay list', async () => {
    send.mockResolvedValue({ relays: ['wss://a'], updatedAt: 1 });
    await expect(getDmRelays()).resolves.toEqual({ relays: ['wss://a'], updatedAt: 1 });
    expect(send).toHaveBeenCalledWith('messaging.dmRelays.get');
  });

  it('publishes the DM relay list', async () => {
    send.mockResolvedValue({ relays: ['wss://a'], accepted: ['wss://a'], rejected: [] });
    await expect(publishDmRelays(['wss://a'])).resolves.toMatchObject({ accepted: ['wss://a'] });
    expect(send).toHaveBeenCalledWith('messaging.dmRelays.publish', { relays: ['wss://a'] });
  });

  it('sends a message', async () => {
    send.mockResolvedValue({ status: 'recipient-not-ready' });
    const request = { clientMessageId: 'c', recipient: 'b'.repeat(64), content: 'hi' };
    await expect(sendMessage(request)).resolves.toEqual({ status: 'recipient-not-ready' });
    expect(send).toHaveBeenCalledWith('messaging.send', request);
  });

  it('fetches messages, passing since only when given', async () => {
    send.mockResolvedValue({ inbox: 'ready', messages: [], dropped: 0 });
    await fetchMessages();
    await fetchMessages(5);
    expect(send).toHaveBeenNthCalledWith(1, 'messaging.fetch', {});
    expect(send).toHaveBeenNthCalledWith(2, 'messaging.fetch', { since: 5 });
  });

  it('reads and writes read state', async () => {
    send.mockResolvedValue({ b: 3 });
    await expect(getReadState()).resolves.toEqual({ b: 3 });
    await expect(markConversationRead('b', 3)).resolves.toEqual({ b: 3 });
    expect(send).toHaveBeenLastCalledWith('messaging.markRead', { peer: 'b', readAt: 3 });
  });

  it.each([
    ['getDmRelays', () => getDmRelays()],
    ['publishDmRelays', () => publishDmRelays([])],
    ['sendMessage', () => sendMessage({ clientMessageId: 'c', recipient: 'b', content: 'x' })],
    ['fetchMessages', () => fetchMessages()],
    ['getReadState', () => getReadState()],
    ['markConversationRead', () => markConversationRead('b', 1)],
  ])('%s turns a background refusal into an error', async (_name, call) => {
    send.mockResolvedValue({ success: false, error: 'Vault is locked' });
    await expect(call()).rejects.toThrow('Vault is locked');
  });

  it.each([
    ['getDmRelays', () => getDmRelays()],
    ['publishDmRelays', () => publishDmRelays([])],
    ['sendMessage', () => sendMessage({ clientMessageId: 'c', recipient: 'b', content: 'x' })],
    ['fetchMessages', () => fetchMessages()],
  ])('%s rejects a malformed answer', async (_name, call) => {
    send.mockResolvedValue(undefined);
    await expect(call()).rejects.toThrow(/Invalid/);
  });

  it('treats a missing read state answer as empty', async () => {
    send.mockResolvedValue(undefined);
    await expect(getReadState()).resolves.toEqual({});
    await expect(markConversationRead('b', 1)).resolves.toEqual({});
  });
});
