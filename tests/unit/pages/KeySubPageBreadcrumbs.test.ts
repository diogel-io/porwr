import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

import AddNewKeyPage from '@/pages/dashboard/AddNewKeyPage.vue';
import ImportKeyPage from '@/pages/dashboard/ImportKeyPage.vue';

/** The Import Key and Add New Key pages lead back to the Keys list (#302). */

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const stubs = {
  'q-page': { template: '<div><slot /></div>' },
  'q-card': { template: '<div><slot /></div>' },
  'q-card-section': { template: '<div><slot /></div>' },
  'import-key-form': true,
  'generate-key-form': true,
  'dashboard-breadcrumbs': {
    props: ['items'],
    template: '<nav class="crumbs-stub" :data-items="JSON.stringify(items)" />',
  },
};

describe.each([
  ['ImportKeyPage', ImportKeyPage, 'keyManagement.importTitle'],
  ['AddNewKeyPage', AddNewKeyPage, 'keyManagement.addNewTitle'],
])('%s breadcrumb', (_name, page, title) => {
  it('leads back to the Keys list and ends in the page title', () => {
    const wrapper = mount(page, { global: { stubs } });

    const crumb = wrapper.get('.crumbs-stub');
    // The breadcrumb sits above the hero, so it is the first thing on the page.
    expect(wrapper.element.firstElementChild).toBe(crumb.element);
    expect(JSON.parse(crumb.attributes('data-items')!)).toEqual([
      { label: 'navigation.keys.label', to: { name: 'keys' } },
      { label: title },
    ]);
  });
});
