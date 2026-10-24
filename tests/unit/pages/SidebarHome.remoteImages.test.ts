import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { reactive, ref } from 'vue';

/**
 * Remote images in the panel's idle view (T32, diogel-io/workspace#148). The panel never changes
 * route, so it offers its own "Load images on this page" and forgets what was loaded when the
 * account changes or a request takes the panel.
 */

const reset = vi.hoisted(() => vi.fn());

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/composables/useRemoteImages', () => ({ resetRemoteImageReveals: reset }));

vi.mock('@/stores/vault-store', () => ({
  default: () => ({ vaultExists: true, isUnlocked: true }),
}));

const accounts = vi.hoisted(() => ({ activeKey: 'alice' }));
const reactiveAccounts = reactive(accounts);
const keys = [
  { alias: 'alice', id: 'alice-pubkey' },
  { alias: 'bob', id: 'bob-pubkey' },
];

vi.mock('@/stores/account-store', () => ({
  default: () => ({
    get activeKey() {
      return reactiveAccounts.activeKey;
    },
    get storedKeys() {
      return new Set(keys);
    },
    hydration: 'ready',
    get activeAccount() {
      return keys.find((key) => key.alias === reactiveAccounts.activeKey);
    },
    hasNoAccounts: false,
    getKeys: vi.fn(),
  }),
}));

vi.mock('@/composables/useActiveTab', () => ({ useActiveTab: () => ({ activeOrigin: ref('') }) }));

const current = ref<{ id: string } | null>(null);
vi.mock('@/composables/useApprovalQueue', () => ({
  useApprovalQueue: () => ({
    pending: ref([]),
    current,
    content: ref(null),
    decide: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const mountPage = async () => {
  const SidebarHome = (await import('@/pages/sidebar/SidebarHome.vue')).default;
  const wrapper = mount(SidebarHome, {
    global: {
      stubs: {
        'q-page': { template: '<div><slot /></div>' },
        'q-icon': true,
        'q-btn': true,
        ProfileView: true,
        RemoteImagesNotice: { template: '<div class="remote-images-notice-stub" />' },
        CurrentRequest: true,
        PendingRequestList: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
};

// A page left mounted would still be watching in the next test.
enableAutoUnmount(afterEach);

describe('SidebarHome remote images', () => {
  beforeEach(() => {
    reset.mockClear();
    reactiveAccounts.activeKey = 'alice';
    current.value = null;
  });

  it('offers to load the images in the idle view', async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('.sidebar-home__account .remote-images-notice-stub').exists()).toBe(true);
  });

  it('forgets what was loaded when the active account changes', async () => {
    await mountPage();
    expect(reset).not.toHaveBeenCalled();

    reactiveAccounts.activeKey = 'bob';
    await flushPromises();

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('forgets what was loaded when a request takes the panel', async () => {
    await mountPage();

    current.value = { id: 'request-1' };
    await flushPromises();

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
