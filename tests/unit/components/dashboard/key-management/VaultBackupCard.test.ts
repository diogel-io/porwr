import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const vault = vi.hoisted(() => ({
  handleExportVault: vi.fn(),
  triggerImport: vi.fn(),
  handleFileImport: vi.fn(),
}));

vi.mock('@/composables/useVaultManagement', () => ({
  useVaultManagement: () => ({ fileInput: null, ...vault }),
}));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

import VaultBackupCard from '@/components/dashboard/key-management/VaultBackupCard.vue';

const mountCard = () =>
  mount(VaultBackupCard, {
    global: {
      stubs: {
        'q-card': { template: '<div><slot /></div>' },
        'q-card-section': { template: '<section><slot /></section>' },
        'q-btn': {
          template: '<button :data-label="label" @click="$emit(\'click\')">{{ label }}</button>',
          props: ['label'],
          emits: ['click'],
        },
      },
    },
  });

describe('VaultBackupCard (#297)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is titled Vault Backup & Restore', () => {
    expect(mountCard().find('h2').text()).toBe('keyManagement.vaultBackup.title');
  });

  it('puts Import first, on the left, and Export second, on the right', () => {
    const wrapper = mountCard();
    const columns = wrapper.findAll('[data-testid^="vault-backup-"]');

    expect(columns.map((column) => column.attributes('data-testid'))).toEqual([
      'vault-backup-import',
      'vault-backup-export',
    ]);
    expect(columns[0]!.text()).toContain('settings.importVault');
    expect(columns[0]!.text()).toContain('settings.importVaultCaption');
    expect(columns[1]!.text()).toContain('settings.exportVault');
    expect(columns[1]!.text()).toContain('settings.exportVaultCaption');
    expect(columns[1]!.classes()).toContain('vault-backup-card__export');
  });

  it('starts an import from the Import button and hands the chosen file over', async () => {
    const wrapper = mountCard();

    await wrapper.find('[data-label="settings.import"]').trigger('click');
    await wrapper.find('input[type="file"]').trigger('change');

    expect(vault.triggerImport).toHaveBeenCalledOnce();
    expect(vault.handleFileImport).toHaveBeenCalledOnce();
    expect(wrapper.find('input[type="file"]').attributes('accept')).toBe('.json');
  });

  it('exports from the Export button', async () => {
    const wrapper = mountCard();

    await wrapper.find('[data-label="settings.export"]').trigger('click');

    expect(vault.handleExportVault).toHaveBeenCalledOnce();
    expect(vault.triggerImport).not.toHaveBeenCalled();
  });
});
