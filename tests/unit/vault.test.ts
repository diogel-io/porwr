import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { installCryptoMock } from './mocks/crypto';

// Install crypto mock before tests
beforeAll(() => {
  installCryptoMock();
});

// Define a simpler database interface
interface MockVault {
  id: string;
  encryptedData: string;
  createdAt: string;
}

const mockVaultsTable = new Map<string, MockVault>();

// Mock Dexie
vi.mock('@/services/database', () => {
  const vaultsMock = {
    get: vi.fn(async (id: string) => Promise.resolve(mockVaultsTable.get(id))),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    put: vi.fn(async (vault: any) => {
      mockVaultsTable.set(vault.id, vault);
      return Promise.resolve(vault.id);
    }),
    clear: vi.fn(async () => {
      mockVaultsTable.clear();
      return Promise.resolve();
    }),
  };
  return {
    db: {
      vaults: vaultsMock,
      table: (name: string) => {
        if (name === 'vaults') {
          return vaultsMock;
        }
        throw new Error(`Table ${name} not mocked`);
      },
    },
  };
});

import {
  createNewVault,
  unlockVault,
  lockVault,
  onVaultLocked,
  onVaultUnlocked,
  isVaultUnlocked,
  updateVaultData,
  getVaultData,
  importVault,
} from '@/../src-bex/vault';

import {
  encryptWithKey,
  decryptWithKey,
  deriveNewKey,
  deriveKeyFromEncryptedVault,
} from '@/services/crypto';
import type { VaultData } from '@/types/bridge';
import { db } from '@/services/database';

// Mock chrome storage
const chromeMock = {
  storage: {
    session: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    },
  },
};

vi.stubGlobal('chrome', chromeMock);

describe('Vault', () => {
  const TEST_PASSWORD = 'test-password-123';
  const TEST_DATA: VaultData = {
    accounts: [
      {
        id: '1',
        alias: 'test-account',
        account: {
          privkey: 'nsec1test123456789',
        },
        createdAt: new Date().toISOString(),
      },
    ],
  };

  describe('Encryption', () => {
    it('should encrypt vault data successfully', async () => {
      const { key, salt } = await deriveNewKey(TEST_PASSWORD);
      const encrypted = await encryptWithKey(TEST_DATA, key, salt);

      expect(encrypted).toBeDefined();
      expect(encrypted.startsWith('v2:')).toBe(true);
    });

    it('should produce different ciphertexts for same data (random IV)', async () => {
      const { key, salt } = await deriveNewKey(TEST_PASSWORD);
      const encrypted1 = await encryptWithKey(TEST_DATA, key, salt);
      const encrypted2 = await encryptWithKey(TEST_DATA, key, salt);

      expect(encrypted1).not.toBe(encrypted2);
    });
  });

  describe('Decryption', () => {
    it('should decrypt vault data with correct key', async () => {
      const { key, salt } = await deriveNewKey(TEST_PASSWORD);
      const encrypted = await encryptWithKey(TEST_DATA, key, salt);
      const decrypted = (await decryptWithKey(encrypted, key)) as VaultData;

      expect(decrypted).toEqual(TEST_DATA);
    });

    it('should fail to decrypt with wrong password (integrated test)', async () => {
      await createNewVault(TEST_PASSWORD, TEST_DATA);
      await lockVault();

      const result = await unlockVault('wrong-password');
      expect(result.success).toBe(false);
      expect(isVaultUnlocked()).toBe(false);
    });

    it('should handle empty vault data', async () => {
      const emptyData: VaultData = { accounts: [] };
      const { key, salt } = await deriveNewKey(TEST_PASSWORD);
      const encrypted = await encryptWithKey(emptyData, key, salt);
      const decrypted = await decryptWithKey(encrypted, key);

      expect(decrypted).toEqual(emptyData);
    });

    it('should handle multiple accounts', async () => {
      const multiAccountData: VaultData = {
        accounts: [
          {
            id: '1',
            alias: 'account-1',
            account: { privkey: 'nsec1...' },
            createdAt: new Date().toISOString(),
          },
          {
            id: '2',
            alias: 'account-2',
            account: { privkey: 'nsec2...' },
            createdAt: new Date().toISOString(),
          },
        ],
      };

      const { key, salt } = await deriveNewKey(TEST_PASSWORD);
      const encrypted = await encryptWithKey(multiAccountData, key, salt);
      const decrypted = (await decryptWithKey(encrypted, key)) as VaultData;

      expect(decrypted.accounts).toHaveLength(2);
      expect(decrypted.accounts[0]!.alias).toBe('account-1');
      expect(decrypted.accounts[1]!.alias).toBe('account-2');
    });
  });

  describe('Key Derivation', () => {
    it('should derive consistent keys from same password', async () => {
      const { key: key1, salt } = await deriveNewKey(TEST_PASSWORD);
      const encrypted = await encryptWithKey(TEST_DATA, key1, salt);

      const { key: key2 } = await deriveKeyFromEncryptedVault(TEST_PASSWORD, encrypted);

      expect(key1).toBeDefined();
      expect(key2).toBeDefined();
      // In our mock, all keys derived from the same algorithm/parameters will look the same
      expect(key1.algorithm.name).toBe(key2.algorithm.name);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long passwords', async () => {
      const longPassword = 'a'.repeat(1000);
      const { key, salt } = await deriveNewKey(longPassword);
      const encrypted = await encryptWithKey(TEST_DATA, key, salt);
      const decrypted = await decryptWithKey(encrypted, key);

      expect(decrypted).toEqual(TEST_DATA);
    });

    it('should handle passwords with special characters', async () => {
      const specialPassword = '!@#$%^&*()_+-=[]{}|;\':",./<>?';
      const { key, salt } = await deriveNewKey(specialPassword);
      const encrypted = await encryptWithKey(TEST_DATA, key, salt);
      const decrypted = await decryptWithKey(encrypted, key);

      expect(decrypted).toEqual(TEST_DATA);
    });

    it('should reject corrupted ciphertext', async () => {
      const { key, salt } = await deriveNewKey(TEST_PASSWORD);
      const encrypted = await encryptWithKey(TEST_DATA, key, salt);

      // Corrupt base64 part
      const corrupted = encrypted.slice(0, -5) + 'AAAAA';

      await expect(decryptWithKey(corrupted, key)).rejects.toThrow();
    });

    it('should reject tampered data', async () => {
      const { key, salt } = await deriveNewKey(TEST_PASSWORD);
      const encrypted = await encryptWithKey(TEST_DATA, key, salt);

      const tampered = encrypted + '123';

      await expect(decryptWithKey(tampered, key)).rejects.toThrow();
    });
  });

  describe('Vault Operations (Integrated)', () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      mockVaultsTable.clear();
      await lockVault();
    });

    it('should create and unlock vault', async () => {
      const createRes = await createNewVault(TEST_PASSWORD, TEST_DATA);
      expect(createRes.success).toBe(true);

      await lockVault();
      expect(isVaultUnlocked()).toBe(false);

      const unlockRes = await unlockVault(TEST_PASSWORD);
      expect(unlockRes.success).toBe(true);
      expect(unlockRes.vaultData).toEqual(TEST_DATA);
      expect(isVaultUnlocked()).toBe(true);
    });

    it('tells lock listeners when the vault locks, until they unsubscribe', async () => {
      const listener = vi.fn();
      const unsubscribe = onVaultLocked(listener);

      await createNewVault(TEST_PASSWORD, TEST_DATA);
      await lockVault();
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      await lockVault();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should update vault data', async () => {
      await createNewVault(TEST_PASSWORD, TEST_DATA);
      const newData = { accounts: [] };
      const updateRes = await updateVaultData(newData);
      expect(updateRes.success).toBe(true);

      const getRes = await getVaultData();
      expect(getRes.vaultData).toEqual(newData);
    });

    it('refuses a write the vault locked during, so the lock is never undone by it (#142)', async () => {
      await createNewVault(TEST_PASSWORD, TEST_DATA);

      const writing = updateVaultData({ accounts: [], late: true });
      await lockVault();

      await expect(writing).resolves.toMatchObject({ success: false, error: 'Vault is locked' });
      await unlockVault(TEST_PASSWORD);
      await expect(getVaultData()).resolves.toMatchObject({ vaultData: TEST_DATA });
    });

    it('drops the retired mnemonic and passphrase on the next write, and keeps everything else (#244)', async () => {
      const oldVault = {
        ...TEST_DATA,
        mnemonic: 'Generating...',
        passphrase: '',
        createdAt: '2026-01-01',
      };
      await createNewVault(TEST_PASSWORD, oldVault);
      await lockVault();

      // A vault created before #244 still unlocks, fields and all.
      const unlocked = await unlockVault(TEST_PASSWORD);
      expect(unlocked.success).toBe(true);
      expect(unlocked.vaultData).toMatchObject({ mnemonic: 'Generating...', passphrase: '' });

      const { vaultData } = (await getVaultData()) as { vaultData: VaultData };
      await updateVaultData(vaultData);

      const written = (await getVaultData()) as { vaultData: Record<string, unknown> };
      expect(written.vaultData).not.toHaveProperty('mnemonic');
      expect(written.vaultData).not.toHaveProperty('passphrase');
      expect(written.vaultData).toEqual({ accounts: TEST_DATA.accounts, createdAt: '2026-01-01' });
    });

    it('drops the zap history Porwr no longer keeps on the next write (#271)', async () => {
      const oldVault = { ...TEST_DATA, nip57ZapHistory: [{ id: 'zap-1', status: 'paid' }] };
      await createNewVault(TEST_PASSWORD, oldVault);
      await lockVault();

      // A vault holding zap history still unlocks.
      const unlocked = await unlockVault(TEST_PASSWORD);
      expect(unlocked.success).toBe(true);

      const { vaultData } = (await getVaultData()) as { vaultData: VaultData };
      await updateVaultData(vaultData);

      const written = (await getVaultData()) as { vaultData: Record<string, unknown> };
      expect(written.vaultData).not.toHaveProperty('nip57ZapHistory');
      expect(written.vaultData).toEqual(TEST_DATA);
    });

    it('should export and import vault', async () => {
      const { encryptedVault } = await createNewVault(TEST_PASSWORD, TEST_DATA);
      expect(encryptedVault).toBeDefined();

      mockVaultsTable.clear();
      await lockVault();

      const importRes = await importVault(encryptedVault!, TEST_PASSWORD);
      expect(importRes.success).toBe(true);

      const unlockRes = await unlockVault(TEST_PASSWORD);
      expect(unlockRes.success).toBe(true);
      expect(unlockRes.vaultData).toEqual(TEST_DATA);
    });
  });

  describe('Import checks the password before it writes (#313)', () => {
    const BACKUP_PASSWORD = 'backup-password';
    // One character more always changes the mock key's id, so this never opens the backup.
    const WRONG_PASSWORD = `${BACKUP_PASSWORD}x`;
    const BACKUP_DATA: VaultData = { accounts: [] };

    const encryptBackup = async (data: unknown, password = BACKUP_PASSWORD) => {
      const { key, salt } = await deriveNewKey(password);
      return encryptWithKey(data, key, salt);
    };

    /** A current vault, unlocked, as the user has it before importing. */
    const currentVault = async () => {
      mockVaultsTable.clear();
      await createNewVault(TEST_PASSWORD, TEST_DATA);
      return mockVaultsTable.get('master')!.encryptedData;
    };

    it('refuses a wrong password and leaves the current vault and its session as they were', async () => {
      const before = await currentVault();
      const backup = await encryptBackup(BACKUP_DATA);

      const result = await importVault(backup, WRONG_PASSWORD);

      expect(result).toEqual({
        success: false,
        error: 'Invalid password',
        errorCode: 'VLT_INVALID_PASSWORD',
      });
      expect(mockVaultsTable.get('master')!.encryptedData).toBe(before);
      expect(isVaultUnlocked()).toBe(true);
      await lockVault();
      expect((await unlockVault(TEST_PASSWORD)).vaultData).toEqual(TEST_DATA);
    });

    it('refuses data that is not a v2 vault without writing', async () => {
      const before = await currentVault();

      const result = await importVault('not-a-vault', BACKUP_PASSWORD);

      expect(result.errorCode).toBe('GEN_INVALID_INPUT');
      expect(mockVaultsTable.get('master')!.encryptedData).toBe(before);
      expect(isVaultUnlocked()).toBe(true);
    });

    it('refuses a backup that opens but is not a Porwr vault, without writing', async () => {
      const before = await currentVault();
      const backup = await encryptBackup(['not', 'a', 'vault']);

      const result = await importVault(backup, BACKUP_PASSWORD);

      expect(result.errorCode).toBe('GEN_INVALID_INPUT');
      expect(mockVaultsTable.get('master')!.encryptedData).toBe(before);
      expect(isVaultUnlocked()).toBe(true);
    });

    it('replaces the vault with the right password, then locks it and tells the lock listeners', async () => {
      await currentVault();
      const backup = await encryptBackup(BACKUP_DATA);
      const onLocked = vi.fn();
      const stopListening = onVaultLocked(onLocked);

      const result = await importVault(backup, BACKUP_PASSWORD);
      stopListening();

      expect(result).toEqual({ success: true });
      expect(mockVaultsTable.get('master')!.encryptedData).toBe(backup);
      expect(isVaultUnlocked()).toBe(false);
      expect(onLocked).toHaveBeenCalledTimes(1);
      expect((await unlockVault(TEST_PASSWORD)).success).toBe(false);
      expect((await unlockVault(BACKUP_PASSWORD)).vaultData).toEqual(BACKUP_DATA);
    });
  });

  describe('unlocking against a lock (porwr#367)', () => {
    const BACKUP_PASSWORD = 'backup-password';
    const BACKUP_DATA: VaultData = { accounts: [] };

    const deferred = () => {
      let resolve: () => void = () => undefined;
      const promise = new Promise<void>((done) => (resolve = done));
      return { promise, resolve };
    };

    beforeEach(async () => {
      vi.clearAllMocks();
      mockVaultsTable.clear();
      await lockVault();
      await createNewVault(TEST_PASSWORD, TEST_DATA);
    });

    it('lets a lock made during the unlock win', async () => {
      await lockVault();
      const unlocked = vi.fn();
      const stopListening = onVaultUnlocked(unlocked);

      const unlocking = unlockVault(TEST_PASSWORD);
      await lockVault();

      await expect(unlocking).resolves.toMatchObject({ success: false, error: 'Vault is locked' });
      expect(isVaultUnlocked()).toBe(false);
      expect(unlocked).not.toHaveBeenCalled();
      stopListening();
    });

    it('ends locked when a backup is imported while the old vault unlocks, and the backup then opens', async () => {
      await lockVault();
      const { key, salt } = await deriveNewKey(BACKUP_PASSWORD);
      const backup = await encryptWithKey(BACKUP_DATA, key, salt);

      // The unlock reads the old vault, then waits until the import has replaced it and locked.
      const imported = deferred();
      // Dexie's overloaded `get` type does not fit the table mock, hence the cast.
      vi.mocked(db.vaults.get).mockImplementationOnce((async (id: string) => {
        const old = mockVaultsTable.get(id);
        await imported.promise;
        return old;
      }) as never);

      const unlocking = unlockVault(TEST_PASSWORD);
      await expect(importVault(backup, BACKUP_PASSWORD)).resolves.toMatchObject({ success: true });
      imported.resolve();

      await expect(unlocking).resolves.toMatchObject({ success: false, error: 'Vault is locked' });
      // Not open with the old key, which could not read the imported vault.
      expect(isVaultUnlocked()).toBe(false);
      await expect(unlockVault(BACKUP_PASSWORD)).resolves.toMatchObject({
        success: true,
        vaultData: BACKUP_DATA,
      });
    });

    it('keeps an open vault open, and readable, after a wrong password', async () => {
      await expect(unlockVault(`${TEST_PASSWORD}x`)).resolves.toMatchObject({
        success: false,
        error: 'Invalid password',
      });

      expect(isVaultUnlocked()).toBe(true);
      await expect(getVaultData()).resolves.toMatchObject({ vaultData: TEST_DATA });
    });

    it('reports a storage failure as one, not as a wrong password, and keeps the vault open', async () => {
      vi.mocked(db.vaults.get).mockRejectedValueOnce(new Error('IndexedDB internal error'));

      await expect(unlockVault(TEST_PASSWORD)).resolves.toMatchObject({
        success: false,
        error: 'Failed to unlock the vault',
      });
      expect(isVaultUnlocked()).toBe(true);
    });

    it('does not swap the key when the right password is entered again, so a write in flight lands', async () => {
      // The write's encryption is held until the second unlock has finished.
      const real = crypto.subtle;
      const encrypted = deferred();
      const subtle = vi.spyOn(globalThis.crypto, 'subtle', 'get').mockReturnValue({
        ...real,
        encrypt: async (...args: Parameters<SubtleCrypto['encrypt']>) => {
          await encrypted.promise;
          return real.encrypt(...args);
        },
      } as SubtleCrypto);

      try {
        const writing = updateVaultData({ ...TEST_DATA, later: true });
        await expect(unlockVault(TEST_PASSWORD)).resolves.toMatchObject({ success: true });
        encrypted.resolve();

        await expect(writing).resolves.toMatchObject({ success: true });
      } finally {
        subtle.mockRestore();
      }
    });
  });

  describe('creating against a lock (porwr#385)', () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      mockVaultsTable.clear();
      await lockVault();
    });

    it('lets a lock made during the create win, but still writes the vault', async () => {
      const creating = createNewVault(TEST_PASSWORD, TEST_DATA);
      await lockVault();

      await expect(creating).resolves.toMatchObject({ success: true });
      expect(isVaultUnlocked()).toBe(false);
      // The user did create it: it is there, and opens with their password.
      expect(mockVaultsTable.has('master')).toBe(true);
      await expect(unlockVault(TEST_PASSWORD)).resolves.toMatchObject({
        success: true,
        vaultData: TEST_DATA,
      });
    });

    it('leaves the vault open when no lock came in', async () => {
      await expect(createNewVault(TEST_PASSWORD, TEST_DATA)).resolves.toMatchObject({
        success: true,
      });
      expect(isVaultUnlocked()).toBe(true);
    });
  });
});
