import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import ViewKeyPage from '@/pages/dashboard/ViewKeyPage.vue';

/** The breadcrumb back to the Keys list (#302). */

const state = vi.hoisted(() => ({
  alias: 'alpha',
  storedKeys: [] as Array<{
    id: string;
    alias: string;
    createdAt: string;
    kind?: 'remote';
    remoteSigner?: { pubkey: string; relays: string[] };
  }>,
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
        'view-stored-key': {
          props: ['revealable'],
          template: '<div class="stored-key-stub" :data-revealable="String(revealable)" />',
        },
        ExportButton: { template: '<div class="export-stub" />' },
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

describe('ViewKeyPage.vue for a remote-signer account (#138)', () => {
  it('offers to reveal and export a local key', async () => {
    const wrapper = await mountPage();

    expect(wrapper.get('.stored-key-stub').attributes('data-revealable')).toBe('true');
    expect(wrapper.find('.export-stub').exists()).toBe(true);
    expect(wrapper.find('[data-testid="remote-signer-details"]').exists()).toBe(false);
  });

  it('offers neither for a remote-signer account, and shows the signer instead', async () => {
    state.storedKeys = [
      {
        id: 'a'.repeat(64),
        alias: 'alpha',
        createdAt: '2026-01-01T00:00:00.000Z',
        kind: 'remote',
        remoteSigner: { pubkey: 'b'.repeat(64), relays: ['wss://relay.example.com'] },
      },
    ];

    const wrapper = await mountPage();

    expect(wrapper.get('.stored-key-stub').attributes('data-revealable')).toBe('false');
    expect(wrapper.find('.export-stub').exists()).toBe(false);
    const details = wrapper.get('[data-testid="remote-signer-details"]');
    expect(details.text()).toContain('b'.repeat(64));
    expect(details.text()).toContain('wss://relay.example.com');
  });
});
