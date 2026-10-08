import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UnsignedEvent } from '@/../src-bex/types/background';
import { handleGetPublicKey, handleSignEvent } from '@/../src-bex/handlers/nip07';
import { isVaultUnlocked, getVaultData } from '@/../src-bex/vault';
import { storageService } from '@/services/storage-service';
import { checkPermission } from '@/../src-bex/handlers/permission-handler';
import { clearSiteBindingCache } from '@/../src-bex/services/site-binding-store';
import { resetAutoLockTimer } from '@/../src-bex/services/auto-lock';
import { finalizeEvent } from 'nostr-tools';
import { ErrorCode } from '@/types/error-codes.d';

// Mock dependencies
vi.mock('@/../src-bex/vault', () => ({
  isVaultUnlocked: vi.fn(),
  getVaultData: vi.fn(),
}));

vi.mock('@/services/storage-service', () => ({
  storageService: {
    get: vi.fn(),
    set: vi.fn(() => Promise.resolve()),
  },
  NOSTR_ACTIVE: 'nostr_active_account',
  SITE_BINDINGS_KEY: 'nostr:site-bindings',
}));

vi.mock('@/../src-bex/handlers/permission-handler', () => ({
  checkPermission: vi.fn(),
}));

vi.mock('@/../src-bex/services/auto-lock', () => ({
  resetAutoLockTimer: vi.fn(),
}));

vi.mock('nostr-tools', () => ({
  finalizeEvent: vi.fn(),
}));

vi.mock('@noble/hashes/utils', () => ({
  hexToBytes: vi.fn((hex) => Buffer.from(hex, 'hex')),
}));

// Mock logService to avoid issues with wrapWithLogging
vi.mock('@/services/log-service', () => ({
  LogLevel: { DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'error' },
  logService: {
    log: vi.fn(),
    wrapWithLogging: vi.fn((fn) => fn),
  },
}));

describe('Nip07Handler', () => {
  const mockAccount = {
    id: 'test-pubkey',
    alias: 'test-alias',
    account: {
      privkey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    },
  };

  const mockOrigin = 'https://example.com';

  beforeEach(() => {
    vi.clearAllMocks();
    // Bindings are cached in module scope, so one test's binding would decide the next one's
    // signing account.
    clearSiteBindingCache();
  });

  describe('handleGetPublicKey', () => {
    it('should return public key when vault is unlocked and active account exists', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(true);
      vi.mocked(storageService['get']).mockResolvedValue('test-alias');
      vi.mocked(getVaultData).mockResolvedValue({
        success: true,
        vaultData: {
          accounts: [mockAccount],
        },
      });

      const result = await handleGetPublicKey({}, mockOrigin);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('test-pubkey');
      }
      // ADR D15: site-initiated requests must not extend the unlocked window (finding F2).
      expect(resetAutoLockTimer).not.toHaveBeenCalled();
    });

    it('should return error when vault is locked', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(false);

      const result = await handleGetPublicKey({}, mockOrigin);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe(ErrorCode.VLT_LOCKED);
        expect(result.error).toBe('Vault is locked');
      }
    });

    it('should return error when no active account is set', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(true);
      vi.mocked(storageService['get']).mockResolvedValue(null);

      const result = await handleGetPublicKey({}, mockOrigin);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe(ErrorCode.SIG_NO_ACTIVE_KEY);
        expect(result.error).toBe('No active account');
      }
    });

    it('should return error when active account is not found in vault data', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(true);
      vi.mocked(storageService['get']).mockResolvedValue('other-alias');
      vi.mocked(getVaultData).mockResolvedValue({
        success: true,
        vaultData: {
          accounts: [mockAccount],
        },
      });

      const result = await handleGetPublicKey({}, mockOrigin);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe(ErrorCode.SIG_NO_ACTIVE_KEY);
      }
    });
  });

  describe('handleSignEvent', () => {
    const mockEvent = {
      kind: 1,
      content: 'hello',
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
    };

    it('should sign event when all conditions are met', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(true);
      vi.mocked(checkPermission).mockResolvedValue({ granted: true });
      vi.mocked(storageService['get']).mockResolvedValue('test-alias');
      vi.mocked(getVaultData).mockResolvedValue({
        success: true,
        vaultData: {
          accounts: [mockAccount],
        },
      });
      const signedEvent = { ...mockEvent, id: 'event-id', sig: 'event-sig', pubkey: 'test-pubkey' };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(finalizeEvent).mockReturnValue(signedEvent as any);

      const result = await handleSignEvent({ event: { ...mockEvent } as UnsignedEvent }, mockOrigin);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(signedEvent);
      }
      expect(finalizeEvent).toHaveBeenCalled();
      // ADR D15: site-initiated requests must not extend the unlocked window (finding F2).
      expect(resetAutoLockTimer).not.toHaveBeenCalled();
    });

    it('should return error when vault is locked', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(false);

      const result = await handleSignEvent({ event: mockEvent as UnsignedEvent }, mockOrigin);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe(ErrorCode.VLT_LOCKED);
      }
    });

    it('should return error when permission is denied', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(true);
      vi.mocked(checkPermission).mockResolvedValue({ granted: false });

      const result = await handleSignEvent({ event: mockEvent as UnsignedEvent }, mockOrigin);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe(ErrorCode.PER_DENIED);
        expect(result.error).toBe('Permission denied');
      }
    });

    it('should sign an explicitly approved one-shot request without stored permission', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(true);
      vi.mocked(storageService['get']).mockResolvedValue('test-alias');
      vi.mocked(getVaultData).mockResolvedValue({
        success: true,
        vaultData: {
          accounts: [mockAccount],
        },
      });
      const signedEvent = { ...mockEvent, id: 'event-id', sig: 'event-sig', pubkey: 'test-pubkey' };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(finalizeEvent).mockReturnValue(signedEvent as any);

      const result = await handleSignEvent(
        { event: { ...mockEvent } as UnsignedEvent },
        mockOrigin,
        { skipPermissionCheck: true },
      );

      expect(result.success).toBe(true);
      expect(checkPermission).not.toHaveBeenCalled();
      expect(finalizeEvent).toHaveBeenCalled();
    });

    it('should return error when signing fails', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(true);
      vi.mocked(checkPermission).mockResolvedValue({ granted: true });
      vi.mocked(storageService['get']).mockResolvedValue('test-alias');
      vi.mocked(getVaultData).mockResolvedValue({
        success: true,
        vaultData: {
          accounts: [mockAccount],
        },
      });
      vi.mocked(finalizeEvent).mockImplementation(() => {
        throw new Error('Signing failed');
      });

      const result = await handleSignEvent({ event: { ...mockEvent } as UnsignedEvent }, mockOrigin);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe(ErrorCode.SIG_FAILED);
        expect(result.error).toBe('Signing failed');
      }
    });
  });
});

/**
 * Site-to-account binding (#116).
 *
 * A NIP-07 client caches the public key it received at login and assumes every later signature
 * comes from that identity. Porwr signs as the account the site is bound to, never as whichever
 * account happens to be active.
 */
describe('signing identity is bound to the site', () => {
  const alice = {
    id: 'a'.repeat(64),
    alias: 'alice',
    account: { privkey: '11'.repeat(32) },
  };
  const bob = {
    id: 'b'.repeat(64),
    alias: 'bob',
    account: { privkey: '22'.repeat(32) },
  };

  const origin = 'https://example.com';

  const setAccounts = (accounts: unknown[], activeAlias: string): void => {
    vi.mocked(storageService['get']).mockImplementation((key: string) =>
      Promise.resolve(key === 'nostr_active_account' ? activeAlias : []),
    );
    vi.mocked(getVaultData).mockResolvedValue({ success: true, vaultData: { accounts } });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearSiteBindingCache();
    vi.mocked(isVaultUnlocked).mockReturnValue(true);
    vi.mocked(checkPermission).mockResolvedValue({ granted: true });
  });

  it('binds a site to the active account on first contact', async () => {
    setAccounts([alice, bob], 'alice');

    const result = await handleGetPublicKey({}, origin);

    expect(result.success && result.data).toBe(alice.id);
  });

  it('keeps returning the bound key after the active account changes', async () => {
    setAccounts([alice, bob], 'alice');
    await handleGetPublicKey({}, origin);

    setAccounts([alice, bob], 'bob');
    const result = await handleGetPublicKey({}, origin);

    expect(result.success && result.data).toBe(alice.id);
  });

  it('signs as the bound account after the active account changes', async () => {
    setAccounts([alice, bob], 'alice');
    await handleGetPublicKey({}, origin);

    setAccounts([alice, bob], 'bob');
    vi.mocked(finalizeEvent).mockReturnValue({ id: 'signed' } as never);

    const event = { kind: 1, content: 'hi', tags: [], created_at: 1 } as unknown as UnsignedEvent;
    const result = await handleSignEvent({ event }, origin);

    // The signature must come from the identity the site was given at login.
    expect(result.success).toBe(true);
    expect(event.pubkey).toBe(alice.id);
  });

  it('gives different sites their own identities', async () => {
    setAccounts([alice, bob], 'alice');
    await handleGetPublicKey({}, 'https://one.example');

    setAccounts([alice, bob], 'bob');
    const second = await handleGetPublicKey({}, 'https://two.example');

    expect(second.success && second.data).toBe(bob.id);
  });

  it('refuses rather than substituting when the bound account is gone', async () => {
    setAccounts([alice, bob], 'alice');
    await handleGetPublicKey({}, origin);

    // Alice removed from the vault; bob is active and available.
    setAccounts([bob], 'bob');
    const result = await handleSignEvent(
      { event: { kind: 1, content: 'hi', tags: [], created_at: 1 } as unknown as UnsignedEvent },
      origin,
    );

    // Falling back to bob is exactly the substitution this prevents.
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/no longer available/);
  });
});
