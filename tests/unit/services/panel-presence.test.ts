import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requeuePresented } = vi.hoisted(() => ({ requeuePresented: vi.fn(async () => undefined) }));

vi.mock('@/../src-bex/services/request-queue', () => ({ requeuePresented }));
vi.mock('@/../src-bex/services/panel-surface', () => ({ resolvePanelSurface: vi.fn() }));
vi.mock('@/services/log-service', () => ({
  LogLevel: { ERROR: 'error' },
  logService: { log: vi.fn() },
}));

import {
  PANEL_PORT_NAME,
  __resetPanelPresenceForTests,
  getPanelCount,
  isPanelPresent,
  observePanelConnections,
  notifyPanelsOfQueueChange,
  onPanelPresenceChange,
  reconcilePanelPresence,
} from '@/../src-bex/services/panel-presence';
import { resolvePanelSurface } from '@/../src-bex/services/panel-surface';

type Connect = (port: chrome.runtime.Port) => void;

const addListener = vi.fn();

const openPort = (
  connect: Connect,
  over: Partial<chrome.runtime.Port> = {},
): { port: chrome.runtime.Port; disconnect: () => void } => {
  const handlers: Array<() => void> = [];
  const port = {
    name: PANEL_PORT_NAME,
    onDisconnect: { addListener: (fn: () => void) => handlers.push(fn) },
    ...over,
  } as unknown as chrome.runtime.Port;

  connect(port);
  return { port, disconnect: () => handlers.forEach((fn) => fn()) };
};

const startObserving = (): Connect => {
  observePanelConnections();
  return addListener.mock.calls.at(-1)?.[0] as Connect;
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetPanelPresenceForTests();
  vi.stubGlobal('chrome', { runtime: { onConnect: { addListener } } });
});

describe('panel presence', () => {
  it('counts a connected panel as present', () => {
    const connect = startObserving();

    expect(isPanelPresent()).toBe(false);
    openPort(connect);
    expect(isPanelPresent()).toBe(true);
  });

  it('ignores ports that are not the panel', () => {
    const connect = startObserving();

    openPort(connect, { name: 'something-else' });

    expect(isPanelPresent()).toBe(false);
  });

  it('counts the panel even when it is running in a tab, as it does in development (#142)', () => {
    const connect = startObserving();

    openPort(connect, { sender: { tab: { id: 1 } } as chrome.runtime.MessageSender });

    expect(isPanelPresent()).toBe(true);
  });

  it('counts each window separately, since every window has its own panel (D2)', () => {
    const connect = startObserving();

    openPort(connect);
    openPort(connect);

    expect(getPanelCount()).toBe(2);
  });

  describe('when a panel goes away', () => {
    it('requeues the presented request only once the last one has gone', () => {
      const connect = startObserving();
      const first = openPort(connect);
      const second = openPort(connect);

      first.disconnect();
      expect(requeuePresented).not.toHaveBeenCalled();
      expect(isPanelPresent()).toBe(true);

      second.disconnect();
      // Closing the panel is never a decision (FR-6): the request goes back to the queue.
      expect(requeuePresented).toHaveBeenCalledTimes(1);
      expect(isPanelPresent()).toBe(false);
    });

    it('ignores a repeated disconnect for the same port', () => {
      const connect = startObserving();
      const panel = openPort(connect);

      panel.disconnect();
      panel.disconnect();

      expect(requeuePresented).toHaveBeenCalledTimes(1);
    });
  });

  it('reports presence changes to listeners', () => {
    const seen: boolean[] = [];
    onPanelPresenceChange((present) => seen.push(present));

    const connect = startObserving();
    const panel = openPort(connect);
    panel.disconnect();

    expect(seen).toEqual([true, false]);
  });
});

/**
 * Queue notifications (#140).
 *
 * The panel used to poll every second. The background now says "the queue moved" over the same
 * connection presence already uses, and the panel re-reads.
 */
describe('telling panels the queue moved', () => {
  const postMessage = vi.fn();

  const openMessagePort = (connect: Connect, over: Partial<chrome.runtime.Port> = {}) => {
    const handlers: Array<() => void> = [];
    const port = {
      name: PANEL_PORT_NAME,
      postMessage,
      onDisconnect: { addListener: (fn: () => void) => handlers.push(fn) },
      ...over,
    } as unknown as chrome.runtime.Port;
    connect(port);
    return { port, disconnect: () => handlers.forEach((fn) => fn()) };
  };

  it('notifies every open panel', () => {
    const connect = startObserving();
    openMessagePort(connect);
    openMessagePort(connect);

    notifyPanelsOfQueueChange();

    expect(postMessage).toHaveBeenCalledTimes(2);
  });

  it('carries no state, only that the queue moved', () => {
    const connect = startObserving();
    openMessagePort(connect);

    notifyPanelsOfQueueChange();

    // A payload could arrive behind a decision already applied, which is how a panel ends up
    // showing a resolved request as actionable.
    expect(postMessage).toHaveBeenCalledWith({ type: 'queue-changed' });
  });

  it('does not notify a panel that has gone', () => {
    const connect = startObserving();
    const panel = openMessagePort(connect);
    panel.disconnect();

    notifyPanelsOfQueueChange();

    expect(postMessage).not.toHaveBeenCalled();
  });

  it('survives a port that is closing but not yet disconnected', () => {
    const connect = startObserving();
    openMessagePort(connect, {
      postMessage: vi.fn(() => {
        throw new Error('Attempting to use a disconnected port object');
      }),
    } as unknown as Partial<chrome.runtime.Port>);

    expect(() => notifyPanelsOfQueueChange()).not.toThrow();
  });
});

/**
 * Cross-checking the port against the browser (#113).
 *
 * The port is the source of truth because it is the only mechanism both browsers support. Firefox
 * can additionally say whether a panel is open; Chromium cannot. This catches a panel that went away
 * without its `onDisconnect` firing, which would otherwise leave a request presented to nobody.
 */
describe('reconciling presence with the browser', () => {
  const isOpenAccordingToBrowser = vi.fn();

  const withSurface = (): void => {
    vi.mocked(resolvePanelSurface).mockReturnValue({
      kind: 'firefox',
      isOpenAccordingToBrowser,
      configureToolbarBehaviour: vi.fn(),
      openFromUserGesture: vi.fn(),
    } as unknown as ReturnType<typeof resolvePanelSurface>);
  };

  beforeEach(() => {
    withSurface();
  });

  it('drops ports the browser says are not there', async () => {
    const connect = startObserving();
    openPort(connect);
    isOpenAccordingToBrowser.mockResolvedValue(false);

    await reconcilePanelPresence(1);

    expect(isPanelPresent()).toBe(false);
    // The normal teardown path runs, so whatever was presented goes back to the queue.
    expect(requeuePresented).toHaveBeenCalledTimes(1);
  });

  it('leaves presence alone when the browser says the panel is open', async () => {
    const connect = startObserving();
    openPort(connect);
    isOpenAccordingToBrowser.mockResolvedValue(true);

    await reconcilePanelPresence(1);

    expect(isPanelPresent()).toBe(true);
    expect(requeuePresented).not.toHaveBeenCalled();
  });

  it('treats no answer as no opinion, never as closed', async () => {
    const connect = startObserving();
    openPort(connect);
    // Chromium abstains. Acting on that would tear down a live panel on the browser where most
    // people run this.
    isOpenAccordingToBrowser.mockResolvedValue(undefined);

    await reconcilePanelPresence(1);

    expect(isPanelPresent()).toBe(true);
    expect(requeuePresented).not.toHaveBeenCalled();
  });

  it('does not ask the browser when no port is held', async () => {
    await reconcilePanelPresence(1);

    expect(isOpenAccordingToBrowser).not.toHaveBeenCalled();
  });
});
