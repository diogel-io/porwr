import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoredKey } from '@/types';

const mockIsVaultUnlocked = vi.fn();
const mockGetVaultData = vi.fn();
const mockUpdateVaultData = vi.fn();
const mockStorageGet = vi.fn();
const mockStorageSet = vi.fn();
const mockApprovalModify = vi.fn();
const mockExceptionModify = vi.fn();

vi.mock('@/services/vault-service', () => ({
  isVaultUnlocked: mockIsVaultUnlocked,
  getVaultData: mockGetVaultData,
  updateVaultData: mockUpdateVaultData,
}));

vi.mock('@/services/storage-service', () => ({
  NOSTR_ACTIVE: 'NOSTR_ACTIVE',
  storageService: {
    get: mockStorageGet,
    set: mockStorageSet,
  },
}));

vi.mock('@/services/database', () => ({
  db: {
    approvals: {
      where: vi.fn().mockReturnThis(),
      equals: vi.fn().mockReturnThis(),
      modify: mockApprovalModify,
    },
    exceptions: {
      where: vi.fn().mockReturnThis(),
      equals: vi.fn().mockReturnThis(),
      modify: mockExceptionModify,
    },
  },
}));

describe('dexie-storage renameAlias', () => {
  const baseKey: StoredKey = {
    id: 'pubkey-hex',
    alias: 'alpha',
    account: { privkey: 'secret' },
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsVaultUnlocked.mockResolvedValue(true);
    mockStorageGet.mockResolvedValue('alpha');
    mockApprovalModify.mockResolvedValue(1);
    mockExceptionModify.mockResolvedValue(1);
    mockGetVaultData.mockResolvedValue({
      success: true,
      vaultData: {
        accounts: [structuredClone(baseKey)],
      },
    });
  });

  it('renames alias, keeps key material unchanged, updates active alias, and migrates logs', async () => {
    const { renameAlias } = await import('@/services/dexie-storage');

    await renameAlias('alpha', '  beta  ');

    expect(mockUpdateVaultData).toHaveBeenCalledTimes(1);
    expect(mockUpdateVaultData).toHaveBeenCalledWith({
      accounts: [
        {
          id: 'pubkey-hex',
          alias: 'beta',
          account: { privkey: 'secret' },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(mockStorageSet).toHaveBeenCalledWith('NOSTR_ACTIVE', 'beta');
    expect(mockApprovalModify).toHaveBeenCalledWith({ account: 'beta' });
    expect(mockExceptionModify).toHaveBeenCalledWith({ account: 'beta' });
  });

  it('rejects empty aliases after trimming', async () => {
    const { renameAlias } = await import('@/services/dexie-storage');

    await expect(renameAlias('alpha', '   ')).rejects.toThrow('Alias is required.');
    expect(mockUpdateVaultData).not.toHaveBeenCalled();
  });

  it('rejects reserved alias', async () => {
    const { renameAlias } = await import('@/services/dexie-storage');

    await expect(renameAlias('alpha', 'Main Account')).rejects.toThrow('Alias "Main Account" is reserved.');
    expect(mockUpdateVaultData).not.toHaveBeenCalled();
  });

  it('rejects duplicate alias', async () => {
    mockGetVaultData.mockResolvedValue({
      success: true,
      vaultData: {
        accounts: [
          structuredClone(baseKey),
          {
            id: 'other-id',
            alias: 'beta',
            account: { privkey: 'other-secret' },
            createdAt: '2026-02-01T00:00:00.000Z',
          },
        ],
      },
    });

    const { renameAlias } = await import('@/services/dexie-storage');

    await expect(renameAlias('alpha', 'beta')).rejects.toThrow('Key with the same alias already exists.');
    expect(mockUpdateVaultData).not.toHaveBeenCalled();
  });
});

describe('dexie-storage get', () => {
  const baseKey: StoredKey = {
    id: 'pubkey-hex',
    alias: 'alpha',
    account: { privkey: 'secret' },
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty object when the vault is locked', async () => {
    mockIsVaultUnlocked.mockResolvedValue(false);

    const { get } = await import('@/services/dexie-storage');

    await expect(get()).resolves.toEqual({});
    expect(mockGetVaultData).not.toHaveBeenCalled();
  });

  it('returns accounts keyed by alias when unlocked', async () => {
    mockIsVaultUnlocked.mockResolvedValue(true);
    mockGetVaultData.mockResolvedValue({ success: true, vaultData: { accounts: [baseKey] } });

    const { get } = await import('@/services/dexie-storage');

    await expect(get()).resolves.toEqual({ alpha: baseKey });
  });

  it('returns an empty object when getVaultData fails', async () => {
    mockIsVaultUnlocked.mockResolvedValue(true);
    mockGetVaultData.mockResolvedValue({ success: false });

    const { get } = await import('@/services/dexie-storage');

    await expect(get()).resolves.toEqual({});
  });
});

describe('dexie-storage getActive / setActive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getActive reads the active alias from storage', async () => {
    mockStorageGet.mockResolvedValue('alpha');

    const { getActive } = await import('@/services/dexie-storage');

    await expect(getActive()).resolves.toBe('alpha');
    expect(mockStorageGet).toHaveBeenCalledWith('NOSTR_ACTIVE');
  });

  it('setActive writes the alias to storage', async () => {
    const { setActive } = await import('@/services/dexie-storage');

    await setActive('beta');

    expect(mockStorageSet).toHaveBeenCalledWith('NOSTR_ACTIVE', 'beta');
  });
});

describe('dexie-storage save', () => {
  const baseKey: StoredKey = {
    id: 'pubkey-hex',
    alias: 'alpha',
    account: { privkey: 'secret' },
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsVaultUnlocked.mockResolvedValue(true);
    mockStorageSet.mockResolvedValue(undefined);
  });

  it('rejects when the vault is locked', async () => {
    mockIsVaultUnlocked.mockResolvedValue(false);

    const { save } = await import('@/services/dexie-storage');

    await expect(save(baseKey)).rejects.toThrow('Vault is locked. Cannot save key.');
    expect(mockUpdateVaultData).not.toHaveBeenCalled();
  });

  it('rejects a duplicate alias', async () => {
    mockGetVaultData.mockResolvedValue({ success: true, vaultData: { accounts: [structuredClone(baseKey)] } });

    const { save } = await import('@/services/dexie-storage');

    await expect(save({ ...baseKey, id: 'different-id' })).rejects.toThrow(
      'Key with the same alias already exists.',
    );
  });

  it('rejects a duplicate id (npub)', async () => {
    mockGetVaultData.mockResolvedValue({ success: true, vaultData: { accounts: [structuredClone(baseKey)] } });

    const { save } = await import('@/services/dexie-storage');

    await expect(save({ ...baseKey, alias: 'different-alias' })).rejects.toThrow(
      'Key with the same npub already exists.',
    );
  });

  it('appends the new key and sets it active', async () => {
    mockGetVaultData.mockResolvedValue({ success: true, vaultData: { accounts: [] } });

    const { save } = await import('@/services/dexie-storage');
    await save(baseKey);

    expect(mockUpdateVaultData).toHaveBeenCalledWith({ accounts: [baseKey] });
    expect(mockStorageSet).toHaveBeenCalledWith('NOSTR_ACTIVE', 'alpha');
  });
});

describe('dexie-storage remove', () => {
  const baseKey: StoredKey = {
    id: 'pubkey-hex',
    alias: 'alpha',
    account: { privkey: 'secret' },
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsVaultUnlocked.mockResolvedValue(true);
  });

  it('rejects when the vault is locked', async () => {
    mockIsVaultUnlocked.mockResolvedValue(false);

    const { remove } = await import('@/services/dexie-storage');

    await expect(remove('pubkey-hex')).rejects.toThrow('Vault is locked. Cannot remove key.');
  });

  it('removes the matching account by id', async () => {
    mockGetVaultData.mockResolvedValue({ success: true, vaultData: { accounts: [structuredClone(baseKey)] } });

    const { remove } = await import('@/services/dexie-storage');
    await remove('pubkey-hex');

    expect(mockUpdateVaultData).toHaveBeenCalledWith({ accounts: [] });
  });

  it('is a no-op when the id is not found', async () => {
    mockGetVaultData.mockResolvedValue({ success: true, vaultData: { accounts: [structuredClone(baseKey)] } });

    const { remove } = await import('@/services/dexie-storage');
    await remove('does-not-exist');

    expect(mockUpdateVaultData).not.toHaveBeenCalled();
  });
});
