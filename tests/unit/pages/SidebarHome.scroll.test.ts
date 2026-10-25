import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';

/**
 * The panel's views are branches of one page inside one scroller, so each must start at the top
 * rather than at the offset the previous view was left at (#321).
 */

const mocks = vi.hoisted(() => ({ vault: { vaultExists: true, isUnlocked: false } }));

const request = (id: string) => ({
  id,
  origin: 'https://example.com',
  requestType: 'sign_event',
  eventKind: 1,
  accountAlias: 'alice',
  accountPubkey: 'a'.repeat(64),
  state: 'presented',
  createdAt: 1,
  expiresAt: 2,
});

const current = ref<ReturnType<typeof request> | null>(null);

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('quasar', () => ({ useQuasar: () => ({ notify: vi.fn() }) }));

vi.mock('@/stores/vault-store', () => ({ default: () => mocks.vault }));

vi.mock('@/stores/account-store', () => ({
  default: () => ({ activeAccount: undefined, hasNoAccounts: false, getKeys: vi.fn() }),
}));

vi.mock('@/composables/useActiveTab', () => ({ useActiveTab: () => ({ activeOrigin: ref('') }) }));

vi.mock('@/composables/useApprovalQueue', () => ({
  useApprovalQueue: () => ({
    pending: ref([]),
    current,
    // The queue has been read; the panel is past its loading view (porwr#371).
    loading: ref(false),
    content: ref(null),
    decide: vi.fn(),
    dismiss: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const mountInScroller = async () => {
  const SidebarHome = (await import('@/pages/sidebar/SidebarHome.vue')).default;
  const scroller = document.createElement('div');
  scroller.className = 'sidebar-body';
  document.body.appendChild(scroller);
  const wrapper = mount(SidebarHome, {
    attachTo: scroller,
    global: {
      stubs: {
        'q-page': { template: '<div><slot /></div>' },
        'q-icon': true,
        'q-btn': true,
        'q-spinner': true,
        ProfileView: true,
        RemoteImagesNotice: true,
        CurrentRequest: true,
        PendingRequestList: true,
        SidebarUnlock: true,
      },
    },
  });
  return { wrapper, scroller };
};

describe('SidebarHome scroll position (#321)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mocks.vault.vaultExists = true;
    mocks.vault.isUnlocked = false;
    current.value = null;
  });

  it('starts a request at the top when it replaces the idle view', async () => {
    mocks.vault.isUnlocked = true;
    const { scroller } = await mountInScroller();
    scroller.scrollTop = 120;

    current.value = request('req-1');
    await flushPromises();

    expect(scroller.scrollTop).toBe(0);
  });

  it('starts another request at the top', async () => {
    current.value = request('req-1');
    mocks.vault.isUnlocked = true;
    const { scroller } = await mountInScroller();
    scroller.scrollTop = 120;

    current.value = request('req-2');
    await flushPromises();

    expect(scroller.scrollTop).toBe(0);
  });

  it('keeps the offset when the same request is refreshed', async () => {
    current.value = request('req-1');
    mocks.vault.isUnlocked = true;
    const { scroller } = await mountInScroller();
    scroller.scrollTop = 120;

    current.value = { ...request('req-1'), expiresAt: 3 };
    await flushPromises();

    expect(scroller.scrollTop).toBe(120);
  });

  it('starts the idle view at the top once the request is gone', async () => {
    current.value = request('req-1');
    mocks.vault.isUnlocked = true;
    const { scroller } = await mountInScroller();
    scroller.scrollTop = 120;

    current.value = null;
    await flushPromises();

    expect(scroller.scrollTop).toBe(0);
  });
});
