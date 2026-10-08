import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed, nextTick, ref } from 'vue';

const testState = vi.hoisted(() => ({
  handleLock: vi.fn(async () => undefined),
  isUnlocked: true,
  pendingCount: 0,
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, named?: Record<string, number>, plural?: number) => {
      if (key !== 'sidebar.header.pending.ariaLabel') return key;
      const count = named?.count ?? plural ?? 0;
      if (count === 0) return 'No requests waiting';
      return count === 1 ? '1 request waiting' : `${count} requests waiting`;
    },
  }),
}));

vi.mock('@/composables/useVault', () => ({
  useVault: () => ({ handleLock: testState.handleLock }),
}));

vi.mock('@/stores/vault-store', () => ({
  default: () => ({
    get isUnlocked() {
      return testState.isUnlocked;
    },
  }),
}));

const pendingCount = ref(0);

vi.mock('@/composables/useApprovalQueue', () => ({
  useApprovalQueue: () => ({ pendingCount: computed(() => pendingCount.value) }),
}));

const mountLayout = async () => {
  const SidebarLayout = (await import('@/layouts/sidebar/Layout.vue')).default;

  return mount(SidebarLayout, {
    global: {
      stubs: {
        DiogelLogo: true,
        SidebarFooterLinks: true,
        AccountSwitcher: { template: '<div class="account-switcher-stub" />' },
        'router-view': true,
        'q-layout': { template: '<div><slot /></div>' },
        'q-page-container': { template: '<div><slot /></div>' },
        'q-badge': { template: '<span class="badge"><slot /></span>' },
        'q-btn': {
          template: '<button :aria-label="ariaLabel"><slot /></button>',
          props: ['icon', 'ariaLabel'],
        },
      },
    },
  });
};

describe('SidebarLayout header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.isUnlocked = true;
    pendingCount.value = 0;
  });

  describe('lock action', () => {
    it('is reachable from the header whenever the vault is unlocked', async () => {
      const wrapper = await mountLayout();

      const lock = wrapper.find('.sidebar-header__lock');
      expect(lock.exists()).toBe(true);

      await lock.trigger('click');
      expect(testState.handleLock).toHaveBeenCalledTimes(1);
    });

    it('stays available once a request is presented', async () => {
      pendingCount.value = 3;
      const wrapper = await mountLayout();

      // The regression this guards: the action used to live in the idle view, so presenting a
      // request took it off screen.
      expect(wrapper.find('.sidebar-header__lock').exists()).toBe(true);
    });

    it('is hidden while the vault is locked', async () => {
      testState.isUnlocked = false;
      const wrapper = await mountLayout();

      expect(wrapper.find('.sidebar-header__lock').exists()).toBe(false);
    });
  });

  describe('pending count', () => {
    it('is not rendered when nothing is waiting', async () => {
      const wrapper = await mountLayout();

      expect(wrapper.find('.sidebar-header__pending').exists()).toBe(false);
    });

    it('shows the queue length', async () => {
      pendingCount.value = 2;
      const wrapper = await mountLayout();

      expect(wrapper.find('.sidebar-header__pending').text()).toBe('2');
    });

    it('follows the queue without a remount', async () => {
      const wrapper = await mountLayout();

      pendingCount.value = 1;
      await nextTick();
      expect(wrapper.find('.sidebar-header__pending').text()).toBe('1');

      pendingCount.value = 0;
      await nextTick();
      expect(wrapper.find('.sidebar-header__pending').exists()).toBe(false);
    });
  });

  describe('accessibility (NFR-4)', () => {
    it('exposes the count through a polite live region, never assertively', async () => {
      pendingCount.value = 2;
      const wrapper = await mountLayout();

      const region = wrapper.find('[role="status"]');
      expect(region.attributes('aria-live')).toBe('polite');
      expect(region.text()).toBe('2 requests waiting');
    });

    it('keeps the live region present at zero so a return to empty is announced', async () => {
      const wrapper = await mountLayout();

      expect(wrapper.find('[role="status"]').text()).toBe('No requests waiting');
    });

    it('hides the visual badge from assistive technology to avoid announcing it twice', async () => {
      pendingCount.value = 5;
      const wrapper = await mountLayout();

      expect(wrapper.find('.sidebar-header__pending').attributes('aria-hidden')).toBe('true');
    });
  });
});
