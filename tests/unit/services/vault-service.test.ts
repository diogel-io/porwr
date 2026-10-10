import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockDbVaultsGet = vi.fn();

vi.mock('@/services/database', () => ({
  db: {
    vaults: {
      get: mockDbVaultsGet,
    },
  },
}));

type BridgeWindow = Window & {
  bridge?: { send: (request: unknown) => Promise<unknown> } | undefined;
  $q?: { bex?: { send: (request: unknown) => Promise<unknown> } };
};

function setBridge(send: ((request: unknown) => Promise<unknown>) | undefined) {
  (window as BridgeWindow).bridge = send ? { send } : undefined;
}

function setChromeRuntime(sendMessage: typeof chrome.runtime.sendMessage | undefined) {
  if (sendMessage) {
    vi.stubGlobal('chrome', { runtime: { sendMessage, lastError: undefined } });
  } else {
    vi.unstubAllGlobals();
  }
}

describe('vault-service (bridge messaging)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setBridge(undefined);
    setChromeRuntime(undefined);
  });

  afterEach(() => {
    setBridge(undefined);
    setChromeRuntime(undefined);
  });

  it('unlockVault succeeds via the Quasar bridge when available', async () => {
    setBridge(async () => ({ data: { success: true, vaultData: { accounts: [] } } }));

    const { unlockVault } = await import('@/services/vault-service');
    const result = await unlockVault('correct-password');

    expect(result).toEqual({ success: true, vaultData: { accounts: [] } });
  });

  it('unlockVault falls back to chrome.runtime.sendMessage when no bridge is present', async () => {
    setChromeRuntime(((message, callback) => {
      (callback as (response: unknown) => void)({ success: true, vaultData: { accounts: [] } });
    }) as typeof chrome.runtime.sendMessage);

    const { unlockVault } = await import('@/services/vault-service');
    const result = await unlockVault('correct-password');

    expect(result).toEqual({ success: true, vaultData: { accounts: [] } });
  });

  it('unlockVault returns a failure result when neither bridge nor chrome.runtime exist', async () => {
    const { unlockVault } = await import('@/services/vault-service');
    const result = await unlockVault('any-password');

    expect(result.success).toBe(false);
    expect(result.error).toContain('No communication channel available');
  });

  it('lockVault swallows errors from the bridge without throwing', async () => {
    setBridge(async () => {
      throw new Error('bridge down');
    });

    const { lockVault } = await import('@/services/vault-service');
    await expect(lockVault()).resolves.toBeUndefined();
  });

  it('createVault forwards password and vaultData through the bridge', async () => {
    const send = vi.fn().mockResolvedValue({ data: { success: true, encryptedVault: 'v2:abc' } });
    setBridge(send);

    const { createVault } = await import('@/services/vault-service');
    const result = await createVault('pw', { accounts: [] });

    expect(send).toHaveBeenCalledWith({
      event: 'vault.create',
      to: 'background',
      payload: { password: 'pw', vaultData: { accounts: [] } },
    });
    expect(result).toEqual({ success: true, encryptedVault: 'v2:abc' });
  });

  it('isVaultUnlocked returns the bridge boolean response', async () => {
    setBridge(async () => ({ data: true }));

    const { isVaultUnlocked } = await import('@/services/vault-service');
    await expect(isVaultUnlocked()).resolves.toBe(true);
  });

  it('isVaultUnlocked returns false when the bridge throws', async () => {
    setBridge(async () => {
      throw new Error('bridge down');
    });

    const { isVaultUnlocked } = await import('@/services/vault-service');
    await expect(isVaultUnlocked()).resolves.toBe(false);
  });

  it('getVaultView returns the view: accounts by id, alias and creation date (#240)', async () => {
    const send = vi.fn().mockResolvedValue({ data: { accounts: [{ id: 'a', alias: 'main', createdAt: 't' }] } });
    setBridge(send);

    const { getVaultView } = await import('@/services/vault-service');

    await expect(getVaultView()).resolves.toEqual({ accounts: [{ id: 'a', alias: 'main', createdAt: 't' }] });
    expect(send).toHaveBeenCalledWith({ event: 'vault.getView', to: 'background', payload: undefined });
  });

  it('getVaultView turns a refusal into an error', async () => {
    setBridge(async () => ({ data: { success: false, error: 'Vault is locked' } }));

    const { getVaultView } = await import('@/services/vault-service');
    await expect(getVaultView()).rejects.toThrow('Vault is locked');
  });

  it('exportVault returns the encrypted payload on success', async () => {
    setBridge(async () => ({ data: { success: true, encryptedData: 'v2:xyz' } }));

    const { exportVault } = await import('@/services/vault-service');
    await expect(exportVault()).resolves.toEqual({ success: true, encryptedData: 'v2:xyz' });
  });

  it('importVault forwards the encrypted data', async () => {
    const send = vi.fn().mockResolvedValue({ data: { success: true } });
    setBridge(send);

    const { importVault } = await import('@/services/vault-service');
    const result = await importVault('v2:xyz');

    expect(send).toHaveBeenCalledWith({
      event: 'vault.import',
      to: 'background',
      payload: { encryptedData: 'v2:xyz' },
    });
    expect(result).toEqual({ success: true });
  });
});

describe('vault-service hasVault (direct DB access)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when a master vault record exists', async () => {
    mockDbVaultsGet.mockResolvedValue({ id: 'master', encryptedData: 'v2:abc', createdAt: '2026-01-01T00:00:00.000Z' });

    const { hasVault } = await import('@/services/vault-service');
    await expect(hasVault()).resolves.toBe(true);
  });

  it('returns false when no master vault record exists', async () => {
    mockDbVaultsGet.mockResolvedValue(undefined);

    const { hasVault } = await import('@/services/vault-service');
    await expect(hasVault()).resolves.toBe(false);
  });

  it('returns false when the database read rejects', async () => {
    mockDbVaultsGet.mockRejectedValue(new Error('db unavailable'));

    const { hasVault } = await import('@/services/vault-service');
    await expect(hasVault()).resolves.toBe(false);
  });
});
