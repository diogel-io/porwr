import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';

/**
 * The idle view waits for the first queue read (D13, threat model T7, porwr#371).
 *
 * Until the queue has been read, `current` is null whether or not a request is waiting. The idle
 * view looks up the active account's profile on its relays and may load remote images, so if it
 * mounted in that gap, a panel opened for a waiting request would contact relays and image hosts
 * at the moment the user is deciding.
 */

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/composables/useRemoteImages', () => ({ resetRemoteImageReveals: vi.fn() }));

vi.mock('@/stores/vault-store', () => ({
  default: () => ({ vaultExists: true, isUnlocked: true }),
}));

vi.mock('@/stores/account-store', () => ({
  default: () => ({
    activeKey: 'alice',
    storedKeys: new Set([{ alias: 'alice', id: 'alice-pubkey' }]),
    hydration: 'ready',
    activeAccount: { alias: 'alice', id: 'alice-pubkey' },
    hasNoAccounts: false,
    getKeys: vi.fn(),
  }),
}));

vi.mock('@/composables/useActiveTab', () => ({
  useActiveTab: () => ({ activeOrigin: ref('https://example.com') }),
}));

const REQUEST = {
  id: 'req-1',
  origin: 'https://example.com',
  requestType: 'sign_event',
  eventKind: 1,
  accountAlias: 'alice',
  accountPubkey: 'alice-pubkey',
  activeAccountAlias: 'alice',
  activeAccountPubkey: 'alice-pubkey',
  createdAt: 0,
  expiresAt: Number.MAX_SAFE_INTEGER,
  state: 'presented',
};

const loading = ref(true);
const current = ref<typeof REQUEST | null>(null);

vi.mock('@/composables/useApprovalQueue', () => ({
  useApprovalQueue: () => ({
    pending: ref([]),
    current,
    content: ref(null),
    loading,
    decide: vi.fn(),
    dismiss: vi.fn(),
    present: vi.fn(),
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
        'q-spinner': true,
        ProfileView: true,
        RemoteImagesNotice: true,
        SiteAccountNotice: true,
        CurrentRequest: true,
        PendingRequestList: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
};

enableAutoUnmount(afterEach);

describe('SidebarHome before the queue has been read (porwr#371)', () => {
  beforeEach(() => {
    loading.value = true;
    current.value = null;
  });

  it('mounts nothing that contacts relays or image hosts', async () => {
    const wrapper = await mountPage();

    expect(wrapper.findComponent({ name: 'ProfileView' }).exists()).toBe(false);
    expect(wrapper.findComponent({ name: 'RemoteImagesNotice' }).exists()).toBe(false);
    expect(wrapper.find('[role="status"]').text()).toContain('sidebar.queueLoading');
  });

  it('goes straight to a waiting request, never through the idle view', async () => {
    const wrapper = await mountPage();

    current.value = REQUEST;
    loading.value = false;
    await flushPromises();

    expect(wrapper.findComponent({ name: 'CurrentRequest' }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'ProfileView' }).exists()).toBe(false);
  });

  it('shows the idle view once the queue is read and empty', async () => {
    const wrapper = await mountPage();

    loading.value = false;
    await flushPromises();

    expect(wrapper.findComponent({ name: 'ProfileView' }).exists()).toBe(true);
    expect(wrapper.find('.sidebar-home__context-origin').text()).toBe('https://example.com');
  });
});
