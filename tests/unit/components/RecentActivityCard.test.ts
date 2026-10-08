import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import type { DashboardSummary } from '@/types';
import RecentActivityCard from '@/components/dashboard/RecentActivityCard.vue';

const { getDashboardSummaryMock, dateFormatterMock } = vi.hoisted(() => ({
  getDashboardSummaryMock: vi.fn(),
  dateFormatterMock: vi.fn((value: Date) => `formatted:${value.toISOString()}`),
}));

vi.mock('@/services/dashboard-service', () => ({
  getDashboardSummary: getDashboardSummaryMock,
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      const translations: Record<string, string> = {
        'dashboard.widgets.recentActivity.title': 'Recent Activity',
        'dashboard.widgets.recentActivity.columns.eventType': 'Event Type',
        'dashboard.widgets.recentActivity.columns.keyPubkey': 'Key/Pubkey',
        'dashboard.widgets.recentActivity.columns.time': 'Time',
        'dashboard.widgets.recentActivity.columns.status': 'Status',
        'dashboard.widgets.recentActivity.eventType.named.note': 'Note',
        'dashboard.widgets.recentActivity.eventType.named.directMessage': 'Direct Msg',
        'dashboard.widgets.recentActivity.eventType.kindWithName': 'Kind {kind}: {name}',
        'dashboard.widgets.recentActivity.eventType.extensionException': 'Extension exception',
        'dashboard.widgets.recentActivity.status.success': 'SUCCESS',
        'dashboard.widgets.recentActivity.status.error': 'ERROR',
        'dashboard.widgets.recentActivity.status.rejected': 'REJECTED',
        'dashboard.widgets.recentActivity.ready': 'Ready',
        'dashboard.widgets.common.error': 'Error',
        'dashboard.widgets.common.locked': 'Locked',
        'dashboard.widgets.common.noAccount': 'No account',
        'dashboard.widgets.recentActivity.empty': 'Empty',
        'dashboard.widgets.recentActivity.unknownKey': 'Unknown key',
      };
      const template = translations[key] ?? key;
      if (!params) {
        return template;
      }

      return template.replace(/{(\w+)}/g, (_, token: string) => params[token] ?? `{${token}}`);
    },
    d: dateFormatterMock,
  }),
}));

const globalStubs = {
  'q-card': {
    template: '<div class="q-card-stub" @click="$emit(\'click\')"><slot /></div>',
    props: ['clickable'],
    emits: ['click'],
  },
  'q-card-section': {
    template: '<section><slot /></section>',
  },
  'q-icon': {
    template: '<i><slot /></i>',
    props: ['name', 'size', 'color'],
  },
  'q-chip': {
    template: '<span class="q-chip-stub"><slot /></span>',
    props: ['square', 'dense'],
  },
  'q-badge': {
    template: '<span class="q-badge-stub"><slot /></span>',
    props: ['rounded'],
  },
  'q-spinner': {
    template: '<span class="q-spinner-stub" />',
  },
};

async function flushComponent(): Promise<void> {
  await Promise.resolve();
  await nextTick();
}

describe('RecentActivityCard.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dateFormatterMock.mockImplementation((value: Date) => `formatted:${value.toISOString()}`);
  });

  const mockSummary: DashboardSummary = {
    state: 'ready',
    approvedClients: 0,
    activeKeys: 1,
    connectedRelays: 0,
    connectedRelaysState: 'unavailable',
    recentActivity: [
      {
        type: 'approval',
        status: 'approved',
        dateTime: '2026-01-01T10:00:00.000Z',
        title: 'Approval request accepted',
        eventKind: 1,
        accountAlias: 'alpha',
        accountNpub: 'f'.repeat(64),
      },
    ],
  };

  it('renders table headers and activity row fields when rows exist', async () => {
    const wrapper = mount(RecentActivityCard, {
      props: {
        summary: mockSummary,
      },
      global: {
        stubs: globalStubs,
      },
    });

    await flushComponent();

    const text = wrapper.text();
    expect(text).toContain('Event Type');
    expect(text).toContain('Key/Pubkey');
    expect(text).toContain('Time');
    expect(text).toContain('Status');
    expect(wrapper.find('.dashboard-widget-card__table').exists()).toBe(true);
    expect(wrapper.findAll('.dashboard-widget-card__table-row')).toHaveLength(1);
    expect(text).toContain('Kind 1: Note');
    expect(text).toMatch(/npub1\.\.\.[a-z0-9]{4}/);
    expect(text).toContain('formatted:2026-01-01T10:00:00.000Z');
    expect(text).toContain('SUCCESS');
    expect(text).not.toContain('View All');
  });

  it('shows fallback time and semantic status classes', async () => {
    const customSummary: DashboardSummary = {
      state: 'ready',
      approvedClients: 0,
      activeKeys: 1,
      connectedRelays: 0,
      connectedRelaysState: 'unavailable',
      recentActivity: [
        {
          type: 'approval',
          status: 'approved',
          dateTime: '',
          title: 'Approval request accepted',
          eventKind: 1,
          accountAlias: 'alpha',
          accountNpub: 'f'.repeat(64),
        },
        {
          type: 'exception',
          status: 'exception',
          dateTime: '2026-01-01T11:00:00.000Z',
          title: 'Extension exception',
          detail: 'bad payload',
          accountAlias: 'alpha',
        },
        {
          type: 'approval',
          status: 'rejected',
          dateTime: '2026-01-01T12:00:00.000Z',
          title: 'Approval request rejected',
          eventKind: 1,
          accountAlias: 'alpha',
        },
      ],
    };

    const wrapper = mount(RecentActivityCard, {
      props: {
        summary: customSummary,
      },
      global: {
        stubs: globalStubs,
      },
    });

    await flushComponent();

    expect(wrapper.findAll('.dashboard-widget-card__time').at(0)?.text()).toBe('-');

    const badges = wrapper.findAll('.q-badge-stub');
    expect(badges.at(0)?.classes()).toContain('dashboard-widget-card__status--success');
    expect(badges.at(1)?.classes()).toContain('dashboard-widget-card__status--error');
    expect(badges.at(2)?.classes()).toContain('dashboard-widget-card__status--rejected');
  });

  it('falls back to Intl formatting when i18n datetime format is unavailable', async () => {
    dateFormatterMock.mockImplementation(() => '');

    const wrapper = mount(RecentActivityCard, {
      props: {
        summary: mockSummary,
      },
      global: {
        stubs: globalStubs,
      },
    });

    await flushComponent();

    const timeText = wrapper.find('.dashboard-widget-card__time').text();
    expect(timeText).not.toBe('');
    expect(timeText).not.toBe('-');
    expect(timeText).not.toContain('formatted:');
  });

  it('emits open when clickable is true', async () => {
    const wrapper = mount(RecentActivityCard, {
      props: {
        clickable: true,
      },
      global: {
        stubs: globalStubs,
      },
    });

    await flushComponent();
    await wrapper.find('.q-card-stub').trigger('click');

    expect(wrapper.emitted('open')).toHaveLength(1);
  });

  it('does not emit open when clickable is false', async () => {
    const wrapper = mount(RecentActivityCard, {
      props: {
        clickable: false,
      },
      global: {
        stubs: globalStubs,
      },
    });

    await flushComponent();
    await wrapper.find('.q-card-stub').trigger('click');

    expect(wrapper.emitted('open')).toBeUndefined();
  });
});
