import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The Vault Backup page explains the backup before it is saved, then says what happened (#314, #391). */

const testState = vi.hoisted(() => ({
  exportVaultBackup: vi.fn(),
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));
vi.mock('@/composables/useVaultManagement', () => ({
  useVaultManagement: () => ({ exportVaultBackup: testState.exportVaultBackup }),
}));

import BackupVaultPage from '@/pages/dashboard/BackupVaultPage.vue';

const slotStub = { template: '<div><slot /></div>' };

const mountPage = () =>
  mount(BackupVaultPage, {
    global: {
      stubs: {
        'q-page': slotStub,
        'q-card': slotStub,
        'q-card-section': slotStub,
        'q-banner': { template: '<div v-bind="$attrs"><slot /></div>' },
        'q-icon': true,
        // Stands in for vue-i18n's global <i18n-t>: shows the keypath and renders the link slot.
        'i18n-t': {
          props: ['keypath', 'tag'],
          template: '<li :data-keypath="keypath">{{ keypath }} <slot name="link" /></li>',
        },
        'dashboard-breadcrumbs': {
          props: ['items'],
          template: '<nav class="crumbs-stub" :data-items="JSON.stringify(items)" />',
        },
        'q-btn': {
          props: ['label', 'disable', 'loading'],
          emits: ['click'],
          template:
            '<button v-bind="$attrs" :disabled="disable" @click="$emit(\'click\')">{{ label }}</button>',
        },
      },
    },
  });

const backupButton = (wrapper: ReturnType<typeof mountPage>) =>
  wrapper.get('[data-testid="vault-backup-confirm"]');
const outcome = (wrapper: ReturnType<typeof mountPage>) =>
  wrapper.get('[data-testid="vault-backup-outcome"]');

describe('BackupVaultPage (#314, #391)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leads back to the Keys list and ends in the page title', () => {
    const crumb = mountPage().get('.crumbs-stub');

    expect(JSON.parse(crumb.attributes('data-items')!)).toEqual([
      { label: 'navigation.keys.label', to: { name: 'keys' } },
      { label: 'keyManagement.vaultBackup.title' },
    ]);
  });

  it('explains the backup, and what is needed to open it, before anything is saved', () => {
    const wrapper = mountPage();
    const info = wrapper.get('[data-testid="vault-backup-info"]').text();

    for (const point of ['whatItIs', 'password', 'lostPassword', 'keepSafe', 'separatePlace']) {
      expect(info).toContain(`keyManagement.vaultBackup.${point}`);
    }
    expect(wrapper.find('[data-testid="vault-backup-outcome"]').exists()).toBe(false);
    expect(testState.exportVaultBackup).not.toHaveBeenCalled();
  });

  it('is headed Important and lists the six points in order', () => {
    const info = mountPage().get('[data-testid="vault-backup-info"]');

    expect(info.text()).toContain('keyManagement.vaultBackup.infoTitle');
    expect(info.findAll('li').map((item) => item.text())).toEqual([
      'keyManagement.vaultBackup.whatItIs',
      'keyManagement.vaultBackup.password',
      'keyManagement.vaultBackup.lostPassword',
      'keyManagement.vaultBackup.keepSafe',
      'keyManagement.vaultBackup.separatePlace',
      'keyManagement.vaultBackup.docs keyManagement.vaultBackup.docsLink',
    ]);
  });

  it('links "the documentation" to the Porwr docs in a new tab, and has no other link', () => {
    const info = mountPage().get('[data-testid="vault-backup-info"]');
    const link = info.get('[data-testid="vault-backup-docs"]');

    expect(link.text()).toBe('keyManagement.vaultBackup.docsLink');
    expect(link.attributes('href')).toBe('https://diogel.io/docs/porwr');
    expect(link.attributes('target')).toBe('_blank');
    expect(link.attributes('rel')).toBe('noopener noreferrer');
    expect(info.findAll('a')).toHaveLength(1);
    expect(info.findAll('button')).toHaveLength(0);
  });

  it('labels the button Backup, and asks where to save while the dialog is open', async () => {
    let finish: (value: unknown) => void = () => undefined;
    testState.exportVaultBackup.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const wrapper = mountPage();
    expect(backupButton(wrapper).text()).toBe('keyManagement.vaultBackup.button');

    await backupButton(wrapper).trigger('click');
    expect(backupButton(wrapper).text()).toBe('keyManagement.vaultBackup.saving');

    finish({ status: 'cancelled' });
    await flushPromises();
    expect(backupButton(wrapper).text()).toBe('keyManagement.vaultBackup.button');
  });

  it('confirms a save, and says where the file went', async () => {
    testState.exportVaultBackup.mockResolvedValue({ status: 'saved', path: '/home/me/b.json' });
    const wrapper = mountPage();

    await backupButton(wrapper).trigger('click');
    await flushPromises();

    expect(outcome(wrapper).attributes('data-status')).toBe('saved');
    expect(outcome(wrapper).text()).toContain('keyManagement.vaultBackup.saved');
    expect(outcome(wrapper).text()).toContain('/home/me/b.json');
  });

  it('reports a cancelled dialog neutrally, not as an error', async () => {
    testState.exportVaultBackup.mockResolvedValue({ status: 'cancelled' });
    const wrapper = mountPage();

    await backupButton(wrapper).trigger('click');
    await flushPromises();

    expect(outcome(wrapper).attributes('data-status')).toBe('cancelled');
    expect(outcome(wrapper).text()).toContain('keyManagement.vaultBackup.cancelled');
    expect(outcome(wrapper).find('[role="alert"]').exists()).toBe(false);
    expect(outcome(wrapper).find('.text-negative').exists()).toBe(false);
  });

  it('reports a failure as an error, with its reason', async () => {
    testState.exportVaultBackup.mockResolvedValue({ status: 'failed', error: 'FILE_NO_SPACE' });
    const wrapper = mountPage();

    await backupButton(wrapper).trigger('click');
    await flushPromises();

    const alert = outcome(wrapper).get('[role="alert"]');
    expect(alert.classes()).toContain('text-negative');
    expect(alert.text()).toContain('FILE_NO_SPACE');
  });

  it('reports a thrown backup as a failure rather than leaving the page busy', async () => {
    testState.exportVaultBackup.mockRejectedValue(new Error('bridge closed'));
    const wrapper = mountPage();

    await backupButton(wrapper).trigger('click');
    await flushPromises();

    expect(outcome(wrapper).text()).toContain('bridge closed');
    expect(backupButton(wrapper).attributes('disabled')).toBeUndefined();
  });

  it('opens only one Save As dialog while one is already open', async () => {
    let finish: (value: unknown) => void = () => undefined;
    testState.exportVaultBackup.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const wrapper = mountPage();

    await backupButton(wrapper).trigger('click');
    expect(backupButton(wrapper).attributes('disabled')).toBeDefined();
    await backupButton(wrapper).trigger('click');

    expect(testState.exportVaultBackup).toHaveBeenCalledTimes(1);
    finish({ status: 'cancelled' });
    await flushPromises();
    expect(backupButton(wrapper).attributes('disabled')).toBeUndefined();
  });
});
