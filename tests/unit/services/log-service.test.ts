import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  logService,
  LogLevel,
  sanitizeLogMessage,
  MAX_APPROVAL_LOG_ENTRIES,
  MAX_EXCEPTION_LOG_ENTRIES,
  MAX_LOG_MESSAGE_LENGTH,
} from '@/services/log-service';
import { db } from '@/services/database';

// Mock the database. `count`, `limit`, `delete` and `clear` serve retention and clearing (#144).
vi.mock('@/services/database', () => {
  const table = () => ({
    add: vi.fn().mockResolvedValue(1),
    where: vi.fn().mockReturnThis(),
    equals: vi.fn().mockReturnThis(),
    reverse: vi.fn().mockReturnThis(),
    sortBy: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    delete: vi.fn().mockResolvedValue(0),
    toArray: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    clear: vi.fn().mockResolvedValue(undefined),
  });
  return { db: { exceptions: table(), approvals: table() } };
});

describe('LogService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('should log an exception to the database and console', async () => {
    await logService.logException('test error', 'acc1', 'host1');

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(db.exceptions.add).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'test error',
        account: 'acc1',
        hostname: 'host1',
        dateTime: expect.any(String),
      }),
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[ERROR] test error'), {
      account: 'acc1',
      hostname: 'host1',
    });
  });

  it('should log an approval to the database and console', async () => {
    await logService.logApproval(1, 'host1', 'acc1');

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(db.approvals.add).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: 1,
        hostname: 'host1',
        account: 'acc1',
        dateTime: expect.any(String),
        // Logged on the terminal transition now, so the row records what happened.
        outcome: 'unknown',
      }),
    );
    expect(console.debug).toHaveBeenCalledWith(
      expect.stringContaining('[DEBUG] Approval unknown for kind 1 on host1'),
      { account: 'acc1' },
    );
  });

  it('should log a general message to the console', () => {
    logService.log(LogLevel.WARN, 'warn msg', { key: 'val' });

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[WARN] warn msg'), {
      key: 'val',
    });
  });

  it('should wrap an async function with logging', async () => {
    const originalFn = vi.fn().mockResolvedValue('success result');
    const wrappedFn = logService.wrapWithLogging(originalFn, 'TestService', 'testMethod');

    const result = await wrappedFn('arg1');

    expect(originalFn).toHaveBeenCalledWith('arg1');
    expect(result).toBe('success result');
    expect(console.debug).toHaveBeenCalledWith(
      expect.stringContaining('Calling TestService.testMethod'),
      { argCount: 1 },
    );
    expect(console.debug).toHaveBeenCalledWith(
      expect.stringContaining('TestService.testMethod completed successfully'),
      { resultType: 'string' },
    );
  });

  it('should log and re-throw error when wrapped function fails', async () => {
    const error = new Error('fail');
    const originalFn = vi.fn().mockRejectedValue(error);
    const wrappedFn = logService.wrapWithLogging(originalFn, 'TestService', 'testMethod');

    await expect(wrappedFn('arg1')).rejects.toThrow('fail');

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('TestService.testMethod failed: fail'),
      undefined,
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(db.exceptions.add).toHaveBeenCalled();
  });

  describe('keeps secrets out of logs (#144, T11)', () => {
    const HEX_KEY = 'a'.repeat(64);
    const SIGNATURE = 'b'.repeat(128);
    const NSEC = 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5';
    const INVOICE = 'lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygs';
    const EVENT = '{"kind":4,"content":"meet at the usual place","pubkey":"x"}';
    const SECRETS = [HEX_KEY, SIGNATURE, NSEC, INVOICE, 'meet at the usual place'];

    const allLoggedText = (): string =>
      [
        ...vi.mocked(console.error).mock.calls,
        ...vi.mocked(console.warn).mock.calls,
        ...vi.mocked(console.debug).mock.calls,
        // eslint-disable-next-line @typescript-eslint/unbound-method
        ...vi.mocked(db.exceptions.add).mock.calls,
      ]
        .map((call) => JSON.stringify(call))
        .join('\n');

    it('redacts keys, signatures, invoices and serialised events from a message', () => {
      const safe = sanitizeLogMessage(
        `bad ${HEX_KEY} sig ${SIGNATURE} key ${NSEC} pay ${INVOICE} event ${EVENT}`,
      );
      for (const secret of SECRETS) expect(safe).not.toContain(secret);
      expect(safe).toContain('[hex]');
      expect(safe).toContain('[secret key]');
      expect(safe).toContain('[invoice]');
      expect(safe).toContain('[object]');
    });

    it('bounds a long message', () => {
      const safe = sanitizeLogMessage('x'.repeat(MAX_LOG_MESSAGE_LENGTH * 3));
      expect(safe.length).toBe(MAX_LOG_MESSAGE_LENGTH + 1);
      expect(safe.endsWith('…')).toBe(true);
    });

    it('leaves an ordinary message alone', () => {
      expect(sanitizeLogMessage('Vault is locked')).toBe('Vault is locked');
    });

    it('never persists or prints what a failing handler threw', async () => {
      const wrapped = logService.wrapWithLogging(
        () => Promise.reject(new Error(`signing failed for ${EVENT} with ${NSEC} ${HEX_KEY}`)),
        'TestService',
        'sign',
      );

      await expect(wrapped()).rejects.toThrow();
      await vi.waitFor(() => {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(db.exceptions.add).toHaveBeenCalled();
      });

      const logged = allLoggedText();
      for (const secret of SECRETS) expect(logged).not.toContain(secret);
      expect(logged).toContain('TestService.sign');
    });

    it('sanitises a message logged directly as an exception', async () => {
      await logService.logException(`unhandled: ${INVOICE}`);

      expect(allLoggedText()).not.toContain(INVOICE);
    });

    it('never logs the arguments a wrapped function was called with', async () => {
      const wrapped = logService.wrapWithLogging(
        (_password: string, _event: string) => Promise.resolve(true),
        'TestService',
        'unlock',
      );

      await wrapped('correct horse battery staple', EVENT);

      const logged = allLoggedText();
      expect(logged).not.toContain('correct horse battery staple');
      expect(logged).not.toContain('meet at the usual place');
    });
  });

  describe('bounds local history (#144, T28)', () => {
    it('deletes the oldest approvals beyond the cap', async () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      vi.mocked(db.approvals.count).mockResolvedValueOnce(MAX_APPROVAL_LOG_ENTRIES + 3);

      await logService.logApproval(1, 'example.com', 'main', 'approved');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(db.approvals.orderBy).toHaveBeenCalledWith('dateTime');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(db.approvals.limit).toHaveBeenCalledWith(3);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(db.approvals.delete).toHaveBeenCalled();
    });

    it('deletes the oldest exceptions beyond the cap', async () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      vi.mocked(db.exceptions.count).mockResolvedValueOnce(MAX_EXCEPTION_LOG_ENTRIES + 1);

      await logService.logException('boom');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(db.exceptions.limit).toHaveBeenCalledWith(1);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(db.exceptions.delete).toHaveBeenCalled();
    });

    it('deletes nothing at or under the cap', async () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      vi.mocked(db.approvals.count).mockResolvedValueOnce(MAX_APPROVAL_LOG_ENTRIES);

      await logService.logApproval(1, 'example.com', 'main', 'approved');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(db.approvals.delete).not.toHaveBeenCalled();
    });

    it('clears both tables for every account', async () => {
      await logService.clearHistory();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(db.approvals.clear).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(db.exceptions.clear).toHaveBeenCalled();
    });
  });
});
