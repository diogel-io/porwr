import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type VaultImportResult, useVaultManagement } from '@/composables/useVaultManagement';

const testState = vi.hoisted(() => ({
  notifyMock: vi.fn(),
  exportFileMock: vi.fn(
    (_fileName: string, _rawData: string, _opts?: string): true | Error => true,
  ),
  exportVaultMock: vi.fn(),
  importVaultMock: vi.fn(),
}));

vi.mock('quasar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('quasar')>();
  return {
    ...actual,
    useQuasar: () => ({
      notify: testState.notifyMock,
    }),
    exportFile: testState.exportFileMock,
  };
});

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('@/services/vault-service', () => ({
  exportVault: testState.exportVaultMock,
  importVault: testState.importVaultMock,
}));

interface HarnessVm {
  handleExportVault: () => Promise<void>;
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
    testState.exportFileMock.mockReturnValue(true);
  });

  describe('handleExportVault', () => {
    it('exports a versioned backup file on success', async () => {
      testState.exportVaultMock.mockResolvedValue({ success: true, encryptedData: 'v2:abc' });
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;

      await vm.handleExportVault();

      expect(testState.exportFileMock).toHaveBeenCalledTimes(1);
      const [filename, contentJson, mime] = testState.exportFileMock.mock.calls[0]!;
      expect(filename).toMatch(/^diogel-vault-backup-\d{4}-\d{2}-\d{2}\.json$/);
      expect(mime).toBe('application/json');
      const content = JSON.parse(contentJson) as { version: number; encryptedData: string };
      expect(content).toMatchObject({ version: 1, encryptedData: 'v2:abc' });
      expect(testState.notifyMock).not.toHaveBeenCalled();
    });

    it('notifies when the browser denies the file save', async () => {
      testState.exportVaultMock.mockResolvedValue({ success: true, encryptedData: 'v2:abc' });
      testState.exportFileMock.mockReturnValue(new Error('User denied the save dialog'));
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;

      await vm.handleExportVault();

      expect(testState.notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'negative', message: 'settings.exportDeny' }),
      );
    });

    it('notifies with a formatted error when exportVault fails', async () => {
      testState.exportVaultMock.mockResolvedValue({
        success: false,
        error: 'No vault found',
        code: 'VLT_NOT_CREATED',
      });
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;

      await vm.handleExportVault();

      expect(testState.exportFileMock).not.toHaveBeenCalled();
      expect(testState.notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'negative' }),
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
