import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleNip04Encrypt, handleNip04Decrypt } from '@/../src-bex/handlers/nip04';
import { handleVaultGetData, handleVaultIsUnlocked } from '@/../src-bex/handlers/vault-handler';
import { storageService } from '@/services/storage-service';
import { isVaultUnlocked, getVaultData } from '@/../src-bex/vault';
import { clearSiteBindingCache } from '@/../src-bex/services/site-binding-store';
import { nip04 } from 'nostr-tools';

// Mock dependencies
vi.mock('@/../src-bex/handlers/vault-handler', () => ({
  handleVaultIsUnlocked: vi.fn(),
  handleVaultGetData: vi.fn(),
}));

vi.mock('@/../src-bex/vault', () => ({
  isVaultUnlocked: vi.fn(),
  getVaultData: vi.fn(),
}));

vi.mock('@/services/log-service', () => ({
  LogLevel: { INFO: 'info' },
  logService: { log: vi.fn() },
}));

vi.mock('@/services/storage-service', () => ({
  storageService: {
    get: vi.fn(),
    set: vi.fn(() => Promise.resolve()),
  },
  NOSTR_ACTIVE: 'nostr_active_account',
  SITE_BINDINGS_KEY: 'nostr:site-bindings',
}));

vi.mock('nostr-tools', () => ({
  nip04: {
    encrypt: vi.fn(),
    decrypt: vi.fn(),
  },
}));

vi.mock('@noble/hashes/utils', () => ({
  hexToBytes: vi.fn((hex) => Buffer.from(hex, 'hex')),
}));

const ORIGIN = 'https://example.com';

const RECIPIENT = 'b'.repeat(64);
const SENDER = 'c'.repeat(64);

describe('Nip04Handler', () => {
  const mockAccount = {
    id: 'test-pubkey',
    alias: 'test-alias',
    createdAt: String(Date.now()),
    account: {
      privkey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Bindings are cached in module scope, so one test's binding would decide the next one's key.
    clearSiteBindingCache();
  });

  describe('handleNip04Encrypt', () => {
    it('should encrypt when vault is unlocked and account exists', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(true);
      vi.mocked(storageService['get']).mockResolvedValue('test-alias');
      vi.mocked(getVaultData).mockResolvedValue({
        success: true,
        vaultData: { accounts: [mockAccount] },
      });
      vi.mocked(nip04.encrypt).mockReturnValue('ciphertext');

      const result = await handleNip04Encrypt({ pubkey: RECIPIENT, plaintext: 'hello' }, ORIGIN);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('ciphertext');
      }
      expect(nip04.encrypt).toHaveBeenCalled();
    });

    it('should return error when vault is locked', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(false);

      const result = await handleNip04Encrypt({ pubkey: RECIPIENT, plaintext: 'hello' }, ORIGIN);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Vault is locked');
      }
    });

    it('should return error when no active account', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(true);
      vi.mocked(storageService['get']).mockResolvedValue(null);

      const result = await handleNip04Encrypt({ pubkey: RECIPIENT, plaintext: 'hello' }, ORIGIN);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('No active account');
      }
    });
  });

  describe('handleNip04Decrypt', () => {
    it('should decrypt when vault is unlocked and account exists', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(true);
      vi.mocked(storageService['get']).mockResolvedValue('test-alias');
      vi.mocked(getVaultData).mockResolvedValue({
        success: true,
        vaultData: { accounts: [mockAccount] },
      });
      vi.mocked(nip04.decrypt).mockReturnValue('plaintext');

      const result = await handleNip04Decrypt({ pubkey: SENDER, ciphertext: 'ciphertext' }, ORIGIN);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('plaintext');
      }
      expect(nip04.decrypt).toHaveBeenCalled();
    });

    it('should catch and return errors during decryption', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(true);
      vi.mocked(storageService['get']).mockResolvedValue('test-alias');
      vi.mocked(getVaultData).mockResolvedValue({
        success: true,
        vaultData: { accounts: [mockAccount] },
      });
      vi.mocked(nip04.decrypt).mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      const result = await handleNip04Decrypt({ pubkey: SENDER, ciphertext: 'ciphertext' }, ORIGIN);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Decryption failed');
      }
    });
  });
});

// A malformed counterparty gets a fixed error, never nostr-tools' own message (#373).
describe('nip04 counterparty public key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['not-hex', 'B'.repeat(64), 'b'.repeat(63), 'b'.repeat(66), ''])(
    'refuses %j without touching the key',
    async (pubkey) => {
      const encrypted = await handleNip04Encrypt({ pubkey, plaintext: 'hello' }, ORIGIN);
      const decrypted = await handleNip04Decrypt({ pubkey, ciphertext: 'x' }, ORIGIN);

      expect(encrypted).toEqual({
        success: false,
        error: 'Public key must be 64 lowercase hex characters',
      });
      expect(decrypted).toEqual({
        success: false,
        error: 'Public key must be 64 lowercase hex characters',
      });
      expect(getVaultData).not.toHaveBeenCalled();
    },
  );
});
