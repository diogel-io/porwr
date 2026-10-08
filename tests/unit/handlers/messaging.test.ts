import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPublicKey } from 'nostr-tools';

const SECRET_KEY = new Uint8Array(32).fill(1);

const mocks = vi.hoisted(() => ({
  getActiveSecretKey: vi.fn(),
  fetchDmRelays: vi.fn(),
  publishDmRelays: vi.fn(),
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

import { handleDmRelaysGet, handleDmRelaysPublish } from '@/../src-bex/handlers/messaging';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActiveSecretKey.mockResolvedValue(SECRET_KEY);
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
