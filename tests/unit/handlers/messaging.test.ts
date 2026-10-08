import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPublicKey } from 'nostr-tools';

const SECRET_KEY = new Uint8Array(32).fill(1);

const mocks = vi.hoisted(() => ({
  getActiveSecretKey: vi.fn(),
  fetchDmRelays: vi.fn(),
  publishDmRelays: vi.fn(),
  send: vi.fn(),
  fetch: vi.fn(),
  clear: vi.fn(),
  getVaultData: vi.fn(),
  updateVaultData: vi.fn(),
  lockListeners: [] as (() => void)[],
}));

vi.mock('@/../src-bex/vault', () => ({
  getVaultData: mocks.getVaultData,
  updateVaultData: mocks.updateVaultData,
  onVaultLocked: (listener: () => void) => {
    mocks.lockListeners.push(listener);
    return () => undefined;
  },
}));

vi.mock('@/../src-bex/services/nip17-messaging', () => ({
  nip17Messaging: { send: mocks.send, fetch: mocks.fetch, clear: mocks.clear },
}));

vi.mock('@/../src-bex/handlers/active-key', () => ({ getActiveSecretKey: mocks.getActiveSecretKey }));

vi.mock('@/../src-bex/services/messaging-relays', async () => {
  const actual = await vi.importActual<typeof import('@/../src-bex/services/messaging-relays')>(
    '@/../src-bex/services/messaging-relays',
  );
  return {
    ...actual,
    messagingRelays: { fetchDmRelays: mocks.fetchDmRelays, publishDmRelays: mocks.publishDmRelays },
  };
});

import {
  handleDmRelaysGet,
  handleDmRelaysPublish,
  handleMessagesFetch,
  handleMessagesMarkRead,
  handleMessagesReadState,
  handleMessagesSend,
} from '@/../src-bex/handlers/messaging';

const ME = getPublicKey(SECRET_KEY);
const PEER = 'b'.repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActiveSecretKey.mockResolvedValue(SECRET_KEY);
  mocks.getVaultData.mockResolvedValue({ success: true, vaultData: { accounts: [] } });
  mocks.updateVaultData.mockResolvedValue({ success: true });
});

describe('handleDmRelaysGet', () => {
  it('looks up the active account by its public key and returns only relay data', async () => {
    mocks.fetchDmRelays.mockResolvedValue({ relays: ['wss://inbox.example'], updatedAt: 5 });

    await expect(handleDmRelaysGet()).resolves.toEqual({
      success: true,
      data: { relays: ['wss://inbox.example'], updatedAt: 5 },
    });
    expect(mocks.fetchDmRelays).toHaveBeenCalledWith(getPublicKey(SECRET_KEY));
  });

  it('fails when the vault is locked', async () => {
    mocks.getActiveSecretKey.mockRejectedValue(new Error('Vault is locked'));
    await expect(handleDmRelaysGet()).rejects.toThrow('Vault is locked');
  });
});

describe('handleDmRelaysPublish', () => {
  it('signs with the active key inside the background and returns the outcome', async () => {
    const outcome = { relays: ['wss://inbox.example'], accepted: ['wss://inbox.example'], rejected: [] };
    mocks.publishDmRelays.mockResolvedValue(outcome);

    await expect(handleDmRelaysPublish({ relays: ['wss://inbox.example/'] })).resolves.toEqual({
      success: true,
      data: outcome,
    });
    expect(mocks.publishDmRelays).toHaveBeenCalledWith(SECRET_KEY, ['wss://inbox.example']);
  });

  it('refuses a list with an invalid relay without signing anything', async () => {
    const result = await handleDmRelaysPublish({ relays: ['https://web.example'] });

    expect(result.success).toBe(false);
    expect(mocks.getActiveSecretKey).not.toHaveBeenCalled();
    expect(mocks.publishDmRelays).not.toHaveBeenCalled();
  });

  it('fails when no relay accepted the list', async () => {
    mocks.publishDmRelays.mockResolvedValue({
      relays: ['wss://inbox.example'],
      accepted: [],
      rejected: [{ url: 'wss://inbox.example', reason: 'timeout' }],
    });

    const result = await handleDmRelaysPublish({ relays: ['wss://inbox.example'] });

    expect(result).toMatchObject({ success: false, error: 'No relay accepted the direct message relay list' });
  });
});

describe('handleMessagesSend', () => {
  const valid = { clientMessageId: 'msg-1', recipient: PEER, content: 'hello' };

  it('sends with the active key and returns the outcome', async () => {
    mocks.send.mockResolvedValue({ status: 'recipient-not-ready' });

    await expect(handleMessagesSend(valid)).resolves.toEqual({ success: true, data: { status: 'recipient-not-ready' } });
    expect(mocks.send).toHaveBeenCalledWith(SECRET_KEY, valid);
  });

  it.each([
    ['a missing client message id', { ...valid, clientMessageId: '' }],
    ['a recipient that is not a hex key', { ...valid, recipient: 'npub1abc' }],
    ['an empty message', { ...valid, content: '   ' }],
    ['a message over the length limit', { ...valid, content: 'x'.repeat(16_001) }],
  ])('refuses %s before touching the key', async (_label, payload) => {
    const result = await handleMessagesSend(payload);

    expect(result.success).toBe(false);
    expect(mocks.getActiveSecretKey).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('refuses a message to the active account itself', async () => {
    await expect(handleMessagesSend({ ...valid, recipient: ME })).resolves.toMatchObject({ success: false });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe('handleMessagesFetch', () => {
  it('fetches with the active key, passing a numeric since through', async () => {
    mocks.fetch.mockResolvedValue({ inbox: 'ready', messages: [], dropped: 0 });

    await handleMessagesFetch({ since: 42 });

    expect(mocks.fetch).toHaveBeenCalledWith(SECRET_KEY, { since: 42 });
  });

  it('ignores a since that is not a number', async () => {
    mocks.fetch.mockResolvedValue({ inbox: 'ready', messages: [], dropped: 0 });

    await handleMessagesFetch({ since: 'yesterday' as unknown as number });

    expect(mocks.fetch).toHaveBeenCalledWith(SECRET_KEY, {});
  });
});

describe('read state', () => {
  it("returns the active account's read state from the vault", async () => {
    mocks.getVaultData.mockResolvedValue({
      success: true,
      vaultData: { accounts: [], messagingReadState: { [ME]: { [PEER]: 9 }, other: { [PEER]: 1 } } },
    });

    await expect(handleMessagesReadState()).resolves.toEqual({ success: true, data: { [PEER]: 9 } });
  });

  it('saves a conversation as read inside the vault', async () => {
    await expect(handleMessagesMarkRead({ peer: PEER, readAt: 10 })).resolves.toEqual({
      success: true,
      data: { [PEER]: 10 },
    });
    expect(mocks.updateVaultData).toHaveBeenCalledWith(
      expect.objectContaining({ messagingReadState: { [ME]: { [PEER]: 10 } } }),
    );
  });

  it('does not write when nothing changes', async () => {
    mocks.getVaultData.mockResolvedValue({
      success: true,
      vaultData: { accounts: [], messagingReadState: { [ME]: { [PEER]: 20 } } },
    });

    await handleMessagesMarkRead({ peer: PEER, readAt: 10 });

    expect(mocks.updateVaultData).not.toHaveBeenCalled();
  });

  it('refuses an invalid peer or timestamp', async () => {
    await expect(handleMessagesMarkRead({ peer: 'nope', readAt: 1 })).resolves.toMatchObject({ success: false });
    await expect(handleMessagesMarkRead({ peer: PEER, readAt: -1 })).resolves.toMatchObject({ success: false });
  });

  it('fails while the vault is locked', async () => {
    mocks.getVaultData.mockResolvedValue({ success: false, error: 'Vault is locked' });

    await expect(handleMessagesReadState()).rejects.toThrow('Vault is locked');
  });
});

describe('vault lock', () => {
  it('drops decrypted messages when the vault locks', () => {
    expect(mocks.lockListeners).toHaveLength(1);

    mocks.lockListeners[0]!();

    expect(mocks.clear).toHaveBeenCalledTimes(1);
  });
});
