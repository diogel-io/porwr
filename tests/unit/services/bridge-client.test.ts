import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { BackgroundTimeoutError, sendBexMessage } from '@/services/bridge-client';

vi.mock('@/services/log-service', () => ({
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
  logService: { log: vi.fn() },
}));

const originalChrome = globalThis.chrome;

const setChrome = (value: unknown): void => {
  (globalThis as { chrome?: unknown }).chrome = value;
};

const setBridge = (bridge: unknown): void => {
  (window as unknown as { bridge?: unknown }).bridge = bridge;
};

describe('bridge client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setBridge(undefined);
    setChrome(undefined);
  });

  afterEach(() => {
    setBridge(undefined);
    setChrome(originalChrome);
  });

  it('unwraps a bridge envelope', async () => {
    setBridge({ send: vi.fn().mockResolvedValue({ data: true }) });

    await expect(sendBexMessage('vault.isUnlocked')).resolves.toBe(true);
  });

  it('retries a transient transport failure before surfacing an error', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('worker asleep'))
      .mockResolvedValueOnce({ data: true });
    setBridge({ send });

    await expect(sendBexMessage('vault.isUnlocked')).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('falls back to runtime messaging when no bridge is present', async () => {
    const sendMessage = vi.fn((_message: unknown, callback: (response: unknown) => void) => {
      callback(true);
    });
    setChrome({ runtime: { sendMessage, lastError: undefined } });

    await expect(sendBexMessage('vault.isUnlocked')).resolves.toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('throws once every attempt fails', async () => {
    const send = vi.fn().mockRejectedValue(new Error('channel gone'));
    setBridge({ send });

    await expect(sendBexMessage('vault.isUnlocked')).rejects.toThrow();
    // One initial attempt plus the configured retries.
    expect(send).toHaveBeenCalledTimes(3);
  });

  describe('a call the background does not answer in time (#265)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('is not retried, since the background may have handled it', async () => {
      const send = vi.fn(() => new Promise(() => {}));
      setBridge({ send });

      const result = sendBexMessage('messaging.dmRelays.publish', { relays: [] });
      const assertion = expect(result).rejects.toBeInstanceOf(BackgroundTimeoutError);
      await vi.advanceTimersByTimeAsync(20_000);
      await assertion;

      expect(send).toHaveBeenCalledTimes(1);
    });

    it('is not sent again through runtime messaging', async () => {
      const send = vi.fn(() => new Promise(() => {}));
      const sendMessage = vi.fn();
      setBridge({ send });
      setChrome({ runtime: { sendMessage, lastError: undefined } });

      const result = sendBexMessage('messaging.dmRelays.publish', { relays: [] });
      const assertion = expect(result).rejects.toThrow('Bridge timeout');
      await vi.advanceTimersByTimeAsync(20_000);
      await assertion;

      expect(send).toHaveBeenCalledTimes(1);
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('is not retried over runtime messaging either', async () => {
      const sendMessage = vi.fn();
      setChrome({ runtime: { sendMessage, lastError: undefined } });

      const result = sendBexMessage('messaging.dmRelays.publish', { relays: [] });
      const assertion = expect(result).rejects.toBeInstanceOf(BackgroundTimeoutError);
      await vi.advanceTimersByTimeAsync(20_000);
      await assertion;

      expect(sendMessage).toHaveBeenCalledTimes(1);
    });
  });
});
