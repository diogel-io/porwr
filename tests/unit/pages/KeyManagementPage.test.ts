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
  it('renders the security warning in the card header, key actions, and passes keys to table', async () => {
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
          'vault-backup-card': { template: '<div class="vault-backup-card-stub" />' },
          'key-management-table': {
            template: '<div class="key-management-table-stub" :data-keys-count="keys.length" />',
            props: ['keys'],
          },
        },
      },
    });

    await wrapper.vm.$nextTick();

    // The warning is a corner icon in the Keys card header, before the key actions (#298).
    const warning = wrapper.find('.security-warning');
    expect(warning.exists()).toBe(true);
    expect(warning.attributes('aria-label')).toBe('keyManagement.securityWarning.title');
    expect(warning.text()).toContain('keyManagement.securityWarning.message');
    const markup = wrapper.html();
    expect(markup.indexOf('security-warning')).toBeLessThan(markup.indexOf('keyManagement.importKey'));
    expect(markup.indexOf('security-warning')).toBeGreaterThan(markup.indexOf('navigation.keys.caption'));

    const importButton = wrapper.find('[data-label="keyManagement.importKey"]');
    expect(importButton.exists()).toBe(true);
    expect(importButton.attributes('data-to-name')).toBe('import-key');

    const addNewButton = wrapper.find('[data-label="keyManagement.addNewKey"]');
    expect(addNewButton.exists()).toBe(true);
    expect(addNewButton.attributes('data-to-name')).toBe('add-new-key');

    const table = wrapper.find('.key-management-table-stub');
    expect(table.exists()).toBe(true);
    expect(table.attributes('data-keys-count')).toBe('1');

    // Vault backup and restore sit in their own card below the keys (#297).
    const html = wrapper.html();
    expect(wrapper.find('.vault-backup-card-stub').exists()).toBe(true);
    expect(html.indexOf('vault-backup-card-stub')).toBeGreaterThan(html.indexOf('key-management-table-stub'));
  });
});
