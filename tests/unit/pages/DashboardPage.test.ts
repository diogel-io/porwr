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
    mocks.getDashboardSummary.mockClear();
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
});
