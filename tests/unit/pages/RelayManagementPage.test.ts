import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

/**
 * The Relays page holds the account relay list, the account's direct message relays, and the
 * Profile Search Relays every account shares (#263).
 */

const account = { id: 'a'.repeat(64), alias: 'alice', createdAt: '', account: { privkey: '' } };

const accountStore = vi.hoisted(() => ({
  activeKey: undefined as string | undefined,
  activeAccountOrFirst: undefined as unknown,
  hasNoAccounts: false,
  getKeys: vi.fn(() => Promise.resolve()),
  setActiveKey: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/stores/account-store', () => ({ default: () => accountStore }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

import RelayManagementPage from '@/pages/dashboard/RelayManagementPage.vue';

const mountPage = async () => {
  const wrapper = mount(RelayManagementPage, {
    global: {
      stubs: {
        'q-page': { template: '<main><slot /></main>' },
        'q-card': { template: '<section><slot /></section>' },
        'q-icon': true,
        'q-btn': true,
        'q-spinner': true,
        RelayEditor: { template: '<div class="relay-editor" />' },
        DmRelayEditor: { template: '<div class="dm-relay-editor" />' },
        ProfileSearchRelayEditor: { template: '<div class="profile-search-relay-editor" />' },
      },
    },
  });
  await flushPromises();
  return wrapper;
};

beforeEach(() => {
  vi.clearAllMocks();
  accountStore.activeKey = account.alias;
  accountStore.activeAccountOrFirst = account;
  accountStore.hasNoAccounts = false;
});

describe('RelayManagementPage', () => {
  it('shows the account, direct message and profile search relay cards, in that order', async () => {
    const wrapper = await mountPage();

    const cards = wrapper
      .findAll('[data-testid$="-card"]')
      .map((card) => card.attributes('data-testid'));
    expect(cards).toEqual(['account-relays-card', 'dm-relays-card', 'profile-search-relays-card']);
    expect(wrapper.find('.relay-editor').exists()).toBe(true);
    expect(wrapper.find('.dm-relay-editor').exists()).toBe(true);
    expect(wrapper.find('.profile-search-relay-editor').exists()).toBe(true);
  });

  it('still shows Profile Search Relays when there is no account', async () => {
    accountStore.activeKey = undefined;
    accountStore.activeAccountOrFirst = undefined;
    accountStore.hasNoAccounts = true;
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('account.noAccounts');
    expect(wrapper.find('.relay-editor').exists()).toBe(false);
    expect(wrapper.find('.dm-relay-editor').exists()).toBe(false);
    expect(wrapper.find('.profile-search-relay-editor').exists()).toBe(true);
  });
});
