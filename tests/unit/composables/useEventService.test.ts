import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools';

const { subscribeManyMock, closeMock } = vi.hoisted(() => ({
  subscribeManyMock: vi.fn(),
  closeMock: vi.fn(),
}));

vi.mock('nostr-tools', () => ({
  SimplePool: class {
    subscribeMany = subscribeManyMock;
    close = closeMock;
  },
}));

function buildEvent(id: string): Event {
  return { id, kind: 0, pubkey: 'pk', created_at: 0, tags: [], content: '', sig: 'sig' };
}

describe('useEventService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('resolves with the deduplicated events collected before EOSE', async () => {
    const subClose = vi.fn();
    let handlers!: { onevent: (event: Event) => void; oneose: () => void };
    subscribeManyMock.mockImplementation((_relays, _filter, h) => {
      handlers = h;
      return { close: subClose };
    });

    const { useEventService } = await import('@/composables/useEventService');
    const service = useEventService(['wss://relay.damus.io']);

    const resultPromise = service.getEvents({ kinds: [0] });
    handlers.onevent(buildEvent('a'));
    handlers.onevent(buildEvent('a')); // duplicate id, should not double up
    handlers.onevent(buildEvent('b'));
    handlers.oneose();

    const result = await resultPromise;
    expect(result.map((e) => e.id).sort()).toEqual(['a', 'b']);
    expect(subClose).toHaveBeenCalledTimes(1);
  });

  it('resolves with whatever was collected so far when the timeout elapses first', async () => {
    const subClose = vi.fn();
    let handlers!: { onevent: (event: Event) => void; oneose: () => void };
    subscribeManyMock.mockImplementation((_relays, _filter, h) => {
      handlers = h;
      return { close: subClose };
    });

    const { useEventService } = await import('@/composables/useEventService');
    const service = useEventService(['wss://relay.damus.io']);

    const resultPromise = service.getEvents({ kinds: [0] }, 1000);
    handlers.onevent(buildEvent('a'));
    await vi.advanceTimersByTimeAsync(1000);

    const result = await resultPromise;
    expect(result.map((e) => e.id)).toEqual(['a']);
    expect(subClose).toHaveBeenCalledTimes(1);
  });

  it('does not resolve twice when both EOSE and the timeout fire', async () => {
    const subClose = vi.fn();
    let handlers!: { onevent: (event: Event) => void; oneose: () => void };
    subscribeManyMock.mockImplementation((_relays, _filter, h) => {
      handlers = h;
      return { close: subClose };
    });

    const { useEventService } = await import('@/composables/useEventService');
    const service = useEventService(['wss://relay.damus.io']);

    const resultPromise = service.getEvents({ kinds: [0] }, 1000);
    handlers.oneose();
    await vi.advanceTimersByTimeAsync(1000);

    await resultPromise;
    expect(subClose).toHaveBeenCalledTimes(1);
  });

  it('closes the pool for the configured relay URLs', async () => {
    const { useEventService } = await import('@/composables/useEventService');
    const service = useEventService(['wss://relay.damus.io', 'wss://relay.snort.social']);

    service.close();

    expect(closeMock).toHaveBeenCalledWith(['wss://relay.damus.io', 'wss://relay.snort.social']);
  });
});
