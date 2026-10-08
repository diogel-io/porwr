import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';

import ProfilePage from '@/pages/dashboard/ProfilePage.vue';
import type { StoredKey } from '@/types';

const getKeysMock = vi.fn(() => Promise.resolve());
const replaceMock = vi.fn(() => Promise.resolve());

const storeState = reactive<{
  activeKey: string;
  storedKeys: StoredKey[];
}>({
  activeKey: '',
  storedKeys: [],
});

const routeState = reactive<{
  query: Record<string, unknown>;
}>({
  query: {},
});

vi.mock('@/stores/account-store', () => ({
  default: () => ({
    getKeys: getKeysMock,
    get activeKey() {
      return storeState.activeKey;
    },
    get storedKeys() {
      return storeState.storedKeys;
    },
    // The page reads the store's getter rather than repeating the lookup itself (#211).
    get activeAccount() {
      if (!storeState.activeKey) return undefined;
      return storeState.storedKeys.find((key) => key.alias === storeState.activeKey);
    },
  }),
}));

vi.mock('vue-router', () => ({
  useRoute: () => routeState,
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

const defaultStoredKey: StoredKey = {
  id: 'pubkey-1',
  alias: 'alpha',
  account: {
    privkey: 'privkey-1',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
};

async function flushComponent() {
  await Promise.resolve();
  await nextTick();
}

describe('ProfilePage.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getKeysMock.mockResolvedValue(undefined);
    replaceMock.mockResolvedValue(undefined);
    storeState.activeKey = '';
    storeState.storedKeys = [];
    routeState.query = {};
  });

  it('renders editor, preview, and images sections for active account', async () => {
    storeState.activeKey = 'alpha';
    storeState.storedKeys = [defaultStoredKey];

    const wrapper = mount(ProfilePage, {
      global: {
        stubs: {
          'q-page': { template: '<div><slot /></div>' },
          'q-card': { template: '<div><slot /></div>' },
          'q-card-section': { template: '<div><slot /></div>' },
          'q-btn': true,
          'q-icon': true,
          'profile-editor': {
            template: '<div class="profile-editor-stub" />',
            props: ['storedKey'],
          },
          'profile-preview': {
            template: '<div class="profile-preview-stub" />',
            props: ['storedKey', 'refreshKey'],
          },
          'profile-image': {
            template: '<div class="profile-image-stub" />',
            props: ['storedKey'],
          },
        },
      },
    });

    await flushComponent();

    expect(wrapper.find('.profile-editor-stub').exists()).toBe(true);
    expect(wrapper.find('.profile-preview-stub').exists()).toBe(true);
    expect(wrapper.find('.profile-image-stub').exists()).toBe(true);
    expect(wrapper.text()).toContain('profile.editorTitle');
    expect(wrapper.text()).toContain('profile.previewTitle');
    expect(wrapper.text()).toContain('profile.imagesSectionTitle');
  });

  it('renders no-account empty state without active account', async () => {
    const wrapper = mount(ProfilePage, {
      global: {
        stubs: {
          'q-page': { template: '<div><slot /></div>' },
          'q-card': { template: '<div><slot /></div>' },
          'q-card-section': { template: '<div><slot /></div>' },
          'q-btn': {
            template: '<button class="q-btn-stub" :data-label="label" />',
            props: ['label'],
          },
          'q-icon': true,
          'profile-editor': true,
          'profile-preview': true,
          'profile-image': true,
        },
      },
    });

    await flushComponent();

    expect(wrapper.text()).toContain('account.noAccounts');
    expect(wrapper.text()).toContain('account.noAccountDesc');
    expect(wrapper.find('[data-label="account.create"]').exists()).toBe(true);
  });
});
