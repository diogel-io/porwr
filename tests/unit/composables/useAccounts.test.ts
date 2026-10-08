import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAccounts } from '@/composables/useAccounts';
import type { StoredKey } from '@/types';

interface MockAccountStore {
  storedKeys: Set<StoredKey>;
  activeKey: string | null;
  getKeys: ReturnType<typeof vi.fn<() => Promise<void>>>;
  setActiveKey: ReturnType<typeof vi.fn<(alias: string) => Promise<void>>>;
  listenToStorageChanges: ReturnType<typeof vi.fn<() => void>>;
}

const mocks = vi.hoisted(() => {
  const accountStore: MockAccountStore = {
    storedKeys: new Set<StoredKey>(),
    activeKey: null,
    getKeys: vi.fn(async () => {}),
    setActiveKey: vi.fn(async () => {}),
    listenToStorageChanges: vi.fn(),
  };

  return {
    accountStore,
    router: {
      push: vi.fn(async () => {}),
      currentRoute: { value: { path: '/popup' } },
    },
    fetchProfile: vi.fn(async () => null),
  };
});

vi.mock('@/stores/account-store', () => ({
  default: () => mocks.accountStore,
}));

vi.mock('vue-router', () => ({
  useRouter: () => mocks.router,
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('@/services/profile-service', () => ({
  profileService: {
    fetchProfile: mocks.fetchProfile,
  },
}));

interface HarnessVm {
  model: string | null;
}

const TestHarness = defineComponent({
  name: 'UseAccountsHarness',
  setup() {
    const { model, items } = useAccounts();
    return { model, items };
  },
  template: '<div />',
});

describe('useAccounts', () => {
  beforeEach(() => {
    mocks.accountStore.storedKeys = new Set<StoredKey>([
      {
        id: 'pubkey-1',
        alias: 'Woody',
        account: { privkey: 'secret' },
        createdAt: '2026-06-08T00:00:00.000Z',
      },
    ]);
    mocks.accountStore.activeKey = 'Woody';
    mocks.accountStore.getKeys.mockClear();
    mocks.accountStore.setActiveKey.mockClear();
    mocks.accountStore.listenToStorageChanges.mockClear();
    mocks.router.push.mockClear();
    mocks.fetchProfile.mockClear();

    vi.stubGlobal('chrome', {
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://diogel/${path}`),
      },
      tabs: {
        create: vi.fn(async () => undefined),
      },
    });
  });

  it('opens key management in a browser tab when Create Account is selected', async () => {
    const wrapper = mount(TestHarness);
    await flushPromises();

    (wrapper.vm as unknown as HarnessVm).model = 'create-account';
    await nextTick();

    expect(chrome.runtime.getURL).toHaveBeenCalledWith('www/index.html#/keys');
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://diogel/www/index.html#/keys',
    });
    expect(mocks.router.push).not.toHaveBeenCalledWith({ name: 'add-new-key' });
    expect(mocks.accountStore.setActiveKey).not.toHaveBeenCalled();
    expect((wrapper.vm as unknown as HarnessVm).model).toBe('Woody');
  });
});
