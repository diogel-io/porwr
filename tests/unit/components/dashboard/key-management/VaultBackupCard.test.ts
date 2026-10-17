import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

import VaultBackupCard from '@/components/dashboard/key-management/VaultBackupCard.vue';

const mountCard = () =>
  mount(VaultBackupCard, {
    global: {
      stubs: {
        'q-card': { template: '<div><slot /></div>' },
        'q-card-section': { template: '<section><slot /></section>' },
        'q-btn': {
          template:
            '<button :data-label="label" :data-to="JSON.stringify(to)" @click="$emit(\'click\')">{{ label }}</button>',
          props: ['label', 'to'],
          emits: ['click'],
        },
      },
    },
  });

describe('VaultBackupCard (#297)', () => {
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

  it('sends Import to the Import vault page rather than opening a file picker (#313)', () => {
    const wrapper = mountCard();

    const importButton = wrapper.get('[data-label="settings.import"]');
    expect(JSON.parse(importButton.attributes('data-to')!)).toEqual({ name: 'import-vault' });
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
  });

  it('sends Export to the Export vault page rather than downloading straight away (#314)', () => {
    const exportButton = mountCard().get('[data-label="settings.export"]');

    expect(JSON.parse(exportButton.attributes('data-to')!)).toEqual({ name: 'export-vault' });
  });
});
