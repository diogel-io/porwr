import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';

const { sendBexMessage } = vi.hoisted(() => ({ sendBexMessage: vi.fn() }));

vi.mock('@/services/bridge-client', () => ({ sendBexMessage }));
vi.mock('@/services/log-service', () => ({
  LogLevel: { DEBUG: 'debug' },
  logService: { log: vi.fn() },
}));

import { useActiveTab } from '@/composables/useActiveTab';

const Harness = defineComponent({
  name: 'ActiveTabHarness',
  setup() {
    return useActiveTab();
  },
  template: '<div />',
});

const query = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('chrome', {
    tabs: {
      query,
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
});

const settle = async (): Promise<void> => {
  await vi.waitFor(() => expect(query).toHaveBeenCalled());
  await nextTick();
  await nextTick();
};

describe('useActiveTab', () => {
  it('resolves the origin through the background rather than from the tab', async () => {
    // The regression this guards: `tab.url` is redacted without the `tabs` permission, which
    // NFR-18 forbids adding, so reading it here always produced an empty origin.
    query.mockResolvedValue([{ id: 42 }]);
    sendBexMessage.mockResolvedValue('https://example.com');

    const wrapper = mount(Harness);
    await settle();

    expect(sendBexMessage).toHaveBeenCalledWith('pages.originForTab', { tabId: 42 });
    await vi.waitFor(() => expect(wrapper.vm.activeOrigin).toBe('https://example.com'));
    wrapper.unmount();
  });

  it('reports no origin when the background has never seen the tab', async () => {
    query.mockResolvedValue([{ id: 42 }]);
    sendBexMessage.mockResolvedValue(null);

    const wrapper = mount(Harness);
    await settle();

    expect(wrapper.vm.activeOrigin).toBe('');
    wrapper.unmount();
  });

  it('does not ask the background when there is no active tab', async () => {
    query.mockResolvedValue([]);

    const wrapper = mount(Harness);
    await settle();

    expect(sendBexMessage).not.toHaveBeenCalled();
    expect(wrapper.vm.activeOrigin).toBe('');
    wrapper.unmount();
  });

  it('falls back to no origin when the background call fails', async () => {
    query.mockResolvedValue([{ id: 42 }]);
    sendBexMessage.mockRejectedValue(new Error('bridge down'));

    const wrapper = mount(Harness);
    await settle();

    expect(wrapper.vm.activeOrigin).toBe('');
    wrapper.unmount();
  });

  it('refreshes on a tab status change, since url changes are never delivered', async () => {
    query.mockResolvedValue([{ id: 42 }]);
    sendBexMessage.mockResolvedValue('https://example.com');

    const wrapper = mount(Harness);
    await settle();

    const chromeMock = globalThis.chrome as unknown as {
      tabs: { onUpdated: { addListener: ReturnType<typeof vi.fn> } };
    };
    const onUpdated = chromeMock.tabs.onUpdated.addListener.mock.calls[0]?.[0] as (
      tabId: number,
      info: { status?: string; url?: string },
    ) => void;

    query.mockClear();
    onUpdated(42, { status: 'complete' });
    await vi.waitFor(() => expect(query).toHaveBeenCalled());

    query.mockClear();
    onUpdated(42, {});
    await nextTick();
    expect(query).not.toHaveBeenCalled();

    wrapper.unmount();
  });
});
