import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';

const { sendBexMessage, connectPanelPort, disconnect, portOptions } = vi.hoisted(() => ({
  sendBexMessage: vi.fn(),
  connectPanelPort: vi.fn(),
  disconnect: vi.fn(),
  portOptions: { current: undefined as { onQueueChanged?: () => void; onReconnect?: () => void } | undefined },
}));

vi.mock('@/services/bridge-client', () => ({ sendBexMessage }));
vi.mock('@/services/panel-port', () => ({
  PANEL_PORT_NAME: 'porwr-panel',
  connectPanelPort,
}));
vi.mock('@/services/log-service', () => ({
  LogLevel: { DEBUG: 'debug' },
  logService: { log: vi.fn() },
}));

import { resetApprovalQueue, useApprovalQueue } from '@/composables/useApprovalQueue';

const Consumer = defineComponent({
  name: 'QueueConsumer',
  setup() {
    return useApprovalQueue();
  },
  template: '<div />',
});

/** Lets the mounted `void refresh()` settle before assertions. */
const flush = async (): Promise<void> => {
  await vi.waitFor(() => expect(sendBexMessage).toHaveBeenCalled());
};

describe('useApprovalQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetApprovalQueue();
    sendBexMessage.mockResolvedValue([]);
    portOptions.current = undefined;
    connectPanelPort.mockImplementation((options: { onQueueChanged?: () => void }) => {
      portOptions.current = options;
      return { disconnect };
    });
  });

  afterEach(() => {
    resetApprovalQueue();
    vi.useRealTimers();
  });

  describe('shared state', () => {
    it('drives nothing from a timer (#140)', () => {
      vi.useFakeTimers();
      const setInterval = vi.spyOn(globalThis, 'setInterval');

      const header = mount(Consumer);
      const page = mount(Consumer);

      // The background pushes; the panel re-reads. A poll interval is both a delay before a
      // request appears and a second source of truth about when to look.
      expect(setInterval).not.toHaveBeenCalled();

      header.unmount();
      page.unmount();
    });

    it('opens one port however many consumers are mounted', () => {
      const header = mount(Consumer);
      const page = mount(Consumer);

      // The background counts connections, so a second port would make one panel look like two.
      expect(connectPanelPort).toHaveBeenCalledTimes(1);

      header.unmount();
      page.unmount();
    });

    it('hands every consumer the same queue object', () => {
      const header = mount(Consumer);
      const page = mount(Consumer);

      expect(header.vm.pending).toBe(page.vm.pending);
      expect(header.vm.current).toBe(page.vm.current);

      header.unmount();
      page.unmount();
    });
  });

  describe('teardown', () => {
    it('keeps the port open while any consumer remains', () => {
      const header = mount(Consumer);
      const page = mount(Consumer);

      header.unmount();
      expect(disconnect).not.toHaveBeenCalled();

      page.unmount();
      expect(disconnect).toHaveBeenCalled();
    });

    it('requeues the presented request only once the last consumer has gone', () => {
      const header = mount(Consumer);
      const page = mount(Consumer);

      header.unmount();
      expect(sendBexMessage).not.toHaveBeenCalledWith('nostr.requests.requeuePresented');

      page.unmount();
      // Closing the panel is never a decision (FR-6); navigating within it is not either.
      expect(sendBexMessage).toHaveBeenCalledWith('nostr.requests.requeuePresented');
    });
  });

  describe('push notifications (#140)', () => {
    it('re-reads when the background says the queue moved', async () => {
      const wrapper = mount(Consumer);
      await vi.waitFor(() => expect(sendBexMessage).toHaveBeenCalled());
      sendBexMessage.mockClear();

      portOptions.current?.onQueueChanged?.();

      // The notification carries no state, so the answer has to come from a fresh read.
      await vi.waitFor(() => expect(sendBexMessage).toHaveBeenCalledWith('nostr.requests.list'));
      wrapper.unmount();
    });

    it('re-reads on reconnect, since the worker may have reconciled while it was gone', async () => {
      const wrapper = mount(Consumer);
      await vi.waitFor(() => expect(sendBexMessage).toHaveBeenCalled());
      sendBexMessage.mockClear();

      portOptions.current?.onReconnect?.();

      await vi.waitFor(() => expect(sendBexMessage).toHaveBeenCalledWith('nostr.requests.list'));
      wrapper.unmount();
    });
  });

  describe('refresh', () => {
    it('reads the queue from the background rather than caching a decision', async () => {
      const record = { id: 'req-1', state: 'presented' };
      sendBexMessage.mockImplementation((event: string) => {
        if (event === 'nostr.requests.list') return Promise.resolve([record]);
        if (event === 'nostr.requests.current') return Promise.resolve(record);
        return Promise.resolve(null);
      });

      const wrapper = mount(Consumer);
      await flush();
      await vi.waitFor(() => expect(wrapper.vm.pendingCount).toBe(1));

      expect(wrapper.vm.current).toEqual(record);
      wrapper.unmount();
    });
  });
});
