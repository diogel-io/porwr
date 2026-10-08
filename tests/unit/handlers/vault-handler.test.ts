import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VaultData } from '@/types/bridge';

const mockUnlockVault = vi.fn();
const mockLockVault = vi.fn();
const mockIsVaultUnlocked = vi.fn();
const mockCreateNewVault = vi.fn();
const mockExportVault = vi.fn();
const mockImportVault = vi.fn();
const mockGetVaultData = vi.fn();
const mockUpdateVaultData = vi.fn();
const mockRestoreVaultState = vi.fn();

vi.mock('@/../src-bex/vault', () => ({
  unlockVault: mockUnlockVault,
  lockVault: mockLockVault,
  isVaultUnlocked: mockIsVaultUnlocked,
  createNewVault: mockCreateNewVault,
  exportVault: mockExportVault,
  importVault: mockImportVault,
  getVaultData: mockGetVaultData,
  updateVaultData: mockUpdateVaultData,
  restoreVaultState: mockRestoreVaultState,
}));

const vaultData: VaultData = {
  accounts: [{ id: 'pubkey-hex', alias: 'alpha', account: { privkey: 'secret' }, createdAt: '2026-01-01T00:00:00.000Z' }],
};

describe('vault-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handleVaultUnlock returns vaultData on success', async () => {
    const { handleVaultUnlock } = await import('@/../src-bex/handlers/vault-handler');
    mockUnlockVault.mockResolvedValue({ success: true, vaultData });

    const result = await handleVaultUnlock({ password: 'pw' }, '');

    expect(mockUnlockVault).toHaveBeenCalledWith('pw');
    expect(result).toEqual({ success: true, data: { vaultData } });
  });

  it('handleVaultUnlock surfaces the failure error and code', async () => {
    const { handleVaultUnlock } = await import('@/../src-bex/handlers/vault-handler');
    mockUnlockVault.mockResolvedValue({ success: false, error: 'Invalid password', errorCode: 'VLT_INVALID_PASSWORD' });

    const result = await handleVaultUnlock({ password: 'wrong' }, '');

    expect(result).toEqual({ success: false, error: 'Invalid password', code: 'VLT_INVALID_PASSWORD' });
  });

  it('handleVaultLock always succeeds and calls lock()', async () => {
    const { handleVaultLock } = await import('@/../src-bex/handlers/vault-handler');

    const result = await handleVaultLock(undefined, '');

    expect(mockLockVault).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, data: undefined });
  });

  it('handleVaultIsUnlocked reflects the underlying vault state', async () => {
    const { handleVaultIsUnlocked } = await import('@/../src-bex/handlers/vault-handler');
    mockIsVaultUnlocked.mockReturnValue(true);

    const result = await handleVaultIsUnlocked(undefined, '');

    expect(result).toEqual({ success: true, data: true });
  });

  it('handleVaultCreate returns the encrypted vault on success', async () => {
    const { handleVaultCreate } = await import('@/../src-bex/handlers/vault-handler');
    mockCreateNewVault.mockResolvedValue({ success: true, encryptedVault: 'v2:abc' });

    const result = await handleVaultCreate({ password: 'pw', vaultData }, '');

    expect(mockCreateNewVault).toHaveBeenCalledWith('pw', vaultData);
    expect(result).toEqual({ success: true, data: { encryptedVault: 'v2:abc' } });
  });

  it('handleVaultCreate surfaces failure', async () => {
    const { handleVaultCreate } = await import('@/../src-bex/handlers/vault-handler');
    mockCreateNewVault.mockResolvedValue({ success: false, error: 'boom', errorCode: 'GEN_UNKNOWN' });

    const result = await handleVaultCreate({ password: 'pw', vaultData }, '');

    expect(result).toEqual({ success: false, error: 'boom', code: 'GEN_UNKNOWN' });
  });

  it('handleVaultGetData returns vaultData on success', async () => {
    const { handleVaultGetData } = await import('@/../src-bex/handlers/vault-handler');
    mockGetVaultData.mockResolvedValue({ success: true, vaultData });

    const result = await handleVaultGetData(undefined, '');

    expect(result).toEqual({ success: true, data: { vaultData } });
  });

  it('handleVaultUpdateData delegates and succeeds', async () => {
    const { handleVaultUpdateData } = await import('@/../src-bex/handlers/vault-handler');
    mockUpdateVaultData.mockResolvedValue({ success: true });

    const result = await handleVaultUpdateData({ vaultData }, '');

    expect(mockUpdateVaultData).toHaveBeenCalledWith(vaultData);
    expect(result).toEqual({ success: true, data: undefined });
  });

  it('handleVaultExport returns encryptedData on success', async () => {
    const { handleVaultExport } = await import('@/../src-bex/handlers/vault-handler');
    mockExportVault.mockResolvedValue({ success: true, encryptedData: 'v2:xyz' });

    const result = await handleVaultExport(undefined, '');

    expect(result).toEqual({ success: true, data: { encryptedData: 'v2:xyz' } });
  });

  it('handleVaultImport delegates and succeeds', async () => {
    const { handleVaultImport } = await import('@/../src-bex/handlers/vault-handler');
    mockImportVault.mockResolvedValue({ success: true });

    const result = await handleVaultImport({ encryptedData: 'v2:xyz' }, '');

    expect(mockImportVault).toHaveBeenCalledWith('v2:xyz');
    expect(result).toEqual({ success: true, data: undefined });
  });

  it('re-exports restoreVaultState from ../vault', async () => {
    const { restoreVaultState } = await import('@/../src-bex/handlers/vault-handler');
    mockRestoreVaultState.mockResolvedValue(true);

    await expect(restoreVaultState()).resolves.toBe(true);
  });
});
