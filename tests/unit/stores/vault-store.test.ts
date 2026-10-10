import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import useVaultStore from '@/stores/vault-store';

const { mockCreateVault, mockHasVault, mockLockVault, mockUnlockVault, mockStorageGet, mockOnChanged } = vi.hoisted(
  () => ({
    mockCreateVault: vi.fn(),
    mockHasVault: vi.fn(),
    mockLockVault: vi.fn(),
    mockUnlockVault: vi.fn(),
    mockStorageGet: vi.fn(),
    mockOnChanged: vi.fn(),
  }),
);

vi.mock('@/services/vault-service', () => ({
  createVault: mockCreateVault,
  hasVault: mockHasVault,
  lockVault: mockLockVault,
  unlockVault: mockUnlockVault,
}));

vi.mock('@/services/storage-service', () => ({
  VAULT_UNLOCKED: 'VAULT_UNLOCKED',
  storageService: { get: mockStorageGet, onChanged: mockOnChanged },
}));

describe('vault-store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('starts locked, with no vault, not loading', () => {
    const store = useVaultStore();
    expect(store.isUnlocked).toBe(false);
    expect(store.vaultExists).toBe(false);
    expect(store.isLoading).toBe(false);
    expect(store.lastLockReason).toBeNull();
  });

  describe('checkVaultStatus', () => {
    it('reflects vault existence and unlocked state from the background', async () => {
      mockHasVault.mockResolvedValue(true);
      mockStorageGet.mockResolvedValue(true);

      const store = useVaultStore();
      await store.checkVaultStatus();

      expect(store.vaultExists).toBe(true);
      expect(store.isUnlocked).toBe(true);
      expect(mockStorageGet).toHaveBeenCalledWith('VAULT_UNLOCKED', 'session');
    });

    it('leaves state unchanged and logs when the check fails', async () => {
      mockHasVault.mockRejectedValue(new Error('db unavailable'));
      mockStorageGet.mockResolvedValue(false);

      const store = useVaultStore();
      await expect(store.checkVaultStatus()).resolves.toBeUndefined();

      expect(store.vaultExists).toBe(false);
      expect(store.isUnlocked).toBe(false);
    });
  });

  describe('unlock', () => {
    it('marks the vault unlocked and clears the lock reason on success', async () => {
      mockUnlockVault.mockResolvedValue({ success: true, vaultData: { accounts: [] } });

      const store = useVaultStore();
      store.lastLockReason = 'inactivity';
      const result = await store.unlock('correct-password');

      expect(result).toEqual({ success: true });
      expect(store.isUnlocked).toBe(true);
      expect(store.lastLockReason).toBeNull();
    });

    it('returns the failure result without changing unlocked state', async () => {
      mockUnlockVault.mockResolvedValue({ success: false, error: 'Invalid password', code: 'VLT_INVALID_PASSWORD' });

      const store = useVaultStore();
      const result = await store.unlock('wrong-password');

      expect(result).toEqual({ success: false, error: 'Invalid password', errorCode: 'VLT_INVALID_PASSWORD' });
      expect(store.isUnlocked).toBe(false);
    });
  });

  describe('lock', () => {
    it('locks the vault and records the reason (defaulting to manual)', async () => {
      mockLockVault.mockResolvedValue(undefined);
      const store = useVaultStore();
      store.isUnlocked = true;

      await store.lock();

      expect(mockLockVault).toHaveBeenCalledTimes(1);
      expect(store.isUnlocked).toBe(false);
      expect(store.lastLockReason).toBe('manual');
    });

    it('records a non-default lock reason when given one', async () => {
      mockLockVault.mockResolvedValue(undefined);
      const store = useVaultStore();

      await store.lock('inactivity');

      expect(store.lastLockReason).toBe('inactivity');
    });
  });

  describe('create', () => {
    it('creates the vault with no accounts, which are added through the background (#240)', async () => {
      mockCreateVault.mockResolvedValue({ success: true, encryptedVault: 'v2:abc' });
      const store = useVaultStore();

      const result = await store.create('pw', 'mnemonic words', 'passphrase');

      expect(result).toEqual({ success: true });
      expect(store.vaultExists).toBe(true);
      expect(store.isUnlocked).toBe(true);
      const [, vaultData] = mockCreateVault.mock.calls[0] as [string, { mnemonic: string; passphrase: string; accounts: unknown[] }];
      expect(vaultData.mnemonic).toBe('mnemonic words');
      expect(vaultData.passphrase).toBe('passphrase');
      expect(vaultData.accounts).toEqual([]);
    });

    it('creates the vault with no initial account and an empty passphrase by default', async () => {
      mockCreateVault.mockResolvedValue({ success: true });
      const store = useVaultStore();

      await store.create('pw', 'mnemonic words');

      const [, vaultData] = mockCreateVault.mock.calls[0] as [string, { passphrase: string; accounts: unknown[] }];
      expect(vaultData.passphrase).toBe('');
      expect(vaultData.accounts).toEqual([]);
    });

    it('returns the failure result without marking the vault as existing', async () => {
      mockCreateVault.mockResolvedValue({ success: false, error: 'boom', code: 'GEN_UNKNOWN' });
      const store = useVaultStore();

      const result = await store.create('pw', 'mnemonic words');

      expect(result).toEqual({ success: false, error: 'boom', errorCode: 'GEN_UNKNOWN' });
      expect(store.vaultExists).toBe(false);
    });
  });

  describe('listenToLockChanges', () => {
    it('updates isUnlocked and records a background lock reason when locked remotely', () => {
      const store = useVaultStore();
      store.isUnlocked = true;

      store.listenToLockChanges();
      const listener = mockOnChanged.mock.calls[0]?.[0] as (
        changes: Record<string, { newValue?: unknown }>,
        areaName: string,
      ) => void;
      listener({ VAULT_UNLOCKED: { newValue: false } }, 'session');

      expect(store.isUnlocked).toBe(false);
      expect(store.lastLockReason).toBe('background');
    });

    it('ignores changes outside the session storage area', () => {
      const store = useVaultStore();
      store.isUnlocked = true;

      store.listenToLockChanges();
      const listener = mockOnChanged.mock.calls[0]?.[0] as (
        changes: Record<string, { newValue?: unknown }>,
        areaName: string,
      ) => void;
      listener({ VAULT_UNLOCKED: { newValue: false } }, 'local');

      expect(store.isUnlocked).toBe(true);
    });
  });
});
