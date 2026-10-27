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
    expect(mountCard().find('h2').text()).toBe('keyManagement.vaultBackupCard.title');
  });

  it('puts Backup first, on the left, and Restore second, on the right (#390)', () => {
    const wrapper = mountCard();
    const columns = wrapper.findAll('[data-testid^="vault-backup-"]');

    expect(columns.map((column) => column.attributes('data-testid'))).toEqual([
      'vault-backup-backup',
      'vault-backup-restore',
    ]);
    expect(columns[0]!.text()).toContain('keyManagement.vaultBackupCard.backup');
    expect(columns[0]!.text()).toContain('keyManagement.vaultBackupCard.backupCaption');
    expect(columns[1]!.text()).toContain('keyManagement.vaultBackupCard.restore');
    expect(columns[1]!.text()).toContain('keyManagement.vaultBackupCard.restoreCaption');
    expect(columns[1]!.classes()).toContain('vault-backup-card__restore');
  });

  it('labels the buttons Backup and Restore, with no Import or Export wording (#390)', () => {
    const wrapper = mountCard();

    expect(wrapper.findAll('button').map((button) => button.attributes('data-label'))).toEqual([
      'keyManagement.vaultBackupCard.backup',
      'keyManagement.vaultBackupCard.restore',
    ]);
    expect(wrapper.text()).not.toMatch(/settings\.(import|export)/);
  });

  it('sends Backup to the vault backup page rather than downloading straight away (#314)', () => {
    const backupButton = mountCard().get('[data-label="keyManagement.vaultBackupCard.backup"]');

    expect(JSON.parse(backupButton.attributes('data-to')!)).toEqual({ name: 'backup-vault' });
  });

  it('sends Restore to the vault restore page rather than opening a file picker (#313)', () => {
    const wrapper = mountCard();

    const restoreButton = wrapper.get('[data-label="keyManagement.vaultBackupCard.restore"]');
    expect(JSON.parse(restoreButton.attributes('data-to')!)).toEqual({ name: 'restore-vault' });
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
  });
});
