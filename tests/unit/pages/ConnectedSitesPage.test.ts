import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils';

const mocks = vi.hoisted(() => ({
  listConnectedSites: vi.fn(),
  disconnectSite: vi.fn(),
  notify: vi.fn(),
  dialog: vi.fn(),
}));

vi.mock('@/services/connected-sites-service', () => ({
  listConnectedSites: mocks.listConnectedSites,
  disconnectSite: mocks.disconnectSite,
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
    d: () => 'a-date',
  }),
}));

vi.mock('quasar', () => ({
  useQuasar: () => ({ notify: mocks.notify, dialog: mocks.dialog }),
}));

interface FakeAccounts {
  storedKeys: Set<{ id: string; alias: string }>;
  activeId: string | undefined;
}

// Reactive, so switching account in a test reaches the page's watcher as the real store would.
vi.mock('@/stores/account-store', async () => {
  const { computed, reactive } = await import('vue');
  const state = reactive<FakeAccounts>({ storedKeys: new Set(), activeId: undefined });
  (globalThis as { __sitesAccounts?: FakeAccounts }).__sitesAccounts = state;
  const activeAccount = computed(() =>
    Array.from(state.storedKeys).find((key) => key.id === state.activeId),
  );
  const store = {
    get storedKeys() {
      return state.storedKeys;
    },
    get activeAccount() {
      return activeAccount.value;
    },
    getKeys: () => Promise.resolve(),
  };
  return { default: () => store };
});

const accounts = (): FakeAccounts =>
  (globalThis as { __sitesAccounts?: FakeAccounts }).__sitesAccounts!;

import ConnectedSitesPage from '@/pages/dashboard/ConnectedSitesPage.vue';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

const site = (over: Record<string, unknown> = {}) => ({
  origin: 'https://example.com',
  boundPubkey: ALICE,
  boundAt: 1_700_000_000_000,
  grants: [{ requestType: 'sign_event', eventKind: 1, grantedAt: 1 }],
  ...over,
});

const mountPage = async () => {
  const wrapper = mount(ConnectedSitesPage, {
    global: {
      stubs: {
        'q-page': { template: '<div><slot /></div>' },
        'q-card': { template: '<div class="q-card"><slot /></div>' },
        'q-card-section': { template: '<section><slot /></section>' },
        'q-separator': true,
        'q-icon': true,
        'q-inner-loading': true,
        'q-badge': { template: '<span class="q-badge">{{ label }}</span>', props: ['label'] },
        'q-btn': {
          template: '<button :disabled="loading" @click="$emit(\'click\')">{{ label }}</button>',
          props: ['label', 'loading'],
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
};

// The page watches the account store; a page left mounted from an earlier test would react to the
// next test's account and call the service on its behalf.
enableAutoUnmount(afterEach);

beforeEach(() => {
  accounts().storedKeys = new Set([
    { id: ALICE, alias: 'alice' },
    { id: BOB, alias: 'bob' },
  ]);
  accounts().activeId = ALICE;
  vi.clearAllMocks();
  mocks.listConnectedSites.mockResolvedValue([]);
  mocks.disconnectSite.mockResolvedValue(true);
  // Confirmed by default; the cancel path is asserted separately.
  mocks.dialog.mockReturnValue({ onOk: (fn: () => void) => fn() });
});

describe('the connected sites page', () => {
  it('says so plainly when no site has connected', async () => {
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('dashboard.connectedSites.empty');
    expect(wrapper.findAll('.q-card')).toHaveLength(0);
  });

  it('lists a site with the identity it signs as', async () => {
    mocks.listConnectedSites.mockResolvedValue([site()]);

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('https://example.com');
    expect(wrapper.text()).toContain('dashboard.connectedSites.signsAs');
    // Truncated: enough to tell two identities apart, not enough to swamp the row.
    expect(wrapper.text()).toContain('aaaaaaaa…aaaaaaaa');
  });

  it('says a site asks every time when it holds no standing permission', async () => {
    mocks.listConnectedSites.mockResolvedValue([site({ grants: [] })]);

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('dashboard.connectedSites.noGrants');
  });

  it('says when a site holds grants but is bound to no account', async () => {
    mocks.listConnectedSites.mockResolvedValue([site({ boundPubkey: null, boundAt: null })]);

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('dashboard.connectedSites.unbound');
  });

  it('distinguishes a grant that expires from one that does not', async () => {
    mocks.listConnectedSites.mockResolvedValue([
      site({
        grants: [
          { requestType: 'sign_event', eventKind: 1, grantedAt: 1, expiresAt: 2 },
          { requestType: 'sign_event', eventKind: 5, grantedAt: 1 },
        ],
      }),
    ]);

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('dashboard.connectedSites.expires');
    expect(wrapper.text()).toContain('dashboard.connectedSites.neverExpires');
  });

  describe('disconnecting', () => {
    it('asks before doing it', async () => {
      mocks.listConnectedSites.mockResolvedValue([site()]);
      const wrapper = await mountPage();

      await wrapper.findAll('button').at(-1)?.trigger('click');

      expect(mocks.dialog).toHaveBeenCalled();
    });

    it('does nothing when the confirmation is dismissed', async () => {
      mocks.dialog.mockReturnValue({ onOk: () => undefined });
      mocks.listConnectedSites.mockResolvedValue([site()]);
      const wrapper = await mountPage();

      await wrapper.findAll('button').at(-1)?.trigger('click');
      await flushPromises();

      expect(mocks.disconnectSite).not.toHaveBeenCalled();
    });

    it('disconnects and re-reads, rather than trusting its own copy', async () => {
      mocks.listConnectedSites.mockResolvedValue([site()]);
      const wrapper = await mountPage();
      mocks.listConnectedSites.mockClear();

      await wrapper.findAll('button').at(-1)?.trigger('click');
      await flushPromises();

      expect(mocks.disconnectSite).toHaveBeenCalledWith('https://example.com', ALICE);
      expect(mocks.listConnectedSites).toHaveBeenCalled();
    });

    it('reports a refusal rather than showing success', async () => {
      mocks.disconnectSite.mockResolvedValue(false);
      mocks.listConnectedSites.mockResolvedValue([site()]);
      const wrapper = await mountPage();

      await wrapper.findAll('button').at(-1)?.trigger('click');
      await flushPromises();

      expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
    });
  });

  it('reports a failure to load rather than showing an empty list as though it were true', async () => {
    mocks.listConnectedSites.mockRejectedValue(new Error('bridge down'));

    await mountPage();

    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
  });
});

describe('which account a site signs as (workspace#23)', () => {
  it('names the bound account by its alias as well as its key', async () => {
    mocks.listConnectedSites.mockResolvedValue([site()]);

    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="bound-alias"]').text()).toBe('alice');
  });
});

describe('one account’s sites at a time (#309)', () => {
  it('names the account and lists only its sites', async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="sites-account"]').text()).toBe(
      'dashboard.connectedSites.accountCaption:alice',
    );
    expect(mocks.listConnectedSites).toHaveBeenCalledWith(ALICE);
  });

  it('no longer marks sites of another account, because it no longer lists them', async () => {
    mocks.listConnectedSites.mockResolvedValue([site()]);

    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="not-active"]').exists()).toBe(false);
  });

  it('re-lists for the new account when the user switches, dropping the old one’s sites', async () => {
    mocks.listConnectedSites.mockImplementation((owner: string) =>
      Promise.resolve(
        owner === ALICE
          ? [site({ origin: 'https://alice.example' })]
          : [site({ origin: 'https://bob.example', boundPubkey: BOB })],
      ),
    );
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('https://alice.example');

    accounts().activeId = BOB;
    await flushPromises();

    expect(mocks.listConnectedSites).toHaveBeenLastCalledWith(BOB);
    expect(wrapper.text()).not.toContain('https://alice.example');
    expect(wrapper.text()).toContain('https://bob.example');
    expect(wrapper.find('[data-testid="sites-account"]').text()).toBe(
      'dashboard.connectedSites.accountCaption:bob',
    );
  });

  it('disconnects for the account the page is showing', async () => {
    accounts().activeId = BOB;
    mocks.listConnectedSites.mockResolvedValue([site({ boundPubkey: BOB })]);
    const wrapper = await mountPage();

    await wrapper.findAll('button').at(-1)?.trigger('click');
    await flushPromises();

    expect(mocks.disconnectSite).toHaveBeenCalledWith('https://example.com', BOB);
  });

  it('lists nothing, and says why, without an active account', async () => {
    accounts().activeId = undefined;

    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="sites-account"]').text()).toBe(
      'dashboard.connectedSites.noAccount',
    );
    expect(mocks.listConnectedSites).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain('dashboard.connectedSites.empty');
  });
});
