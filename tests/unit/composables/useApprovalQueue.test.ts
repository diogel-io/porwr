import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';

const { sendBexMessage, connectPanelPort, disconnect, portOptions } = vi.hoisted(() => ({
  sendBexMessage: vi.fn(),
  connectPanelPort: vi.fn(),
  disconnect: vi.fn(),
  portOptions: {
    current: undefined as { onQueueChanged?: () => void; onReconnect?: () => void } | undefined,
  },
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

/** The background's answer: this record is the whole queue and the current request. */
const answerWith = (record: { id: string; state: string; expiresAt: number }): void => {
  sendBexMessage.mockImplementation((event: string) => {
    if (event === 'nostr.requests.list') return Promise.resolve([record]);
    if (event === 'nostr.requests.current') return Promise.resolve(record);
    if (event === 'nostr.requests.dismiss') return Promise.resolve(true);
    return Promise.resolve(null);
  });
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

    it('presents a request that is waiting', async () => {
      const record = { id: 'req-1', state: 'queued', expiresAt: Date.now() + 60_000 };
      answerWith(record);

      const wrapper = mount(Consumer);

      await vi.waitFor(() =>
        expect(sendBexMessage).toHaveBeenCalledWith('nostr.requests.present', {
          requestId: 'req-1',
        }),
      );
      wrapper.unmount();
    });

    it('never presents an expired or interrupted notice (S13, S14)', async () => {
      const notice = { id: 'req-1', state: 'expired', expiresAt: Date.now() - 1 };
      answerWith(notice);

      const wrapper = mount(Consumer);
      await vi.waitFor(() => expect(wrapper.vm.current).toEqual(notice));

      expect(sendBexMessage).not.toHaveBeenCalledWith('nostr.requests.present', expect.anything());
      wrapper.unmount();
    });
  });

  describe('loading until the first read (D13, porwr#371)', () => {
    it('stays loading while the first read is in flight', async () => {
      let answer: (records: unknown[]) => void = () => undefined;
      sendBexMessage.mockImplementation(
        () => new Promise((resolve) => (answer = resolve as (records: unknown[]) => void)),
      );

      const wrapper = mount(Consumer);
      await flush();
      expect(wrapper.vm.loading).toBe(true);

      answer([]);
      wrapper.unmount();
    });

    it('stops loading once the queue has been read', async () => {
      sendBexMessage.mockResolvedValue(null);

      const wrapper = mount(Consumer);
      await vi.waitFor(() => expect(wrapper.vm.loading).toBe(false));

      wrapper.unmount();
    });

    it('keeps loading after a failed read, and stops once a read succeeds', async () => {
      sendBexMessage.mockRejectedValue(new Error('background unreachable'));

      const wrapper = mount(Consumer);
      await flush();
      await vi.waitFor(() => expect(sendBexMessage).toHaveBeenCalledWith('nostr.requests.list'));
      await Promise.resolve();
      // An unread queue is not an empty one: the idle view must not mount on a guess.
      expect(wrapper.vm.loading).toBe(true);

      sendBexMessage.mockResolvedValue(null);
      portOptions.current?.onReconnect?.();
      await vi.waitFor(() => expect(wrapper.vm.loading).toBe(false));

      wrapper.unmount();
    });

    it('loads again for the next panel once the last consumer has gone', async () => {
      sendBexMessage.mockResolvedValue(null);
      const first = mount(Consumer);
      await vi.waitFor(() => expect(first.vm.loading).toBe(false));
      first.unmount();

      sendBexMessage.mockImplementation(() => new Promise(() => undefined));
      const next = mount(Consumer);
      expect(next.vm.loading).toBe(true);

      next.unmount();
    });
  });

  describe('dismiss', () => {
    it('asks the background to dismiss the notice, then re-reads', async () => {
      answerWith({ id: 'req-1', state: 'interrupted', expiresAt: 0 });
      const wrapper = mount(Consumer);
      await flush();
      sendBexMessage.mockClear();

      await wrapper.vm.dismiss('req-1');

      expect(sendBexMessage).toHaveBeenCalledWith('nostr.requests.dismiss', { requestId: 'req-1' });
      expect(sendBexMessage).toHaveBeenCalledWith('nostr.requests.current');
      wrapper.unmount();
    });
  });

  describe('present (porwr#334)', () => {
    it('tells the background which request was chosen, then shows what it answers', async () => {
      const first = { id: 'req-1', state: 'presented', expiresAt: Date.now() + 60_000 };
      const second = { id: 'req-2', state: 'queued', expiresAt: Date.now() + 60_000 };
      let chosen = first.id;
      sendBexMessage.mockImplementation((event: string, payload?: { requestId: string }) => {
        if (event === 'nostr.requests.list') return Promise.resolve([first, second]);
        if (event === 'nostr.requests.current') {
          return Promise.resolve(chosen === first.id ? first : { ...second, state: 'presented' });
        }
        if (event === 'nostr.requests.present' && payload) chosen = payload.requestId;
        return Promise.resolve(null);
      });
      const wrapper = mount(Consumer);
      await flush();
      await vi.waitFor(() => expect(wrapper.vm.current?.id).toBe('req-1'));
      sendBexMessage.mockClear();

      await wrapper.vm.present('req-2');

      const events = sendBexMessage.mock.calls.map(([event]) => event);
      expect(events.indexOf('nostr.requests.present')).toBeLessThan(
        events.indexOf('nostr.requests.current'),
      );
      expect(sendBexMessage).toHaveBeenCalledWith('nostr.requests.present', { requestId: 'req-2' });
      expect(wrapper.vm.current?.id).toBe('req-2');
      wrapper.unmount();
    });
  });

  describe('expiry while the panel is open (S13)', () => {
    /** Lets the mounted refresh finish without `vi.waitFor`, which would move the fake clock. */
    const settle = async (): Promise<void> => {
      for (let step = 0; step < 5; step += 1) await vi.advanceTimersByTimeAsync(0);
    };

    it('re-reads once the current request is due to expire', async () => {
      vi.useFakeTimers();
      answerWith({ id: 'req-1', state: 'presented', expiresAt: Date.now() + 1_000 });
      const wrapper = mount(Consumer);
      await settle();
      sendBexMessage.mockClear();

      await vi.advanceTimersByTimeAsync(900);
      expect(sendBexMessage).not.toHaveBeenCalledWith('nostr.requests.list');

      // The read is what expires the request; the timer only makes sure one happens.
      await vi.advanceTimersByTimeAsync(400);
      expect(sendBexMessage).toHaveBeenCalledWith('nostr.requests.list');
      wrapper.unmount();
    });

    it('arms nothing for a notice, which cannot expire again', async () => {
      vi.useFakeTimers();
      answerWith({ id: 'req-1', state: 'expired', expiresAt: Date.now() - 1 });
      const wrapper = mount(Consumer);
      await settle();
      sendBexMessage.mockClear();

      await vi.advanceTimersByTimeAsync(60_000);

      expect(sendBexMessage).not.toHaveBeenCalledWith('nostr.requests.list');
      wrapper.unmount();
    });

    it('stops the timer when the panel closes', async () => {
      vi.useFakeTimers();
      answerWith({ id: 'req-1', state: 'presented', expiresAt: Date.now() + 1_000 });
      const wrapper = mount(Consumer);
      await settle();
      wrapper.unmount();
      sendBexMessage.mockClear();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(sendBexMessage).not.toHaveBeenCalledWith('nostr.requests.list');
    });
  });
});
