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

  describe('a call that signs, publishes, sends or pays and times out (#265)', () => {
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

    it('includes a DM relay check, which publishes test messages (#277)', async () => {
      const send = vi.fn(() => new Promise(() => {}));
      setBridge({ send });

      const result = sendBexMessage('messaging.dmRelays.check', { relays: [] });
      const assertion = expect(result).rejects.toBeInstanceOf(BackgroundTimeoutError);
      await vi.advanceTimersByTimeAsync(20_000);
      await assertion;

      expect(send).toHaveBeenCalledTimes(1);
    });

    // Importing an encrypted key adds an account: a repeat would fail as a duplicate after the
    // first had already succeeded (#141).
    it('includes importing an encrypted key', async () => {
      const send = vi.fn(() => new Promise(() => {}));
      setBridge({ send });

      const result = sendBexMessage('accounts.importEncrypted', {
        ncryptsec: 'ncryptsec1x',
        password: 'pw',
        alias: 'a',
      });
      const assertion = expect(result).rejects.toBeInstanceOf(BackgroundTimeoutError);
      await vi.advanceTimersByTimeAsync(120_000);
      await assertion;

      expect(send).toHaveBeenCalledTimes(1);
    });

    // NIP-49's scrypt can take many seconds; that is not a background that stopped answering.
    it('waits longer for a NIP-49 call before calling it timed out', async () => {
      let answer: (value: unknown) => void = () => undefined;
      const send = vi.fn(() => new Promise((resolve) => (answer = resolve)));
      setBridge({ send });

      const result = sendBexMessage('accounts.importEncrypted', {
        ncryptsec: 'ncryptsec1x',
        password: 'pw',
        alias: 'a',
      });
      await vi.advanceTimersByTimeAsync(30_000);
      answer({ id: 'a', alias: 'a', createdAt: '' });

      await expect(result).resolves.toEqual({ id: 'a', alias: 'a', createdAt: '' });
      expect(send).toHaveBeenCalledTimes(1);
    });

    // A wallet call waits on the wallet: reporting a payment as failed while the background goes on
    // to make it would invite a second payment (diogel-io/workspace#142).
    it('waits longer for a wallet call before calling it timed out', async () => {
      let answer: (value: unknown) => void = () => undefined;
      const send = vi.fn(() => new Promise((resolve) => (answer = resolve)));
      setBridge({ send });

      const result = sendBexMessage('nip47.payInvoice', {
        accountPubkey: 'a'.repeat(64),
        connectionId: 'wallet-a',
        invoice: 'lnbc1',
      });
      await vi.advanceTimersByTimeAsync(20_000);
      answer({ preimage: 'p', raw: {} });

      await expect(result).resolves.toEqual({ preimage: 'p', raw: {} });
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

  describe('a call that is safe to repeat and times out', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('is retried, as a slow read may answer the next time', async () => {
      const send = vi
        .fn()
        .mockImplementationOnce(() => new Promise(() => {}))
        .mockResolvedValueOnce({ data: { relays: [], updatedAt: null } });
      setBridge({ send });

      const result = sendBexMessage('messaging.dmRelays.get');
      await vi.advanceTimersByTimeAsync(5_100);

      await expect(result).resolves.toEqual({ relays: [], updatedAt: null });
      expect(send).toHaveBeenCalledTimes(2);
    });
  });
});
