import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';

const mocks = vi.hoisted(() => ({
  getDashboardSummary: vi.fn(async () => ({})),
  push: vi.fn(async () => {}),
}));

vi.mock('@/services/dashboard-service', () => ({
  getDashboardSummary: mocks.getDashboardSummary,
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

// Reactive, so switching account in a test reaches the page's watcher as the real store would.
vi.mock('@/stores/account-store', async () => {
  const { reactive } = await import('vue');
  const state = reactive<{ activeKey: string | null }>({ activeKey: 'Woody' });
  (globalThis as { __dashboardAccounts?: typeof state }).__dashboardAccounts = state;
  return { default: () => state };
});

const accounts = () =>
  (globalThis as { __dashboardAccounts?: { activeKey: string | null } }).__dashboardAccounts!;

import DashboardPage from '@/pages/dashboard/DashboardPage.vue';

let wrapper: VueWrapper | undefined;

const mountPage = async () => {
  wrapper = mount(DashboardPage, {
    global: {
      stubs: {
        'q-page': { template: '<div><slot /></div>' },
        ApprovedClientsCard: true,
        ActiveKeysCard: true,
        ConnectedRelaysCard: true,
        QuickSignCard: true,
        RecentActivityCard: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
};

describe('DashboardPage', () => {
  beforeEach(() => {
    accounts().activeKey = 'Woody';
    mocks.getDashboardSummary.mockReset();
    mocks.getDashboardSummary.mockResolvedValue({});
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it('loads the summary when it mounts', async () => {
    await mountPage();

    expect(mocks.getDashboardSummary).toHaveBeenCalledTimes(1);
  });

  it('reloads the summary when the active account changes (#397)', async () => {
    await mountPage();

    accounts().activeKey = 'Anne Mous';
    await flushPromises();

    expect(mocks.getDashboardSummary).toHaveBeenCalledTimes(2);
  });

  it('keeps the latest account when an older load finishes last (#397)', async () => {
    const resolvers: Array<(value: object) => void> = [];
    mocks.getDashboardSummary.mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve)),
    );
    await mountPage();

    accounts().activeKey = 'Anne Mous';
    await flushPromises();
    expect(resolvers).toHaveLength(2);

    resolvers[1]!({ account: 'Anne Mous' });
    await flushPromises();
    resolvers[0]!({ account: 'Woody' });
    await flushPromises();

    const card = wrapper!.findComponent({ name: 'ApprovedClientsCard' });
    expect(card.props('summary')).toEqual({ account: 'Anne Mous' });
    expect(card.props('loading')).toBe(false);
  });
});
