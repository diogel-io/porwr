import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNavigation } from '@/composables/useNavigation';
import type { NavigationItem, UtilityLinkItem } from '@/types/navigation';

const testState = vi.hoisted(() => ({
  route: { name: 'dashboard' as string },
}));

vi.mock('vue-router', () => ({
  useRoute: () => testState.route,
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

interface HarnessVm {
  navigationItems: NavigationItem[];
  utilityLinks: UtilityLinkItem[];
}

const TestHarness = defineComponent({
  name: 'UseNavigationHarness',
  setup() {
    const { navigationItems, utilityLinks } = useNavigation();
    return { navigationItems, utilityLinks };
  },
  template: '<div />',
});

describe('useNavigation', () => {
  beforeEach(() => {
    testState.route.name = 'dashboard';
  });

  it('includes an entry for every primary nav destination', () => {
    const wrapper = mount(TestHarness);
    const vm = wrapper.vm as unknown as HarnessVm;

    expect(vm.navigationItems.map((item) => item.id)).toEqual([
      'dashboard',
      'keys',
      'profile',
      'relays',
      'connected-sites',
      'contacts',
      'wallet-connections',
      'event-history',
      'settings',
    ]);
  });

  it('marks only the current route as active', () => {
    testState.route.name = 'profile';
    const wrapper = mount(TestHarness);
    const vm = wrapper.vm as unknown as HarnessVm;

    const active = vm.navigationItems.filter((item) => item.isActive());
    expect(active.map((item) => item.id)).toEqual(['profile']);
  });

  it('treats every key-management sub-route as the keys item being active', () => {
    for (const routeName of ['keys', 'view-key', 'import-key', 'add-new-key', 'edit-account']) {
      testState.route.name = routeName;
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;
      const keysItem = vm.navigationItems.find((item) => item.id === 'keys');
      expect(keysItem?.isActive(), `expected keys active for route "${routeName}"`).toBe(true);
    }
  });

  it('treats both event-history and the legacy logs route as the event-history item being active', () => {
    for (const routeName of ['event-history', 'logs']) {
      testState.route.name = routeName;
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;
      const item = vm.navigationItems.find((i) => i.id === 'event-history');
      expect(item?.isActive()).toBe(true);
    }
  });

  it('provides two utility links pointing at support and documentation', () => {
    const wrapper = mount(TestHarness);
    const vm = wrapper.vm as unknown as HarnessVm;

    expect(vm.utilityLinks.map((link) => link.id)).toEqual(['support', 'documentation']);
    expect(vm.utilityLinks.find((l) => l.id === 'support')?.href).toBe(
      'https://github.com/threenine/diogel/issues',
    );
  });
});
