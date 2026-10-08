import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/services/log-service', () => ({
  LogLevel: { DEBUG: 'debug' },
  logService: { log: vi.fn() },
}));

import { PANEL_PORT_NAME, connectPanelPort } from '@/services/panel-port';

const connect = vi.fn();
const disconnect = vi.fn();

const makePort = () => {
  const handlers: Array<() => void> = [];
  const messageHandlers: Array<(message: unknown) => void> = [];
  return {
    port: {
      name: PANEL_PORT_NAME,
      disconnect,
      onDisconnect: { addListener: (fn: () => void) => handlers.push(fn) },
      onMessage: { addListener: (fn: (message: unknown) => void) => messageHandlers.push(fn) },
    },
    drop: () => handlers.forEach((fn) => fn()),
    send: (message: unknown) => messageHandlers.forEach((fn) => fn(message)),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal('chrome', { runtime: { connect } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('panel presence port', () => {
  it('opens one named connection', () => {
    connect.mockReturnValue(makePort().port);

    connectPanelPort();

    expect(connect).toHaveBeenCalledWith({ name: PANEL_PORT_NAME });
  });

  it('reconnects when the worker suspends underneath it', () => {
    const first = makePort();
    connect.mockReturnValueOnce(first.port).mockReturnValue(makePort().port);
    const onReconnect = vi.fn();

    connectPanelPort({ onReconnect });
    expect(onReconnect).not.toHaveBeenCalled();

    // A suspended service worker drops the port without the panel having gone anywhere.
    first.drop();
    vi.advanceTimersByTime(500);

    expect(connect).toHaveBeenCalledTimes(2);
    // The worker may have reconciled the queue while it was away, so the caller must re-read.
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('stops reconnecting once the panel disconnects deliberately', () => {
    const first = makePort();
    connect.mockReturnValue(first.port);

    const handle = connectPanelPort();
    handle.disconnect();

    expect(disconnect).toHaveBeenCalledTimes(1);

    first.drop();
    vi.advanceTimersByTime(2000);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('retries when the connection cannot be opened at all', () => {
    connect.mockImplementationOnce(() => {
      throw new Error('receiving end does not exist');
    });
    connect.mockReturnValue(makePort().port);

    connectPanelPort();
    expect(connect).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  describe('queue notifications (#140)', () => {
    it('tells the caller to re-read when the background says the queue moved', () => {
      const first = makePort();
      connect.mockReturnValue(first.port);
      const onQueueChanged = vi.fn();

      connectPanelPort({ onQueueChanged });
      first.send({ type: 'queue-changed' });

      expect(onQueueChanged).toHaveBeenCalledTimes(1);
    });

    it('ignores a message it does not recognise', () => {
      const first = makePort();
      connect.mockReturnValue(first.port);
      const onQueueChanged = vi.fn();

      connectPanelPort({ onQueueChanged });
      // From a newer background than this panel. Ignoring beats guessing.
      first.send({ type: 'something-else' });
      first.send(null);
      first.send('queue-changed');

      expect(onQueueChanged).not.toHaveBeenCalled();
    });

    it('keeps notifying after a reconnect', () => {
      const first = makePort();
      const second = makePort();
      connect.mockReturnValueOnce(first.port).mockReturnValue(second.port);
      const onQueueChanged = vi.fn();

      connectPanelPort({ onQueueChanged });
      first.drop();
      vi.advanceTimersByTime(500);

      second.send({ type: 'queue-changed' });
      expect(onQueueChanged).toHaveBeenCalledTimes(1);
    });
  });

  it('gives up quietly where there is no extension API to connect to', () => {
    vi.stubGlobal('chrome', undefined);

    expect(() => connectPanelPort()).not.toThrow();

    vi.advanceTimersByTime(5000);
    expect(connect).not.toHaveBeenCalled();
  });
});
