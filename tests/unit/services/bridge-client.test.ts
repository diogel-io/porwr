import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { sendBexMessage } from '@/services/bridge-client';

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
});
