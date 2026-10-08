import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import type { DashboardSummary } from '@/types';
import ApprovedClientsCard from '@/components/dashboard/ApprovedClientsCard.vue';

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'dashboard.widgets.approvedClients.title': 'Approved Clients',
      };
      return translations[key] ?? key;
    },
  }),
}));

const globalStubs = {
  'q-card': {
    template: '<div class="q-card-stub"><slot /></div>',
  },
  'q-card-section': {
    template: '<section><slot /></section>',
  },
  'q-icon': {
    template: '<i><slot /></i>',
    props: ['name', 'size', 'color'],
  },
  'q-spinner': {
    template: '<span class="q-spinner-stub" />',
  },
};

describe('ApprovedClientsCard.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders 0 when summary is null', () => {
    const wrapper = mount(ApprovedClientsCard, {
      props: { summary: null },
      global: { stubs: globalStubs },
    });

    expect(wrapper.text()).toContain('0');
    expect(wrapper.find('.q-spinner-stub').exists()).toBe(false);
  });

  it('renders spinner while loading', () => {
    const wrapper = mount(ApprovedClientsCard, {
      props: { summary: null, loading: true },
      global: { stubs: globalStubs },
    });

    expect(wrapper.find('.q-spinner-stub').exists()).toBe(true);
  });

  it('renders summary.approvedClients when provided', () => {
    const summary: DashboardSummary = {
      state: 'ready',
      approvedClients: 7,
      activeKeys: 1,
      connectedRelays: 3,
      connectedRelaysState: 'ready',
      recentActivity: [],
    };

    const wrapper = mount(ApprovedClientsCard, {
      props: { summary },
      global: { stubs: globalStubs },
    });

    expect(wrapper.text()).toContain('7');
    expect(wrapper.find('.q-spinner-stub').exists()).toBe(false);
  });
});