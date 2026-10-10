import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchMessage } from '@/../src-bex/dispatcher';
import { handleRelayBrowserList, handleRelayBrowserGetStatus } from '@/../src-bex/handlers/relay-browser-handler';
import { handleVaultUnlock } from '@/../src-bex/handlers/vault-handler';
import { handleBlossomUpload } from '@/../src-bex/handlers/blossom-handler';
import { handleNip44Encrypt, handleNip44Decrypt } from '@/../src-bex/handlers/nip44';
import { handleNip04Encrypt, handleNip04Decrypt } from '@/../src-bex/handlers/nip04';
import { handleGetPublicKey, handleSignEvent } from '@/../src-bex/handlers/nip07';
import { getPageOrigin } from '@/../src-bex/services/page-origin-registry';
import type { RelayCatalogEntry, RelayDiscoveryState } from '@/types/relay';
import { createBridgeRequest } from '@/types/bridge';
import type { VaultData } from '@/types/bridge';

// Mock handlers
vi.mock('@/../src-bex/handlers/vault-handler', () => ({
  handleVaultUnlock: vi.fn(),
  handleVaultLock: vi.fn(),
  handleVaultIsUnlocked: vi.fn(),
  handleVaultCreate: vi.fn(),
  handleVaultGetData: vi.fn(),
  handleVaultUpdateData: vi.fn(),
  handleVaultExport: vi.fn(),
  handleVaultImport: vi.fn(),
}));

const autoLockMocks = vi.hoisted(() => ({
  resetAutoLockTimer: vi.fn(),
  startAutoLockTimer: vi.fn(),
  stopAutoLockTimer: vi.fn(),
}));

vi.mock('@/../src-bex/services/auto-lock', () => autoLockMocks);

vi.mock('@/../src-bex/handlers/nip07', () => ({
  handleGetPublicKey: vi.fn(),
  handleSignEvent: vi.fn(),
}));

vi.mock('@/../src-bex/handlers/blossom-handler', () => ({
  handleBlossomUpload: vi.fn(),
}));

vi.mock('@/../src-bex/handlers/nip04', () => ({
  handleNip04Encrypt: vi.fn(),
  handleNip04Decrypt: vi.fn(),
}));

vi.mock('@/../src-bex/handlers/nip44', () => ({
  handleNip44Encrypt: vi.fn(),
  handleNip44Decrypt: vi.fn(),
}));

vi.mock('@/../src-bex/services/page-origin-registry', () => ({
  getPageOrigin: vi.fn(),
}));

vi.mock('@/../src-bex/handlers/relay-browser-handler', () => ({
  handleRelayBrowserList: vi.fn(),
  handleRelayBrowserGetStatus: vi.fn(),
}));

describe('Dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should route ping action correctly', async () => {
    const result = await dispatchMessage('ping', createBridgeRequest('ping', {}));
    expect(result).toBe('pong');
  });

  it('should route relay.browser.list correctly', async () => {
    const mockEntries: RelayCatalogEntry[] = [{
      url: 'wss://relay.com',
      hostname: 'relay.com',
      isUserAdded: false,
      isSeed: true,
      status: 'online',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];
    vi.mocked(handleRelayBrowserList).mockResolvedValue({ success: true, data: mockEntries });

    const result = await dispatchMessage('relay.browser.list', createBridgeRequest('relay.browser.list', {}));

    expect(result).toEqual(mockEntries);
    expect(handleRelayBrowserList).toHaveBeenCalled();
  });

  it('should return empty array for relay.browser.list when handler fails', async () => {
    vi.mocked(handleRelayBrowserList).mockResolvedValue({ success: false, error: 'Fail' });

    const result = await dispatchMessage('relay.browser.list', createBridgeRequest('relay.browser.list', {}));

    expect(result).toEqual([]);
    expect(handleRelayBrowserList).toHaveBeenCalled();
  });

  it('should route relay.browser.getStatus correctly', async () => {
    const mockStatus: RelayDiscoveryState = {
      id: 'global',
      isDiscoveryInProgress: false,
      updatedAt: Date.now(),
    };
    vi.mocked(handleRelayBrowserGetStatus).mockResolvedValue({ success: true, data: mockStatus });

    const result = await dispatchMessage('relay.browser.getStatus', createBridgeRequest('relay.browser.getStatus', {}));

    expect(result).toEqual(mockStatus);
    expect(handleRelayBrowserGetStatus).toHaveBeenCalled();
  });

  it('should return null for relay.browser.getStatus when handler fails', async () => {
    vi.mocked(handleRelayBrowserGetStatus).mockResolvedValue({ success: false, error: 'Fail' });

    const result = await dispatchMessage('relay.browser.getStatus', createBridgeRequest('relay.browser.getStatus', {}));

    expect(result).toBeNull();
    expect(handleRelayBrowserGetStatus).toHaveBeenCalled();
  });

  it('should await activity.mark auto-lock persistence', async () => {
    autoLockMocks.resetAutoLockTimer.mockResolvedValue(undefined);

    const result = await dispatchMessage('activity.mark', createBridgeRequest('activity.mark', {}));

    expect(result).toBe(true);
    expect(autoLockMocks.resetAutoLockTimer).toHaveBeenCalled();
  });

  it('should await resetAutoLockTimer before starting timer on vault unlock', async () => {
    autoLockMocks.resetAutoLockTimer.mockResolvedValue(undefined);
    autoLockMocks.startAutoLockTimer.mockReturnValue(undefined);
    const mockVaultData: { vaultData: VaultData } = { vaultData: { accounts: [] } };
    vi.mocked(handleVaultUnlock).mockResolvedValue({ success: true, data: mockVaultData });

    const result = await dispatchMessage('vault.unlock', createBridgeRequest('vault.unlock', { password: 'test-password' }));

    // The decrypted vault stays in the background (#240).
    expect(result).toEqual({ success: true });
    expect(autoLockMocks.resetAutoLockTimer).toHaveBeenCalled();
    expect(autoLockMocks.startAutoLockTimer).toHaveBeenCalled();
    expect(
      autoLockMocks.resetAutoLockTimer.mock.invocationCallOrder[0]!,
    ).toBeLessThan(autoLockMocks.startAutoLockTimer.mock.invocationCallOrder[0]!);
  });

  it('should return undefined for unknown message type', async () => {
    const result = await dispatchMessage('unknown.action' as never, { id: 'test', action: 'unknown.action' } as never);
    expect(result).toBeUndefined();
  });

  it('should route blossom.upload to handler and return success response', async () => {
    vi.mocked(handleBlossomUpload).mockResolvedValue({
      success: true,
      data: 'https://blossom.example.com/image.png',
    });

    const result = await dispatchMessage('blossom.upload', {
      id: 'test-1',
      action: 'blossom.upload',
      base64Data: 'iVBORw...',
      fileType: 'image/png',
      blossomServer: 'https://blossom.example.com',
    });

    expect(result).toEqual({
      success: true,
      url: 'https://blossom.example.com/image.png',
    });
    expect(handleBlossomUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        base64Data: 'iVBORw...',
        fileType: 'image/png',
        blossomServer: 'https://blossom.example.com',
      }),
      expect.any(String),
    );
  });

  it('should route blossom.upload and return error response on handler failure', async () => {
    vi.mocked(handleBlossomUpload).mockResolvedValue({
      success: false,
      error: 'No active account found',
    });

    const result = await dispatchMessage('blossom.upload', {
      id: 'test-2',
      action: 'blossom.upload',
      base64Data: 'abc',
      fileType: 'image/jpeg',
      blossomServer: 'https://blossom.example.com',
    });

    expect(result).toEqual({
      success: false,
      error: 'No active account found',
    });
  });

  it('should route nostr.nip44.encrypt to handler', async () => {
    vi.mocked(handleNip44Encrypt).mockResolvedValue({ success: true, data: 'nip44-ciphertext' });

    const result = await dispatchMessage(
      'nostr.nip44.encrypt',
      createBridgeRequest('nostr.nip44.encrypt', {
        origin: 'https://app.example',
        pubkey: 'recipient-pubkey',
        plaintext: 'hello',
      }),
      'https://app.example',
    );

    expect(result).toBe('nip44-ciphertext');
    expect(handleNip44Encrypt).toHaveBeenCalledWith(
      expect.objectContaining({ pubkey: 'recipient-pubkey', plaintext: 'hello' }),
      'https://app.example',
    );
  });

  it('should route nostr.nip44.decrypt to handler', async () => {
    vi.mocked(handleNip44Decrypt).mockResolvedValue({ success: true, data: 'hello' });

    const result = await dispatchMessage(
      'nostr.nip44.decrypt',
      createBridgeRequest('nostr.nip44.decrypt', {
        origin: 'https://app.example',
        pubkey: 'sender-pubkey',
        ciphertext: 'nip44-ciphertext',
      }),
      'https://app.example',
    );

    expect(result).toBe('hello');
    expect(handleNip44Decrypt).toHaveBeenCalledWith(
      expect.objectContaining({ pubkey: 'sender-pubkey', ciphertext: 'nip44-ciphertext' }),
      'https://app.example',
    );
  });

  /**
   * Every action that acts on a site's behalf must reach its handler with the origin intact (#173).
   *
   * `message-routing` refuses to dispatch these without an origin; this is the other half — that the
   * dispatcher then passes the one it was given through rather than dropping it. A handler that
   * received an empty origin would check permissions for nowhere and sign for anyone.
   */
  describe('origin pass-through', () => {
    const ORIGIN = 'https://example.com';

    const cases = [
      { action: 'nostr.getPublicKey', handler: () => handleGetPublicKey },
      { action: 'nostr.signEvent', handler: () => handleSignEvent },
      { action: 'nostr.nip04.encrypt', handler: () => handleNip04Encrypt },
      { action: 'nostr.nip04.decrypt', handler: () => handleNip04Decrypt },
      { action: 'nostr.nip44.encrypt', handler: () => handleNip44Encrypt },
      { action: 'nostr.nip44.decrypt', handler: () => handleNip44Decrypt },
    ] as const;

    for (const { action, handler } of cases) {
      it(`passes the origin to ${action}`, async () => {
        vi.mocked(handler()).mockResolvedValue({ success: true, data: 'ok' } as never);

        await dispatchMessage(
          action as 'nostr.getPublicKey',
          createBridgeRequest(action as 'nostr.getPublicKey', {
            pubkey: 'p',
            plaintext: 't',
            ciphertext: 'c',
            event: { kind: 1, content: '', tags: [], created_at: 0 },
          } as never),
          ORIGIN,
        );

        expect(handler()).toHaveBeenCalledWith(expect.anything(), ORIGIN);
      });
    }

    it('rejects with the handler error rather than swallowing it', async () => {
      vi.mocked(handleNip04Encrypt).mockResolvedValue({
        success: false,
        error: 'Vault is locked',
      } as never);

      await expect(
        dispatchMessage(
          'nostr.nip04.encrypt',
          createBridgeRequest('nostr.nip04.encrypt', {
            pubkey: 'p',
            plaintext: 't',
          } as never),
          ORIGIN,
        ),
      ).rejects.toThrow('Vault is locked');
    });

    it('returns undefined for an action it does not serve', async () => {
      // An unknown action falls through the switch. That is where "we do not serve that" belongs,
      // and it must not throw — the caller gets no response rather than an error page.
      //
      // `undefined` rather than `null`, and the difference is load-bearing: the raw message
      // listener stays silent for `undefined` and answers `null`. While both were `null` the
      // listener could not tell them apart, so it stayed silent for both, and a panel asking for
      // an empty queue waited on a reply that never came (#195).
      await expect(
        dispatchMessage('not.an.action' as 'ping', {} as never, ORIGIN),
      ).resolves.toBeUndefined();
    });

    it('answers null for an action it serves whose answer is null', async () => {
      // The other half of the distinction. `pages.originForTab` has no origin for an unknown tab,
      // and that is an answer the caller is entitled to receive.
      vi.mocked(getPageOrigin).mockReturnValue(undefined);

      await expect(
        dispatchMessage('pages.originForTab', { tabId: 999 } as never, ORIGIN),
      ).resolves.toBeNull();
    });
  });
});
