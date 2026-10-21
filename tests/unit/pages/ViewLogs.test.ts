import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils';

const mocks = vi.hoisted(() => ({
  getApprovals: vi.fn(),
  getExceptions: vi.fn(),
  clearHistory: vi.fn(),
  notify: vi.fn(),
  dialog: vi.fn(),
}));

vi.mock('@/services/log-service', () => ({
  logService: {
    getApprovals: mocks.getApprovals,
    getExceptions: mocks.getExceptions,
    clearHistory: mocks.clearHistory,
  },
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('quasar', () => ({
  useQuasar: () => ({ notify: mocks.notify, dialog: mocks.dialog }),
}));

vi.mock('@/stores/account-store', () => ({
  default: () => ({ activeKey: 'main', getKeys: () => Promise.resolve() }),
}));

import ViewLogs from '@/pages/dashboard/ViewLogs.vue';

enableAutoUnmount(afterEach);

const stubs = {
  'q-page': { template: '<div><slot /></div>' },
  'q-btn': {
    props: ['ariaLabel'],
    emits: ['click'],
    template: '<button :aria-label="ariaLabel" @click="$emit(\'click\')"><slot /></button>',
  },
  'q-tooltip': true,
  'q-card': { template: '<div><slot /></div>' },
  'q-tabs': { template: '<div><slot /></div>' },
  'q-tab': true,
  'q-tab-panels': { template: '<div><slot /></div>' },
  'q-tab-panel': { template: '<div><slot /></div>' },
  'q-table': { props: ['rows'], template: '<div class="table">{{ rows.length }}</div>' },
};

const mountPage = async () => {
  const wrapper = mount(ViewLogs, { global: { stubs } });
  await flushPromises();
  return wrapper;
};

/** The dialog the page opened, with a way to press OK on it. */
const lastDialog = () => {
  const call = mocks.dialog.mock.calls.at(-1)?.[0] as { title: string } | undefined;
  const onOk = mocks.dialog.mock.results.at(-1)?.value.onOk as ReturnType<typeof vi.fn>;
  return { call, confirm: () => (onOk.mock.calls[0]?.[0] as () => void)() };
};

describe('ViewLogs clear history (#144)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApprovals.mockResolvedValue([{ id: 1, hostname: 'example.com' }]);
    mocks.getExceptions.mockResolvedValue([{ id: 2, message: 'boom' }]);
    mocks.clearHistory.mockResolvedValue(undefined);
    mocks.dialog.mockReturnValue({ onOk: vi.fn() });
  });

  it('asks before clearing, and clears nothing if the user does not confirm', async () => {
    const wrapper = await mountPage();

    await wrapper.get('[aria-label="logs.clear.label"]').trigger('click');

    expect(lastDialog().call?.title).toBe('logs.clear.title');
    expect(mocks.clearHistory).not.toHaveBeenCalled();
  });

  it('clears every account and empties both tables once confirmed', async () => {
    const wrapper = await mountPage();
    expect(wrapper.findAll('.table').map((table) => table.text())).toEqual(['1', '1']);

    await wrapper.get('[aria-label="logs.clear.label"]').trigger('click');
    lastDialog().confirm();
    await flushPromises();

    expect(mocks.clearHistory).toHaveBeenCalledTimes(1);
    expect(wrapper.findAll('.table').map((table) => table.text())).toEqual(['0', '0']);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'positive' }));
  });

  it('says so when clearing fails, and keeps what it showed', async () => {
    mocks.clearHistory.mockRejectedValueOnce(new Error('blocked'));
    const wrapper = await mountPage();

    await wrapper.get('[aria-label="logs.clear.label"]').trigger('click');
    lastDialog().confirm();
    await flushPromises();

    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
    expect(wrapper.findAll('.table').map((table) => table.text())).toEqual(['1', '1']);
  });
});
