import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type VaultImportResult,
  useVaultManagement,
  vaultBackupFileName,
} from '@/composables/useVaultManagement';
import type { VaultBackupSaveResult } from '@/services/vault-backup-download';

const testState = vi.hoisted(() => ({
  saveVaultBackupMock: vi.fn<(fileName: string, contents: string) => Promise<unknown>>(),
  exportVaultMock: vi.fn(),
  importVaultMock: vi.fn(),
}));

vi.mock('@/services/vault-backup-download', () => ({
  saveVaultBackup: testState.saveVaultBackupMock,
}));

vi.mock('@/services/vault-service', () => ({
  exportVault: testState.exportVaultMock,
  importVault: testState.importVaultMock,
}));

interface HarnessVm {
  exportVaultBackup: () => Promise<VaultBackupSaveResult>;
  importVaultFromFile: (file: File, password: string) => Promise<VaultImportResult>;
}

const TestHarness = defineComponent({
  name: 'UseVaultManagementHarness',
  setup() {
    return useVaultManagement();
  },
  template: '<div />',
});

describe('useVaultManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('exportVaultBackup (#314)', () => {
    const exportBackup = () => (mount(TestHarness).vm as unknown as HarnessVm).exportVaultBackup();

    it('saves the same versioned backup file as before, through the Save As port', async () => {
      testState.exportVaultMock.mockResolvedValue({ success: true, encryptedData: 'v2:abc' });
      testState.saveVaultBackupMock.mockResolvedValue({ status: 'saved', path: '/tmp/b.json' });

      await expect(exportBackup()).resolves.toEqual({ status: 'saved', path: '/tmp/b.json' });

      expect(testState.saveVaultBackupMock).toHaveBeenCalledTimes(1);
      const [filename, contentJson] = testState.saveVaultBackupMock.mock.calls[0]!;
      expect(filename).toMatch(/^diogel-vault-backup-\d{4}-\d{2}-\d{2}\.json$/);
      const content = JSON.parse(contentJson) as Record<string, unknown>;
      expect(content).toEqual({
        version: 1,
        encryptedData: 'v2:abc',
        exportedAt: expect.any(String),
      });
    });

    it("passes the port's cancelled and failed results straight through", async () => {
      testState.exportVaultMock.mockResolvedValue({ success: true, encryptedData: 'v2:abc' });

      testState.saveVaultBackupMock.mockResolvedValueOnce({ status: 'cancelled' });
      await expect(exportBackup()).resolves.toEqual({ status: 'cancelled' });

      testState.saveVaultBackupMock.mockResolvedValueOnce({ status: 'failed', error: 'disk full' });
      await expect(exportBackup()).resolves.toEqual({ status: 'failed', error: 'disk full' });
    });

    it('fails without opening a Save As dialog when the vault cannot be exported', async () => {
      testState.exportVaultMock.mockResolvedValue({
        success: false,
        error: 'No vault found',
        code: 'VLT_NOT_CREATED',
      });

      await expect(exportBackup()).resolves.toEqual({ status: 'failed', error: 'No vault found' });
      expect(testState.saveVaultBackupMock).not.toHaveBeenCalled();
    });
  });

  describe('vaultBackupFileName', () => {
    it('names the backup after the day it was made', () => {
      expect(vaultBackupFileName(new Date('2026-10-17T21:00:00Z'))).toBe(
        'diogel-vault-backup-2026-10-17.json',
      );
    });
  });

  describe('importVaultFromFile (#313)', () => {
    const backupFile = (content: string) =>
      new File([content], 'backup.json', { type: 'application/json' });
    const backup = (encryptedData: unknown) => backupFile(JSON.stringify({ encryptedData }));

    const importFrom = (file: File, password = 'pw') => {
      const vm = mount(TestHarness).vm as unknown as HarnessVm;
      return vm.importVaultFromFile(file, password);
    };

    it("sends the backup's encrypted data and password, and reports success", async () => {
      testState.importVaultMock.mockResolvedValue({ success: true });

      await expect(importFrom(backup('v2:abc'), 'secret')).resolves.toEqual({ success: true });

      expect(testState.importVaultMock).toHaveBeenCalledWith('v2:abc', 'secret');
    });

    it('reports a wrong password when the background refuses it', async () => {
      testState.importVaultMock.mockResolvedValue({
        success: false,
        error: 'Invalid password',
        code: 'VLT_INVALID_PASSWORD',
      });

      await expect(importFrom(backup('v2:abc'))).resolves.toEqual({
        success: false,
        reason: 'wrongPassword',
      });
    });

    it('reports an invalid file when the background finds no Porwr vault in it', async () => {
      testState.importVaultMock.mockResolvedValue({
        success: false,
        error: 'Invalid vault format',
        code: 'GEN_INVALID_INPUT',
      });

      await expect(importFrom(backup('v2:corrupt'))).resolves.toEqual({
        success: false,
        reason: 'invalidFile',
      });
    });

    it('reports an invalid file, without asking the background, for a file that is not JSON', async () => {
      await expect(importFrom(backupFile('not json'))).resolves.toEqual({
        success: false,
        reason: 'invalidFile',
      });
      expect(testState.importVaultMock).not.toHaveBeenCalled();
    });

    it('reports an invalid file, without asking the background, when there is no encryptedData', async () => {
      await expect(importFrom(backupFile(JSON.stringify({ other: true })))).resolves.toEqual({
        success: false,
        reason: 'invalidFile',
      });
      await expect(importFrom(backup(42))).resolves.toEqual({
        success: false,
        reason: 'invalidFile',
      });
      expect(testState.importVaultMock).not.toHaveBeenCalled();
    });

    it('reports a general failure for any other refusal or a rejected call', async () => {
      testState.importVaultMock.mockResolvedValueOnce({ success: false, code: 'GEN_UNKNOWN' });
      await expect(importFrom(backup('v2:abc'))).resolves.toEqual({
        success: false,
        reason: 'failed',
      });

      testState.importVaultMock.mockRejectedValueOnce(new Error('network unreachable'));
      await expect(importFrom(backup('v2:abc'))).resolves.toEqual({
        success: false,
        reason: 'failed',
      });
    });
  });
});
