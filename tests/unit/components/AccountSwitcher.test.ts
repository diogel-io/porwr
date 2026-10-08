import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const state = vi.hoisted(() => ({
  activeKey: 'alice' as string | undefined,
  storedKeys: [] as Array<{ id: string; alias: string }>,
  setActiveKey: vi.fn(),
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

vi.mock('@/stores/account-store', () => ({
  default: () => ({
    get activeKey() {
      return state.activeKey;
    },
    get storedKeys() {
      return new Set(state.storedKeys);
    },
    setActiveKey: state.setActiveKey,
  }),
}));

import AccountSwitcher from '@/components/sidebar/AccountSwitcher.vue';

const createTab = vi.fn();

const mountSwitcher = () =>
  mount(AccountSwitcher, {
    global: {
      stubs: {
        'q-btn': { template: '<button><slot /></button>' },
        'q-icon': true,
        'q-menu': { template: '<div><slot /></div>' },
        'q-list': { template: '<ul><slot /></ul>' },
        'q-separator': true,
        'q-item': {
          template: '<li :class="{ active }" @click="$emit(\'click\')"><slot /></li>',
          props: ['clickable', 'active'],
        },
        'q-item-section': { template: '<span><slot /></span>' },
      },
      directives: { 'close-popup': {} },
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  state.activeKey = 'alice';
  state.storedKeys = [
    { id: 'a'.repeat(64), alias: 'alice' },
    { id: 'b'.repeat(64), alias: 'bob' },
  ];
  vi.stubGlobal('chrome', {
    runtime: { getURL: (path: string) => `chrome-extension://id/${path}` },
    tabs: { create: createTab },
  });
});

describe('choosing the identity new sites bind to', () => {
  it('shows the current account', () => {
    const wrapper = mountSwitcher();

    expect(wrapper.text()).toContain('alice');
  });

  it('lists every account to choose from', () => {
    const wrapper = mountSwitcher();

    expect(wrapper.text()).toContain('alice');
    expect(wrapper.text()).toContain('bob');
  });

  it('switches when another account is chosen', async () => {
    const wrapper = mountSwitcher();

    await wrapper.findAll('li')[1]?.trigger('click');
    await flushPromises();

    expect(state.setActiveKey).toHaveBeenCalledWith('bob');
  });

  it('does nothing when the current account is chosen again', async () => {
    const wrapper = mountSwitcher();

    await wrapper.findAll('li')[0]?.trigger('click');
    await flushPromises();

    expect(state.setActiveKey).not.toHaveBeenCalled();
  });

  it('announces the switch so it is not a silent change', async () => {
    const wrapper = mountSwitcher();

    await wrapper.findAll('li')[1]?.trigger('click');
    await flushPromises();

    expect(wrapper.emitted('switched')?.[0]).toEqual(['bob']);
  });

  /**
   * The scope is the point. Switching cannot re-target a site that is already bound, and a control
   * implying otherwise would mislead about which key signs what (#116, S10).
   */
  describe('what it says about its own scope', () => {
    it('states that connected sites keep their identity', () => {
      const wrapper = mountSwitcher();

      expect(wrapper.text()).toContain('sidebar.accountSwitcher.scope');
    });

    it('omits the caveat when there is no choice to make', () => {
      state.storedKeys = [{ id: 'a'.repeat(64), alias: 'alice' }];

      const wrapper = mountSwitcher();

      expect(wrapper.text()).not.toContain('sidebar.accountSwitcher.scope');
    });
  });

  describe('with no account configured', () => {
    it('says so rather than showing an empty control', () => {
      state.activeKey = undefined;
      state.storedKeys = [];

      const wrapper = mountSwitcher();

      expect(wrapper.text()).toContain('sidebar.accountSwitcher.none');
    });
  });

  it('links out to key management in a full tab', async () => {
    const wrapper = mountSwitcher();

    await wrapper.findAll('li').at(-1)?.trigger('click');

    // Management stays full-tab; the panel links out rather than hosting it.
    expect(createTab).toHaveBeenCalledWith({
      url: 'chrome-extension://id/www/index.html#/keys',
    });
  });
});
