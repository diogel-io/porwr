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
    get: vi.fn(async (id: string) =>  Promise.resolve(mockVaultsTable.get(id))),
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

    it('should export and import vault', async () => {
      const { encryptedVault } = await createNewVault(TEST_PASSWORD, TEST_DATA);
      expect(encryptedVault).toBeDefined();

      mockVaultsTable.clear();
      await lockVault();

      const importRes = await importVault(encryptedVault!);
      expect(importRes.success).toBe(true);

      const unlockRes = await unlockVault(TEST_PASSWORD);
      expect(unlockRes.success).toBe(true);
      expect(unlockRes.vaultData).toEqual(TEST_DATA);
    });
  });
});
