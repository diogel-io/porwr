import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UnsignedEvent } from '@/../src-bex/types/background';
import { handleGetPublicKey, handleGetRelays, handleSignEvent } from '@/../src-bex/handlers/nip07';
import { messagingRelays } from '@/../src-bex/services/messaging-relays';
import { isVaultUnlocked, getVaultData } from '@/../src-bex/vault';
import { storageService } from '@/services/storage-service';
import { checkPermission } from '@/../src-bex/handlers/permission-handler';
import { clearSiteBindingCache } from '@/../src-bex/services/site-binding-store';
import { accountForDispatch, bindSiteToAccount } from '@/../src-bex/services/signing-account';
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

vi.mock('@noble/hashes/utils.js', () => ({
  hexToBytes: vi.fn((hex) => Buffer.from(hex, 'hex')),
}));

vi.mock('@/../src-bex/services/messaging-relays', () => ({
  messagingRelays: { loadRelayMap: vi.fn() },
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
    createdAt: '2026-01-01T00:00:00.000Z',
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

  describe('handleGetRelays', () => {
    const relayMap = {
      'wss://relay.one/': { read: true, write: true },
      'wss://relay.two/': { read: false, write: true },
    };

    it("returns the given account's relay list", async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(true);
      vi.mocked(messagingRelays.loadRelayMap).mockResolvedValue(relayMap);

      const result = await handleGetRelays({}, mockOrigin, mockAccount);

      expect(result).toEqual({ success: true, data: relayMap });
      expect(messagingRelays.loadRelayMap).toHaveBeenCalledWith('test-pubkey');
    });

    it('does not look relays up while the vault is locked', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(false);

      const result = await handleGetRelays({}, mockOrigin, mockAccount);

      expect(result).toMatchObject({ success: false, code: ErrorCode.VLT_LOCKED });
      expect(messagingRelays.loadRelayMap).not.toHaveBeenCalled();
    });

    // Not the active account, nor the site's binding: the handler never resolves one itself
    // (diogel-io/workspace#227).
    it('reads no account of its own', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(true);
      vi.mocked(messagingRelays.loadRelayMap).mockResolvedValue(relayMap);

      await handleGetRelays({}, mockOrigin, mockAccount);

      expect(storageService['get']).not.toHaveBeenCalled();
      expect(getVaultData).not.toHaveBeenCalled();
    });
  });

  describe('handleGetPublicKey', () => {
    it('returns the public key of the account it is given', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(true);

      const result = await handleGetPublicKey({}, mockOrigin, mockAccount);

      expect(result).toEqual({ success: true, data: 'test-pubkey' });
      expect(storageService['get']).not.toHaveBeenCalled();
      // ADR D15: site-initiated requests must not extend the unlocked window (finding F2).
      expect(resetAutoLockTimer).not.toHaveBeenCalled();
    });

    it('should return error when vault is locked', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(false);

      const result = await handleGetPublicKey({}, mockOrigin, mockAccount);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe(ErrorCode.VLT_LOCKED);
        expect(result.error).toBe('Vault is locked');
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
      const signedEvent = { ...mockEvent, id: 'event-id', sig: 'event-sig', pubkey: 'test-pubkey' };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(finalizeEvent).mockReturnValue(signedEvent as any);

      const result = await handleSignEvent(
        { event: { ...mockEvent } as UnsignedEvent },
        mockOrigin,
        mockAccount,
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(signedEvent);
      }
      expect(finalizeEvent).toHaveBeenCalled();
      expect(checkPermission).toHaveBeenCalledWith(mockOrigin, 'test-pubkey', 'sign_event', 1);
      // ADR D15: site-initiated requests must not extend the unlocked window (finding F2).
      expect(resetAutoLockTimer).not.toHaveBeenCalled();
    });

    it('should return error when vault is locked', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(false);

      const result = await handleSignEvent(
        { event: mockEvent as UnsignedEvent },
        mockOrigin,
        mockAccount,
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe(ErrorCode.VLT_LOCKED);
      }
    });

    it('should return error when permission is denied', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(true);
      vi.mocked(checkPermission).mockResolvedValue({ granted: false });

      const result = await handleSignEvent(
        { event: mockEvent as UnsignedEvent },
        mockOrigin,
        mockAccount,
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe(ErrorCode.PER_DENIED);
        expect(result.error).toBe('Permission denied');
      }
    });

    it('should sign an explicitly approved one-shot request without stored permission', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(true);
      const signedEvent = { ...mockEvent, id: 'event-id', sig: 'event-sig', pubkey: 'test-pubkey' };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(finalizeEvent).mockReturnValue(signedEvent as any);

      const result = await handleSignEvent(
        { event: { ...mockEvent } as UnsignedEvent },
        mockOrigin,
        mockAccount,
        { skipPermissionCheck: true },
      );

      expect(result.success).toBe(true);
      expect(checkPermission).not.toHaveBeenCalled();
      expect(finalizeEvent).toHaveBeenCalled();
    });

    it('should return error when signing fails', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(true);
      vi.mocked(checkPermission).mockResolvedValue({ granted: true });
      vi.mocked(finalizeEvent).mockImplementation(() => {
        throw new Error('Signing failed');
      });

      const result = await handleSignEvent(
        { event: { ...mockEvent } as UnsignedEvent },
        mockOrigin,
        mockAccount,
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe(ErrorCode.SIG_FAILED);
        expect(result.error).toBe('Signing failed');
      }
    });
  });
});

/**
 * The approved account, all the way to the signature (#116, diogel-io/workspace#227).
 *
 * A NIP-07 client caches the public key it received at login and assumes every later signature
 * comes from that identity. The handler signs as the account the request was approved as, which
 * the background checks with `accountForDispatch` and hands over; it never looks at whichever
 * account happens to be active by then.
 */
describe('a request runs as the account it was approved as', () => {
  const alice = {
    id: 'a'.repeat(64),
    alias: 'alice',
    createdAt: '2026-01-01T00:00:00.000Z',
    account: { privkey: '11'.repeat(32) },
  };
  const bob = {
    id: 'b'.repeat(64),
    alias: 'bob',
    createdAt: '2026-01-01T00:00:00.000Z',
    account: { privkey: '22'.repeat(32) },
  };

  const origin = 'https://example.com';

  const setAccounts = (accounts: unknown[], activeAlias: string): void => {
    vi.mocked(storageService['get']).mockImplementation((key: string) =>
      Promise.resolve(key === 'nostr_active_account' ? activeAlias : []),
    );
    vi.mocked(getVaultData).mockResolvedValue({ success: true, vaultData: { accounts } });
  };

  const dispatchAs = async (accountPubkey: string) => {
    const resolved = await accountForDispatch(origin, accountPubkey);
    if ('error' in resolved) throw new Error(resolved.error);
    return resolved.account;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearSiteBindingCache();
    vi.mocked(isVaultUnlocked).mockReturnValue(true);
    vi.mocked(checkPermission).mockResolvedValue({ granted: true });
  });

  it('answers with the approved key after the active account changes', async () => {
    setAccounts([alice, bob], 'alice');
    await bindSiteToAccount(origin, alice.id);

    setAccounts([alice, bob], 'bob');
    const result = await handleGetPublicKey({}, origin, await dispatchAs(alice.id));

    expect(result.success && result.data).toBe(alice.id);
  });

  // The case the approval flow cannot bind for: an unbound site whose active account changes
  // between approval and dispatch.
  it('signs as the approved account for an unbound site whose active account changed', async () => {
    setAccounts([alice, bob], 'bob');
    vi.mocked(finalizeEvent).mockReturnValue({ id: 'signed' } as never);

    const event = { kind: 1, content: 'hi', tags: [], created_at: 1 } as unknown as UnsignedEvent;
    const result = await handleSignEvent({ event }, origin, await dispatchAs(alice.id), {
      skipPermissionCheck: true,
    });

    expect(result.success).toBe(true);
    expect(event.pubkey).toBe(alice.id);
  });

  it('refuses rather than substituting when the approved account is gone', async () => {
    setAccounts([bob], 'bob');

    await expect(dispatchAs(alice.id)).rejects.toThrow(/no longer available/);
  });
});
