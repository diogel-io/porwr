import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import ViewKeyPage from '@/pages/dashboard/ViewKeyPage.vue';

/** The breadcrumb back to the Keys list (#302). */

const state = vi.hoisted(() => ({
  alias: 'alpha',
  storedKeys: [] as Array<{ id: string; alias: string; createdAt: string }>,
  replace: vi.fn(),
  notify: vi.fn(),
  renameKeyAlias: vi.fn(),
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { alias: state.alias } }),
  useRouter: () => ({ replace: state.replace }),
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('quasar', () => ({
  useQuasar: () => ({ notify: state.notify }),
}));

vi.mock('@/stores/account-store', () => ({
  default: () => ({
    get storedKeys() {
      return state.storedKeys;
    },
    getKeys: vi.fn(() => Promise.resolve()),
    renameKeyAlias: state.renameKeyAlias,
  }),
}));

const mountPage = async () => {
  const wrapper = mount(ViewKeyPage, {
    global: {
      stubs: {
        'q-page': { template: '<div><slot /></div>' },
        'q-card': { template: '<div><slot /></div>' },
        'q-card-section': { template: '<div><slot /></div>' },
        'q-separator': true,
        'q-icon': true,
        'q-input': {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template:
            '<input class="alias-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        'q-btn': {
          props: ['label'],
          template: '<button class="save-alias" @click="$emit(\'click\')">{{ label }}</button>',
        },
        'security-warning': true,
        'view-stored-key': true,
        ExportButton: true,
        'dashboard-breadcrumbs': {
          props: ['items'],
          template: '<nav class="crumbs-stub" :data-items="JSON.stringify(items)" />',
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
};

const crumbs = (wrapper: Awaited<ReturnType<typeof mountPage>>) =>
  JSON.parse(wrapper.get('.crumbs-stub').attributes('data-items')!) as Array<{
    label: string;
    to?: unknown;
  }>;

beforeEach(() => {
  vi.clearAllMocks();
  state.alias = 'alpha';
  state.storedKeys = [
    { id: 'a'.repeat(64), alias: 'alpha', createdAt: '2026-01-01T00:00:00.000Z' },
  ];
  state.renameKeyAlias.mockResolvedValue(undefined);
});

describe('ViewKeyPage.vue breadcrumb', () => {
  it('leads back to the Keys list and ends in the key’s alias', async () => {
    const items = crumbs(await mountPage());

    expect(items).toEqual([
      { label: 'navigation.keys.label', to: { name: 'keys' } },
      { label: 'alpha' },
    ]);
  });

  it('does not follow the alias input before it is saved', async () => {
    const wrapper = await mountPage();

    await wrapper.get('.alias-input').setValue('alpha-renamed');

    expect(crumbs(wrapper)[1]).toEqual({ label: 'alpha' });
  });

  it('follows a saved rename', async () => {
    const wrapper = await mountPage();

    await wrapper.get('.alias-input').setValue('alpha-renamed');
    await wrapper.get('.save-alias').trigger('click');
    await flushPromises();

    expect(state.renameKeyAlias).toHaveBeenCalledWith('alpha', 'alpha-renamed');
    expect(crumbs(wrapper)[1]).toEqual({ label: 'alpha-renamed' });
  });

  it('falls back to the page title when no key matches', async () => {
    state.alias = 'missing';

    expect(crumbs(await mountPage())[1]).toEqual({ label: 'keyManagement.viewTitle' });
  });
});
