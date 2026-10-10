import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Accounts from a page's side (#240).
 *
 * The page reads a view with no secrets in it and asks the background for one change at a time. The
 * rules those changes follow (aliases, duplicates, log migration) are the background's, and are
 * tested with `src-bex/handlers/accounts.ts`.
 */

const mocks = vi.hoisted(() => ({
  isVaultUnlocked: vi.fn(),
  getVaultView: vi.fn(),
  sendBexMessage: vi.fn(),
  storageGet: vi.fn(),
  storageSet: vi.fn(),
}));

vi.mock('@/services/vault-service', () => ({
  isVaultUnlocked: mocks.isVaultUnlocked,
  getVaultView: mocks.getVaultView,
  sendBexMessage: mocks.sendBexMessage,
}));

vi.mock('@/services/storage-service', () => ({
  NOSTR_ACTIVE: 'NOSTR_ACTIVE',
  storageService: { get: mocks.storageGet, set: mocks.storageSet },
}));

import { get, getActive, remove, renameAlias, revealSecret, save, setActive } from '@/services/dexie-storage';

const ALICE = { id: 'a'.repeat(64), alias: 'alice', createdAt: '2026-01-01' };
const BOB = { id: 'b'.repeat(64), alias: 'bob', createdAt: '2026-01-02' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isVaultUnlocked.mockResolvedValue(true);
});

describe('dexie-storage get', () => {
  it('returns an empty object when the vault is locked, without asking the background', async () => {
    mocks.isVaultUnlocked.mockResolvedValue(false);

    await expect(get()).resolves.toEqual({});
    expect(mocks.getVaultView).not.toHaveBeenCalled();
  });

  it('returns the view’s accounts keyed by alias', async () => {
    mocks.getVaultView.mockResolvedValue({ accounts: [ALICE, BOB] });

    await expect(get()).resolves.toEqual({ alice: ALICE, bob: BOB });
  });

  it('returns an empty object when the view cannot be read', async () => {
    mocks.getVaultView.mockRejectedValue(new Error('Vault is locked'));

    await expect(get()).resolves.toEqual({});
  });
});

describe('dexie-storage getActive / setActive', () => {
  it('reads and writes the active alias in extension storage', async () => {
    mocks.storageGet.mockResolvedValue('alice');

    await expect(getActive()).resolves.toBe('alice');
    await setActive('bob');

    expect(mocks.storageSet).toHaveBeenCalledWith('NOSTR_ACTIVE', 'bob');
  });
});

describe('dexie-storage save', () => {
  it('rejects when the vault is locked', async () => {
    mocks.isVaultUnlocked.mockResolvedValue(false);

    await expect(save({ alias: 'alice' })).rejects.toThrow('Vault is locked');
    expect(mocks.sendBexMessage).not.toHaveBeenCalled();
  });

  it('asks the background to add the account, then makes it active', async () => {
    mocks.sendBexMessage.mockResolvedValue(ALICE);

    await expect(save({ alias: 'alice' })).resolves.toEqual(ALICE);

    expect(mocks.sendBexMessage).toHaveBeenCalledWith('accounts.add', { alias: 'alice' });
    expect(mocks.storageSet).toHaveBeenCalledWith('NOSTR_ACTIVE', 'alice');
  });

  it('passes an imported key in, once', async () => {
    mocks.sendBexMessage.mockResolvedValue(ALICE);

    await save({ alias: 'alice', privkey: 'c'.repeat(64) });

    expect(mocks.sendBexMessage).toHaveBeenCalledWith('accounts.add', { alias: 'alice', privkey: 'c'.repeat(64) });
  });

  it('surfaces the background’s refusal and does not change the active account', async () => {
    mocks.sendBexMessage.mockResolvedValue({ success: false, error: 'Key with the same alias already exists.' });

    await expect(save({ alias: 'alice' })).rejects.toThrow('Key with the same alias already exists.');
    expect(mocks.storageSet).not.toHaveBeenCalled();
  });
});

describe('dexie-storage renameAlias', () => {
  it('asks the background to rename', async () => {
    mocks.sendBexMessage.mockResolvedValue({ ...ALICE, alias: 'alicia' });

    await renameAlias('alice', 'alicia');

    expect(mocks.sendBexMessage).toHaveBeenCalledWith('accounts.rename', { currentAlias: 'alice', newAlias: 'alicia' });
  });

  it('surfaces the background’s refusal', async () => {
    mocks.sendBexMessage.mockResolvedValue({ success: false, error: 'Alias "Main Account" is reserved.' });

    await expect(renameAlias('alice', 'Main Account')).rejects.toThrow('reserved');
  });

  it('rejects when the vault is locked', async () => {
    mocks.isVaultUnlocked.mockResolvedValue(false);
    await expect(renameAlias('alice', 'alicia')).rejects.toThrow('Vault is locked');
  });
});

describe('dexie-storage remove', () => {
  it('asks the background to remove the account by its public key', async () => {
    mocks.sendBexMessage.mockResolvedValue(true);

    await remove(ALICE.id);

    expect(mocks.sendBexMessage).toHaveBeenCalledWith('accounts.remove', { accountPubkey: ALICE.id });
  });

  it('treats an account that was already gone as done', async () => {
    mocks.sendBexMessage.mockResolvedValue(false);
    await expect(remove(ALICE.id)).resolves.toBeUndefined();
  });

  it('surfaces a refusal', async () => {
    mocks.sendBexMessage.mockResolvedValue({ success: false, error: 'Vault is locked' });
    await expect(remove(ALICE.id)).rejects.toThrow('Vault is locked');
  });
});

describe('dexie-storage revealSecret', () => {
  it('returns the one nsec the background revealed', async () => {
    mocks.sendBexMessage.mockResolvedValue({ nsec: 'nsec1abc' });

    await expect(revealSecret(ALICE.id)).resolves.toBe('nsec1abc');
    expect(mocks.sendBexMessage).toHaveBeenCalledWith('accounts.revealSecret', { accountPubkey: ALICE.id });
  });

  it('surfaces a refusal', async () => {
    mocks.sendBexMessage.mockResolvedValue({ success: false, error: 'Account not found' });
    await expect(revealSecret(ALICE.id)).rejects.toThrow('Account not found');
  });
});
