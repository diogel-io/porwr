import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

import KeyManagementPage from '@/pages/dashboard/KeyManagementPage.vue';
import type { StoredKey } from '@/types';

const getKeysMock = vi.fn(() => undefined);
const storedKeys: StoredKey[] = [
  {
    id: 'pubkey-a',
    alias: 'alpha',
    account: { privkey: 'secret-a' },
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

vi.mock('@/stores/account-store', () => ({
  default: () => ({
    storedKeys,
    getKeys: getKeysMock,
  }),
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe('KeyManagementPage.vue', () => {
  it('renders security warning, key actions, and passes keys to table', async () => {
    const wrapper = mount(KeyManagementPage, {
      global: {
        stubs: {
          'q-page': { template: '<div><slot /></div>' },
          'q-card': { template: '<div><slot /></div>' },
          'q-card-section': { template: '<div><slot /></div>' },
          'q-separator': true,
          'q-btn': {
            template:
              '<button class="q-btn-stub" :data-label="label" :data-to-name="to?.name"><slot /></button>',
            props: ['label', 'to'],
          },
          'q-icon': true,
          'key-management-table': {
            template: '<div class="key-management-table-stub" :data-keys-count="keys.length" />',
            props: ['keys'],
          },
        },
      },
    });

    await wrapper.vm.$nextTick();

    expect(wrapper.find('.security-warning').exists()).toBe(true);
    expect(wrapper.text()).toContain('keyManagement.securityWarning.title');
    expect(wrapper.text()).toContain('keyManagement.securityWarning.message');

    const importButton = wrapper.find('[data-label="keyManagement.importKey"]');
    expect(importButton.exists()).toBe(true);
    expect(importButton.attributes('data-to-name')).toBe('import-key');

    const addNewButton = wrapper.find('[data-label="keyManagement.addNewKey"]');
    expect(addNewButton.exists()).toBe(true);
    expect(addNewButton.attributes('data-to-name')).toBe('add-new-key');

    const table = wrapper.find('.key-management-table-stub');
    expect(table.exists()).toBe(true);
    expect(table.attributes('data-keys-count')).toBe('1');
  });
});
