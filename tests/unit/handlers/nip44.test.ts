import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleNip44Encrypt, handleNip44Decrypt } from '@/../src-bex/handlers/nip44';
import { handleVaultGetData, handleVaultIsUnlocked } from '@/../src-bex/handlers/vault-handler';
import { storageService } from '@/services/storage-service';
import { isVaultUnlocked, getVaultData } from '@/../src-bex/vault';
import { clearSiteBindingCache } from '@/../src-bex/services/site-binding-store';
import { nip44 } from 'nostr-tools';
import { resetAutoLockTimer } from '@/../src-bex/services/auto-lock';

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
  nip44: {
    getConversationKey: vi.fn(),
    encrypt: vi.fn(),
    decrypt: vi.fn(),
  },
}));

vi.mock('@noble/hashes/utils', () => ({
  hexToBytes: vi.fn((hex: string) => Buffer.from(hex, 'hex')),
}));

vi.mock('@/../src-bex/services/auto-lock', () => ({
  resetAutoLockTimer: vi.fn(),
}));

const ORIGIN = 'https://example.com';

const RECIPIENT = 'b'.repeat(64);
const SENDER = 'c'.repeat(64);

describe('Nip44Handler', () => {
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

  function mockUnlockedActiveAccount(): void {
    vi.mocked(isVaultUnlocked).mockReturnValue(true);
    vi.mocked(storageService.get).mockResolvedValue('test-alias');
    vi.mocked(getVaultData).mockResolvedValue({
      success: true,
      vaultData: { accounts: [mockAccount] },
    });
  }

  it('encrypts when vault is unlocked and active account exists', async () => {
    mockUnlockedActiveAccount();
    vi.mocked(nip44.getConversationKey).mockReturnValue(Uint8Array.from([1, 2, 3]));
    vi.mocked(nip44.encrypt).mockReturnValue('nip44-ciphertext');

    const result = await handleNip44Encrypt({ pubkey: RECIPIENT, plaintext: 'hello' }, ORIGIN);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('nip44-ciphertext');
    }
    expect(nip44.getConversationKey).toHaveBeenCalledWith(expect.any(Buffer), RECIPIENT);
    expect(nip44.encrypt).toHaveBeenCalledWith('hello', Uint8Array.from([1, 2, 3]));
    // ADR D15: site-initiated requests must not extend the unlocked window (finding F2).
    expect(resetAutoLockTimer).not.toHaveBeenCalled();
  });

  it('decrypts when vault is unlocked and active account exists', async () => {
    mockUnlockedActiveAccount();
    vi.mocked(nip44.getConversationKey).mockReturnValue(Uint8Array.from([4, 5, 6]));
    vi.mocked(nip44.decrypt).mockReturnValue('hello');

    const result = await handleNip44Decrypt(
      { pubkey: SENDER, ciphertext: 'nip44-ciphertext' },
      ORIGIN,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('hello');
    }
    expect(nip44.getConversationKey).toHaveBeenCalledWith(expect.any(Buffer), SENDER);
    expect(nip44.decrypt).toHaveBeenCalledWith('nip44-ciphertext', Uint8Array.from([4, 5, 6]));
    // ADR D15: site-initiated requests must not extend the unlocked window (finding F2).
    expect(resetAutoLockTimer).not.toHaveBeenCalled();
  });

  it('returns error when vault is locked', async () => {
    vi.mocked(isVaultUnlocked).mockReturnValue(false);

    const result = await handleNip44Encrypt({ pubkey: RECIPIENT, plaintext: 'hello' }, ORIGIN);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Vault is locked');
    }
  });

  it('returns error when no active account exists', async () => {
    vi.mocked(isVaultUnlocked).mockReturnValue(true);
    vi.mocked(storageService.get).mockResolvedValue(null);

    const result = await handleNip44Decrypt(
      { pubkey: SENDER, ciphertext: 'nip44-ciphertext' },
      ORIGIN,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('No active account');
    }
  });

  it('returns crypto errors from invalid ciphertext', async () => {
    mockUnlockedActiveAccount();
    vi.mocked(nip44.getConversationKey).mockReturnValue(Uint8Array.from([4, 5, 6]));
    vi.mocked(nip44.decrypt).mockImplementation(() => {
      throw new Error('invalid MAC');
    });

    const result = await handleNip44Decrypt(
      { pubkey: SENDER, ciphertext: 'bad-ciphertext' },
      ORIGIN,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('invalid MAC');
    }
  });
});

// A malformed counterparty gets a fixed error, never nostr-tools' own message (#373).
describe('nip44 counterparty public key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['not-hex', 'B'.repeat(64), 'b'.repeat(63), 'b'.repeat(66), ''])(
    'refuses %j without touching the key',
    async (pubkey) => {
      const encrypted = await handleNip44Encrypt({ pubkey, plaintext: 'hello' }, ORIGIN);
      const decrypted = await handleNip44Decrypt({ pubkey, ciphertext: 'x' }, ORIGIN);

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
