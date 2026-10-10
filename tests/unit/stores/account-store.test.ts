import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import useAccountStore from '@/stores/account-store';
import useVaultStore from '@/stores/vault-store';
import type { StoredKey } from '@/types';

const { mockSave, mockGet, mockGetActive, mockSetActive, mockRenameAlias, mockOnChanged } = vi.hoisted(() => ({
  mockSave: vi.fn(),
  mockGet: vi.fn(),
  mockGetActive: vi.fn(),
  mockSetActive: vi.fn(),
  mockRenameAlias: vi.fn(),
  mockOnChanged: vi.fn(),
}));

vi.mock('@/services/dexie-storage', () => ({
  save: mockSave,
  get: mockGet,
  getActive: mockGetActive,
  setActive: mockSetActive,
  renameAlias: mockRenameAlias,
}));

vi.mock('@/services/storage-service', () => ({
  NOSTR_ACTIVE: 'NOSTR_ACTIVE',
  VAULT_UNLOCKED: 'VAULT_UNLOCKED',
  storageService: { onChanged: mockOnChanged, get: vi.fn(), set: vi.fn() },
}));

vi.mock('@/services/vault-service', () => ({
  createVault: vi.fn(),
  hasVault: vi.fn(),
  lockVault: vi.fn(),
  unlockVault: vi.fn(),
}));

/** Puts the vault in the state `getKeys` now requires before it will read anything. */
function unlockVault(): void {
  useVaultStore().isUnlocked = true;
}

function buildKey(overrides: Partial<StoredKey> = {}): StoredKey {
  return {
    id: 'pubkey-hex',
    alias: 'alpha',
    account: { privkey: 'secret' },
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('account-store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('starts with no stored keys and no active alias', () => {
    const store = useAccountStore();
    expect(store.storedKeys.size).toBe(0);
    expect(store.activeKey).toBeUndefined();
  });

  describe('saveKey', () => {
    it('adds the account through the background and holds only its summary (#240)', async () => {
      const summary = { id: 'f'.repeat(64), alias: 'alpha', createdAt: '2026-01-01T00:00:00.000Z' };
      mockSave.mockResolvedValue(summary);
      const store = useAccountStore();

      await expect(store.saveKey({ alias: 'alpha', privkey: 'e'.repeat(64) })).resolves.toEqual(summary);

      expect(mockSave).toHaveBeenCalledWith({ alias: 'alpha', privkey: 'e'.repeat(64) });
      expect(Array.from(store.storedKeys)).toEqual([summary]);
      expect(JSON.stringify(Array.from(store.storedKeys))).not.toContain('e'.repeat(64));
      expect(store.activeKey).toBe('alpha');
    });

    it('propagates a save failure without adding the key', async () => {
      mockSave.mockRejectedValue(new Error('duplicate alias'));
      const store = useAccountStore();

      await expect(store.saveKey({ alias: 'alpha' })).rejects.toThrow('duplicate alias');
      expect(store.storedKeys.size).toBe(0);
    });
  });

  describe('getKeys', () => {
    it('loads stored keys and the active alias from the vault', async () => {
      const alpha = buildKey({ alias: 'alpha' });
      const beta = buildKey({ id: 'pubkey-hex-2', alias: 'beta' });
      mockGet.mockResolvedValue({ alpha, beta });
      mockGetActive.mockResolvedValue('alpha');
      unlockVault();

      const store = useAccountStore();
      await store.getKeys();

      expect(store.storedKeys).toEqual(new Set([alpha, beta]));
      expect(store.activeKey).toBe('alpha');
    });
  });

  describe('setActiveKey', () => {
    it('updates the active alias locally and persists it', async () => {
      mockSetActive.mockResolvedValue(undefined);
      const store = useAccountStore();

      await store.setActiveKey('beta');

      expect(store.activeKey).toBe('beta');
      expect(mockSetActive).toHaveBeenCalledWith('beta');
    });
  });

  describe('renameKeyAlias', () => {
    it('renames the alias, reloads keys, and updates the active alias if it was renamed', async () => {
      mockRenameAlias.mockResolvedValue(undefined);
      const renamed = buildKey({ alias: 'beta' });
      mockGet.mockResolvedValue({ beta: renamed });
      mockGetActive.mockResolvedValue('beta');
      unlockVault();

      const store = useAccountStore();
      store.activeKey = 'alpha';

      await store.renameKeyAlias('alpha', 'beta');

      expect(mockRenameAlias).toHaveBeenCalledWith('alpha', 'beta');
      expect(store.storedKeys).toEqual(new Set([renamed]));
      expect(store.activeKey).toBe('beta');
    });

    it('does not touch the active alias when a different key was renamed', async () => {
      mockRenameAlias.mockResolvedValue(undefined);
      mockGet.mockResolvedValue({});
      mockGetActive.mockResolvedValue('gamma');
      unlockVault();

      const store = useAccountStore();
      store.activeKey = 'gamma';

      await store.renameKeyAlias('alpha', 'beta');

      expect(store.activeKey).toBe('gamma');
    });
  });

  describe('listenToStorageChanges', () => {
    it('registers a storage listener only once', () => {
      const store = useAccountStore();

      store.listenToStorageChanges();
      store.listenToStorageChanges();

      expect(mockOnChanged).toHaveBeenCalledTimes(1);
    });

    it('reloads keys when NOSTR_ACTIVE changes in local storage', () => {
      mockGet.mockResolvedValue({});
      mockGetActive.mockResolvedValue(undefined);
      unlockVault();
      const store = useAccountStore();

      store.listenToStorageChanges();
      const listener = mockOnChanged.mock.calls[0]?.[0] as (
        changes: Record<string, unknown>,
        areaName: string,
      ) => void;
      listener({ NOSTR_ACTIVE: { newValue: 'alpha' } }, 'local');

      expect(mockGet).toHaveBeenCalled();
    });

    it('ignores changes in other storage areas', () => {
      const store = useAccountStore();

      store.listenToStorageChanges();
      const listener = mockOnChanged.mock.calls[0]?.[0] as (
        changes: Record<string, unknown>,
        areaName: string,
      ) => void;
      listener({ NOSTR_ACTIVE: { newValue: 'alpha' } }, 'session');

      expect(mockGet).not.toHaveBeenCalled();
    });
  });

  /**
   * #211.
   *
   * `dexie-storage.get()` answers `{}` for a locked vault rather than refusing, so reading one
   * records a confident and wrong "this vault holds no accounts". Nine surfaces call `getKeys` on
   * mount and several can be reached while locked, so the guard lives here rather than at each of
   * them.
   */
  describe('reading a locked vault', () => {
    it('does not read the vault at all', async () => {
      mockGetActive.mockResolvedValue('alpha');
      const store = useAccountStore();

      await store.getKeys();

      expect(mockGet).not.toHaveBeenCalled();
    });

    it('reports the accounts as unread rather than as an empty vault', async () => {
      mockGetActive.mockResolvedValue('alpha');
      const store = useAccountStore();

      await store.getKeys();

      expect(store.hydration).toBe('empty');
      expect(store.hasNoAccounts).toBe(false);
      expect(store.isHydrated).toBe(false);
    });

    it('still reads the active alias, which lives outside the vault', async () => {
      mockGetActive.mockResolvedValue('alpha');
      const store = useAccountStore();

      await store.getKeys();

      expect(store.activeKey).toBe('alpha');
      expect(store.activeAccount).toBeUndefined();
    });
  });

  describe('an unlocked vault holding no accounts', () => {
    it('is reported as configured with no accounts, which S16 is entitled to say', async () => {
      mockGet.mockResolvedValue({});
      mockGetActive.mockResolvedValue(undefined);
      unlockVault();
      const store = useAccountStore();

      await store.getKeys();

      expect(store.hydration).toBe('ready');
      expect(store.hasNoAccounts).toBe(true);
    });
  });

  describe('activeAccount', () => {
    it('resolves the alias in activeKey against the stored keys', async () => {
      const alpha = buildKey({ alias: 'alpha' });
      mockGet.mockResolvedValue({ alpha });
      mockGetActive.mockResolvedValue('alpha');
      unlockVault();
      const store = useAccountStore();

      await store.getKeys();

      expect(store.activeAccount).toStrictEqual(alpha);
    });

    it('does not fall back to another account when the active alias resolves to nothing', async () => {
      const beta = buildKey({ alias: 'beta' });
      mockGet.mockResolvedValue({ beta });
      mockGetActive.mockResolvedValue('alpha');
      unlockVault();
      const store = useAccountStore();

      await store.getKeys();

      // The panel must never present an account the user did not select as the active one.
      expect(store.activeAccount).toBeUndefined();
      expect(store.activeAccountOrFirst).toStrictEqual(beta);
    });
  });

  /**
   * The reported failure, end to end at the store.
   *
   * The panel mounts while the vault is locked — `App.vue` exempts it from the redirect to login
   * because it owns a view for every vault state — so it hydrated from a locked vault and never
   * looked again. Unlocking re-rendered the branch and left the accounts exactly as they were.
   */
  describe('followVaultLockState', () => {
    it('hydrates when the vault unlocks with the surface already open', async () => {
      const alpha = buildKey({ alias: 'alpha' });
      mockGet.mockResolvedValue({ alpha });
      mockGetActive.mockResolvedValue('alpha');

      const store = useAccountStore();
      store.followVaultLockState();

      // Mounted against a locked vault: nothing known, and nothing claimed.
      expect(store.hasNoAccounts).toBe(false);

      useVaultStore().isUnlocked = true;
      await nextTick();
      await vi.waitFor(() => expect(store.isHydrated).toBe(true));

      expect(store.activeAccount).toStrictEqual(alpha);
    });

    it('drops the accounts when the vault locks', async () => {
      const alpha = buildKey({ alias: 'alpha' });
      mockGet.mockResolvedValue({ alpha });
      mockGetActive.mockResolvedValue('alpha');
      unlockVault();

      const store = useAccountStore();
      store.followVaultLockState();
      await vi.waitFor(() => expect(store.isHydrated).toBe(true));

      useVaultStore().isUnlocked = false;
      await nextTick();

      // Vault-derived material must not outlive the lock that was supposed to protect it.
      expect(store.storedKeys.size).toBe(0);
      expect(store.hydration).toBe('empty');
      expect(store.hasNoAccounts).toBe(false);
    });

    it('re-hydrates after a lock and a second unlock', async () => {
      const alpha = buildKey({ alias: 'alpha' });
      mockGet.mockResolvedValue({ alpha });
      mockGetActive.mockResolvedValue('alpha');
      unlockVault();

      const store = useAccountStore();
      store.followVaultLockState();
      await vi.waitFor(() => expect(store.isHydrated).toBe(true));

      useVaultStore().isUnlocked = false;
      await nextTick();
      useVaultStore().isUnlocked = true;
      await vi.waitFor(() => expect(store.isHydrated).toBe(true));

      expect(store.activeAccount).toStrictEqual(alpha);
    });

    it('watches the vault only once', async () => {
      mockGet.mockResolvedValue({});
      mockGetActive.mockResolvedValue(undefined);
      const store = useAccountStore();

      store.followVaultLockState();
      store.followVaultLockState();
      useVaultStore().isUnlocked = true;
      await vi.waitFor(() => expect(mockGet).toHaveBeenCalled());

      expect(mockGet).toHaveBeenCalledTimes(1);
    });
  });
});
