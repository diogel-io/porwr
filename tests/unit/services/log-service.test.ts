import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  logService,
  LogLevel,
  describeError,
  MAX_APPROVAL_LOG_ENTRIES,
  MAX_EXCEPTION_LOG_ENTRIES,
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
  return {
    db: {
      exceptions: table(),
      approvals: table(),
      // Runs the body at once; Dexie's serialisation of read-write transactions is its own concern.
      transaction: vi.fn((...args: unknown[]) => (args.at(-1) as () => Promise<unknown>)()),
    },
  };
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
    await logService.logException('test error', undefined, 'acc1', 'host1');

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
      expect.stringContaining('TestService.testMethod failed: Error'),
      undefined,
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(db.exceptions.add).toHaveBeenCalled();
  });

  describe('keeps secrets out of logs (#144, T11)', () => {
    const NSEC = 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5';
    // Free-form plaintext no pattern could recognise: why the message itself is never kept.
    const PLAINTEXT = 'meet at the usual place at eight';
    const SECRETS = [NSEC, PLAINTEXT, 'a'.repeat(64)];

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

    it('describes an error by its class name and code, never its message', () => {
      const locked = Object.assign(new Error(`locked while decrypting ${PLAINTEXT}`), {
        code: 'VAULT_LOCKED',
      });

      expect(describeError(new TypeError(PLAINTEXT))).toBe('TypeError');
      expect(describeError(locked)).toBe('Error VAULT_LOCKED');
    });

    it('drops a code or name that could carry content', () => {
      const odd = Object.assign(new Error('x'), { name: PLAINTEXT, code: NSEC });

      expect(describeError(odd)).toBe('Error');
    });

    it('says nothing about a thrown value that is not an Error', () => {
      expect(describeError(PLAINTEXT)).toBe('non-Error value');
      expect(describeError({ content: PLAINTEXT })).toBe('non-Error value');
    });

    it('never persists or prints what a failing handler threw', async () => {
      const wrapped = logService.wrapWithLogging(
        () => Promise.reject(new Error(`decrypt failed for ${PLAINTEXT} with ${NSEC}`)),
        'TestService',
        'decrypt',
      );

      await expect(wrapped()).rejects.toThrow();
      await vi.waitFor(() => {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(db.exceptions.add).toHaveBeenCalled();
      });

      const logged = allLoggedText();
      for (const secret of SECRETS) expect(logged).not.toContain(secret);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(db.exceptions.add).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'TestService.decrypt failed: Error' }),
      );
    });

    it('keeps only the caller context and error class for an unhandled error', async () => {
      await logService.logException('Unhandled rejection', new Error(`${PLAINTEXT} ${NSEC}`));

      const logged = allLoggedText();
      for (const secret of SECRETS) expect(logged).not.toContain(secret);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(db.exceptions.add).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Unhandled rejection: Error' }),
      );
    });

    it('never logs the arguments a wrapped function was called with', async () => {
      const wrapped = logService.wrapWithLogging(
        (_password: string, _content: string) => Promise.resolve(true),
        'TestService',
        'unlock',
      );

      await wrapped('correct horse battery staple', PLAINTEXT);

      const logged = allLoggedText();
      expect(logged).not.toContain('correct horse battery staple');
      expect(logged).not.toContain(PLAINTEXT);
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
      expect(db.transaction).toHaveBeenCalledWith('rw', db.exceptions, expect.any(Function));

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

    it('adds and prunes in one read-write transaction, so concurrent writes cannot over-delete', async () => {
      await logService.logApproval(1, 'example.com', 'main', 'approved');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(db.transaction).toHaveBeenCalledWith('rw', db.approvals, expect.any(Function));
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const [transactionOrder] = vi.mocked(db.transaction).mock.invocationCallOrder;
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const [addOrder] = vi.mocked(db.approvals.add).mock.invocationCallOrder;
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const [countOrder] = vi.mocked(db.approvals.count).mock.invocationCallOrder;
      expect(transactionOrder).toBeLessThan(addOrder!);
      expect(addOrder).toBeLessThan(countOrder!);
    });

    it('bounds existing history on request, with no new record needed', async () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      vi.mocked(db.approvals.count).mockResolvedValueOnce(MAX_APPROVAL_LOG_ENTRIES + 40);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      vi.mocked(db.exceptions.count).mockResolvedValueOnce(MAX_EXCEPTION_LOG_ENTRIES + 7);

      await logService.enforceRetention();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(db.approvals.limit).toHaveBeenCalledWith(40);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(db.exceptions.limit).toHaveBeenCalledWith(7);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(db.approvals.add).not.toHaveBeenCalled();
    });

    it('enforces retention when the background starts', () => {
      const source = readFileSync(resolve(__dirname, '../../../src-bex/background.ts'), 'utf8');
      const initialize = /async function initialize\(\)[\s\S]*?\n\}/.exec(source)?.[0] ?? '';

      expect(initialize).toContain('logService.enforceRetention()');
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
