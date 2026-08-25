import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';

const state = vi.hoisted(() => ({ vaultExists: true, isUnlocked: true }));

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

vi.mock('src/stores/vault-store', () => ({
  default: () => ({
    get vaultExists() {
      return state.vaultExists;
    },
    get isUnlocked() {
      return state.isUnlocked;
    },
  }),
}));

/**
 * The account store was mocked as permanently empty, with `activeKey: undefined`, so no test could
 * express a vault that holds an account. That is half of why #211 shipped: the panel's empty state
 * was asserted against a store that could never be anything else.
 */
const accounts = vi.hoisted(() => ({
  activeKey: undefined as string | undefined,
  storedKeys: new Set<{ alias: string }>(),
  hydration: 'ready' as 'empty' | 'loading' | 'ready',
}));

vi.mock('src/stores/account-store', () => ({
  default: () => ({
    get activeKey() {
      return accounts.activeKey;
    },
    get storedKeys() {
      return accounts.storedKeys;
    },
    get hydration() {
      return accounts.hydration;
    },
    get activeAccount() {
      if (!accounts.activeKey) return undefined;
      return Array.from(accounts.storedKeys).find((key) => key.alias === accounts.activeKey);
    },
    get hasNoAccounts() {
      return accounts.hydration === 'ready' && accounts.storedKeys.size === 0;
    },
    getKeys: vi.fn(),
  }),
}));

vi.mock('src/composables/useActiveTab', () => ({ useActiveTab: () => ({ activeOrigin: ref('') }) }));

vi.mock('src/composables/useApprovalQueue', () => ({
  useApprovalQueue: () => ({
    pending: ref([]),
    current: ref(null),
    content: ref(null),
    decide: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const mountPage = async () => {
  const SidebarHome = (await import('src/pages/sidebar/SidebarHome.vue')).default;
  return mount(SidebarHome, {
    global: {
      stubs: {
        'q-page': { template: '<div><slot /></div>' },
        'q-icon': true,
        'q-btn': { template: '<button>{{ label }}</button>', props: ['label'] },
        ProfileView: true,
        CurrentRequest: true,
        PendingRequestList: true,
        SidebarUnlock: { template: '<div class="sidebar-unlock" />' },
      },
    },
  });
};

describe('SidebarHome body precedence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.vaultExists = true;
    state.isUnlocked = true;
    accounts.activeKey = undefined;
    accounts.storedKeys = new Set();
    accounts.hydration = 'ready';
  });

  describe('when no vault exists', () => {
    beforeEach(() => {
      state.vaultExists = false;
      state.isUnlocked = false;
    });

    it('offers to set Porwr up', async () => {
      const wrapper = await mountPage();

      expect(wrapper.find('.sidebar-setup').exists()).toBe(true);
    });

    it('never offers to unlock a vault that does not exist', async () => {
      // The bug this guards (#158): `!isUnlocked` alone put the unlock view in front of a user who
      // had no vault to unlock.
      const wrapper = await mountPage();

      expect(wrapper.find('.sidebar-unlock').exists()).toBe(false);
    });
  });

  describe('when the vault exists but is locked', () => {
    beforeEach(() => {
      state.vaultExists = true;
      state.isUnlocked = false;
    });

    it('shows the unlock view (S2)', async () => {
      const wrapper = await mountPage();

      expect(wrapper.find('.sidebar-unlock').exists()).toBe(true);
      expect(wrapper.find('.sidebar-setup').exists()).toBe(false);
    });
  });

  describe('when the vault is unlocked', () => {
    it('shows neither setup nor unlock', async () => {
      const wrapper = await mountPage();

      expect(wrapper.find('.sidebar-setup').exists()).toBe(false);
      expect(wrapper.find('.sidebar-unlock').exists()).toBe(false);
    });

    it('shows the active account (#211)', async () => {
      accounts.activeKey = 'Main Account';
      accounts.storedKeys = new Set([{ alias: 'Main Account' }]);

      const wrapper = await mountPage();

      expect(wrapper.find('.sidebar-home__account').exists()).toBe(true);
      expect(wrapper.find('.sidebar-home__empty').exists()).toBe(false);
    });

    it('still reports S16 for a vault that genuinely holds no accounts', async () => {
      accounts.hydration = 'ready';
      accounts.storedKeys = new Set();

      const wrapper = await mountPage();

      expect(wrapper.text()).toContain('account.noActiveAccount');
    });
  });

  /**
   * The reported bug (#211).
   *
   * The panel mounts while the vault is locked — unlock is a branch inside this component, not a
   * separate route — so it hydrated from a locked vault, where `dexie-storage.get()` answers `{}`.
   * The active alias lives in local storage and survived the lock, so the panel held an alias it
   * could not resolve and rendered "no active account" at a user who had one.
   *
   * This is the state the panel is in for the moment after unlocking, before the store has read
   * the vault back. The lock-to-unlock transition that produces it is covered against a real store
   * in `tests/unit/stores/account-store.test.ts`; what matters here is what the panel draws.
   */
  describe('unlocked, with the vault not yet read back', () => {
    beforeEach(() => {
      accounts.activeKey = 'Main Account';
      accounts.storedKeys = new Set();
      accounts.hydration = 'empty';
    });

    it('does not claim there is no account', async () => {
      const wrapper = await mountPage();

      expect(wrapper.text()).not.toContain('account.noActiveAccount');
    });

    it('says it is still loading instead', async () => {
      const wrapper = await mountPage();

      expect(wrapper.text()).toContain('account.loading');
    });
  });
});
