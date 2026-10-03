import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const mocks = vi.hoisted(() => ({
  listConnectedSites: vi.fn(),
  disconnectSite: vi.fn(),
  notify: vi.fn(),
  dialog: vi.fn(),
}));

vi.mock('src/services/connected-sites-service', () => ({
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

const accounts = vi.hoisted(() => ({
  storedKeys: new Set<{ id: string; alias: string }>(),
  activeId: undefined as string | undefined,
}));

vi.mock('src/stores/account-store', () => ({
  default: () => ({
    get storedKeys() {
      return accounts.storedKeys;
    },
    get activeAccount() {
      return Array.from(accounts.storedKeys).find((key) => key.id === accounts.activeId);
    },
    getKeys: vi.fn(),
  }),
}));

import ConnectedSitesPage from 'src/pages/dashboard/ConnectedSitesPage.vue';

const ALICE = 'a'.repeat(64);

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

beforeEach(() => {
  vi.clearAllMocks();
  accounts.storedKeys = new Set();
  accounts.activeId = undefined;
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

      expect(mocks.disconnectSite).toHaveBeenCalledWith('https://example.com');
      expect(mocks.listConnectedSites).toHaveBeenCalled();
    });

    it('reports a refusal rather than showing success', async () => {
      mocks.disconnectSite.mockResolvedValue(false);
      mocks.listConnectedSites.mockResolvedValue([site()]);
      const wrapper = await mountPage();

      await wrapper.findAll('button').at(-1)?.trigger('click');
      await flushPromises();

      expect(mocks.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'negative' }),
      );
    });
  });

  it('reports a failure to load rather than showing an empty list as though it were true', async () => {
    mocks.listConnectedSites.mockRejectedValue(new Error('bridge down'));

    await mountPage();

    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
  });
});

describe('which account a site signs as (workspace#23)', () => {
  const BOB = 'b'.repeat(64);

  it('names the bound account by its alias as well as its key', async () => {
    accounts.storedKeys = new Set([{ id: ALICE, alias: 'alice' }]);
    accounts.activeId = ALICE;
    mocks.listConnectedSites.mockResolvedValue([site()]);

    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="bound-alias"]').text()).toBe('alice');
    expect(wrapper.find('[data-testid="not-active"]').exists()).toBe(false);
  });

  it('marks a site connected as an account that is not the active one', async () => {
    accounts.storedKeys = new Set([
      { id: ALICE, alias: 'alice' },
      { id: BOB, alias: 'bob' },
    ]);
    accounts.activeId = BOB;
    mocks.listConnectedSites.mockResolvedValue([site()]);

    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="not-active"]').text()).toBe(
      'dashboard.connectedSites.notActive',
    );
  });

  it('claims no mismatch when the accounts are not known, as with the vault locked', async () => {
    mocks.listConnectedSites.mockResolvedValue([site()]);

    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="bound-alias"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="not-active"]').exists()).toBe(false);
  });
});
