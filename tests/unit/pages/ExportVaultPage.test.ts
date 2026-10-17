import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The Export vault page explains the backup before it is saved, then says what happened (#314). */

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

import ExportVaultPage from '@/pages/dashboard/ExportVaultPage.vue';

const slotStub = { template: '<div><slot /></div>' };

const mountPage = () =>
  mount(ExportVaultPage, {
    global: {
      stubs: {
        'q-page': slotStub,
        'q-card': slotStub,
        'q-card-section': slotStub,
        'q-banner': { template: '<div v-bind="$attrs"><slot /></div>' },
        'q-icon': true,
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

const exportButton = (wrapper: ReturnType<typeof mountPage>) =>
  wrapper.get('[data-testid="vault-export-confirm"]');
const outcome = (wrapper: ReturnType<typeof mountPage>) =>
  wrapper.get('[data-testid="vault-export-outcome"]');

describe('ExportVaultPage (#314)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leads back to the Keys list and ends in the page title', () => {
    const crumb = mountPage().get('.crumbs-stub');

    expect(JSON.parse(crumb.attributes('data-items')!)).toEqual([
      { label: 'navigation.keys.label', to: { name: 'keys' } },
      { label: 'keyManagement.vaultExport.title' },
    ]);
  });

  it('explains the backup, and what is needed to open it, before anything is saved', () => {
    const wrapper = mountPage();
    const info = wrapper.get('[data-testid="vault-export-info"]').text();

    for (const point of ['whatItIs', 'password', 'lostPassword', 'keepSafe']) {
      expect(info).toContain(`keyManagement.vaultExport.${point}`);
    }
    expect(wrapper.find('[data-testid="vault-export-outcome"]').exists()).toBe(false);
    expect(testState.exportVaultBackup).not.toHaveBeenCalled();
  });

  it('confirms a save, and says where the file went', async () => {
    testState.exportVaultBackup.mockResolvedValue({ status: 'saved', path: '/home/me/b.json' });
    const wrapper = mountPage();

    await exportButton(wrapper).trigger('click');
    await flushPromises();

    expect(outcome(wrapper).attributes('data-status')).toBe('saved');
    expect(outcome(wrapper).text()).toContain('keyManagement.vaultExport.saved');
    expect(outcome(wrapper).text()).toContain('/home/me/b.json');
  });

  it('reports a cancelled dialog neutrally, not as an error', async () => {
    testState.exportVaultBackup.mockResolvedValue({ status: 'cancelled' });
    const wrapper = mountPage();

    await exportButton(wrapper).trigger('click');
    await flushPromises();

    expect(outcome(wrapper).attributes('data-status')).toBe('cancelled');
    expect(outcome(wrapper).text()).toContain('keyManagement.vaultExport.cancelled');
    expect(outcome(wrapper).find('[role="alert"]').exists()).toBe(false);
    expect(outcome(wrapper).find('.text-negative').exists()).toBe(false);
  });

  it('reports a failure as an error, with its reason', async () => {
    testState.exportVaultBackup.mockResolvedValue({ status: 'failed', error: 'FILE_NO_SPACE' });
    const wrapper = mountPage();

    await exportButton(wrapper).trigger('click');
    await flushPromises();

    const alert = outcome(wrapper).get('[role="alert"]');
    expect(alert.classes()).toContain('text-negative');
    expect(alert.text()).toContain('FILE_NO_SPACE');
  });

  it('reports a thrown export as a failure rather than leaving the page busy', async () => {
    testState.exportVaultBackup.mockRejectedValue(new Error('bridge closed'));
    const wrapper = mountPage();

    await exportButton(wrapper).trigger('click');
    await flushPromises();

    expect(outcome(wrapper).text()).toContain('bridge closed');
    expect(exportButton(wrapper).attributes('disabled')).toBeUndefined();
  });

  it('opens only one Save As dialog while one is already open', async () => {
    let finish: (value: unknown) => void = () => undefined;
    testState.exportVaultBackup.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const wrapper = mountPage();

    await exportButton(wrapper).trigger('click');
    expect(exportButton(wrapper).attributes('disabled')).toBeDefined();
    await exportButton(wrapper).trigger('click');

    expect(testState.exportVaultBackup).toHaveBeenCalledTimes(1);
    finish({ status: 'cancelled' });
    await flushPromises();
    expect(exportButton(wrapper).attributes('disabled')).toBeUndefined();
  });
});
