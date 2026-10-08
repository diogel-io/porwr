import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVaultManagement } from '@/composables/useVaultManagement';

const testState = vi.hoisted(() => ({
  notifyMock: vi.fn(),
  pushMock: vi.fn(async () => undefined),
  exportFileMock: vi.fn(
    (_fileName: string, _rawData: string, _opts?: string): true | Error => true,
  ),
  dialogOnOk: undefined as (() => void) | undefined,
  exportVaultMock: vi.fn(),
  importVaultMock: vi.fn(),
}));

vi.mock('quasar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('quasar')>();
  return {
    ...actual,
    useQuasar: () => ({
      notify: testState.notifyMock,
      dialog: () => ({
        onOk: (cb: () => void) => {
          testState.dialogOnOk = cb;
        },
      }),
    }),
    exportFile: testState.exportFileMock,
  };
});

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: testState.pushMock }),
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('@/services/vault-service', () => ({
  exportVault: testState.exportVaultMock,
  importVault: testState.importVaultMock,
}));

interface HarnessVm {
  fileInput: HTMLInputElement | null;
  handleExportVault: () => Promise<void>;
  triggerImport: () => void;
  handleFileImport: (event: Event) => void;
}

const TestHarness = defineComponent({
  name: 'UseVaultManagementHarness',
  setup() {
    return useVaultManagement();
  },
  template: '<input ref="fileInput" type="file" />',
});

describe('useVaultManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.dialogOnOk = undefined;
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
      testState.exportVaultMock.mockResolvedValue({ success: false, error: 'No vault found', code: 'VLT_NOT_CREATED' });
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;

      await vm.handleExportVault();

      expect(testState.exportFileMock).not.toHaveBeenCalled();
      expect(testState.notifyMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
    });
  });

  describe('triggerImport', () => {
    it('clicks the hidden file input', () => {
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;
      const clickSpy = vi.spyOn(wrapper.find('input').element, 'click');

      vm.triggerImport();

      expect(clickSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleFileImport', () => {
    function fileImportEvent(file: File | undefined): Event {
      return { target: { files: file ? [file] : [] } } as unknown as Event;
    }

    it('does nothing when no file was selected', () => {
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;

      vm.handleFileImport(fileImportEvent(undefined));

      expect(testState.dialogOnOk).toBeUndefined();
    });

    it('imports the vault and redirects to login on success after confirmation', async () => {
      testState.importVaultMock.mockResolvedValue({ success: true });
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;
      const file = new File([JSON.stringify({ encryptedData: 'v2:abc' })], 'backup.json', {
        type: 'application/json',
      });

      vm.handleFileImport(fileImportEvent(file));
      expect(testState.dialogOnOk).toBeDefined();
      testState.dialogOnOk!();

      await vi.waitFor(() => expect(testState.notifyMock).toHaveBeenCalled());

      expect(testState.importVaultMock).toHaveBeenCalledWith('v2:abc');
      expect(testState.pushMock).toHaveBeenCalledWith({ name: 'login' });
      expect(testState.notifyMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'positive' }));
    });

    it('notifies with a formatted error and does not redirect when importVault resolves unsuccessfully', async () => {
      testState.importVaultMock.mockResolvedValue({ success: false, error: 'Invalid vault format', code: 'GEN_INVALID_INPUT' });
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;
      const file = new File([JSON.stringify({ encryptedData: 'v2:corrupt' })], 'backup.json', {
        type: 'application/json',
      });

      vm.handleFileImport(fileImportEvent(file));
      testState.dialogOnOk!();
      await vi.waitFor(() => expect(testState.notifyMock).toHaveBeenCalled());

      expect(testState.pushMock).not.toHaveBeenCalled();
      expect(testState.notifyMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
    });

    it('notifies with the rejection message when importVault itself rejects', async () => {
      testState.importVaultMock.mockRejectedValue(new Error('network unreachable'));
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;
      const file = new File([JSON.stringify({ encryptedData: 'v2:abc' })], 'backup.json', {
        type: 'application/json',
      });

      vm.handleFileImport(fileImportEvent(file));
      testState.dialogOnOk!();
      await vi.waitFor(() => expect(testState.notifyMock).toHaveBeenCalled());

      expect(testState.notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'negative', message: 'network unreachable' }),
      );
    });

    it('notifies without redirecting when the backup file has no encryptedData', async () => {
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;
      const file = new File([JSON.stringify({ notAValidBackup: true })], 'backup.json', {
        type: 'application/json',
      });

      vm.handleFileImport(fileImportEvent(file));
      testState.dialogOnOk!();
      await vi.waitFor(() => expect(testState.notifyMock).toHaveBeenCalled());

      expect(testState.importVaultMock).not.toHaveBeenCalled();
      expect(testState.notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'negative', message: 'settings.importInvalid' }),
      );
    });

    it('notifies with a parse error when the file is not valid JSON', async () => {
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;
      const file = new File(['not json'], 'backup.json', { type: 'application/json' });

      vm.handleFileImport(fileImportEvent(file));
      testState.dialogOnOk!();
      await vi.waitFor(() => expect(testState.notifyMock).toHaveBeenCalled());

      expect(testState.notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'negative' }),
      );
      const message = testState.notifyMock.mock.calls[0]?.[0] as { message: string };
      expect(message.message).toContain('settings.importParseError');
    });
  });
});
