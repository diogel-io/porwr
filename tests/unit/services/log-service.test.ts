import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logService, LogLevel } from '@/services/log-service';
import { db } from '@/services/database';

// Mock the database
vi.mock('@/services/database', () => ({
  db: {
    exceptions: {
      add: vi.fn().mockResolvedValue(1),
      where: vi.fn().mockReturnThis(),
      equals: vi.fn().mockReturnThis(),
      reverse: vi.fn().mockReturnThis(),
      sortBy: vi.fn().mockResolvedValue([]),
      orderBy: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    },
    approvals: {
      add: vi.fn().mockResolvedValue(1),
      where: vi.fn().mockReturnThis(),
      equals: vi.fn().mockReturnThis(),
      reverse: vi.fn().mockReturnThis(),
      sortBy: vi.fn().mockResolvedValue([]),
      orderBy: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    },
  },
}));

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
      })
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[ERROR] test error'),
      { account: 'acc1', hostname: 'host1' }
    );
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
      })
    );
    expect(console.debug).toHaveBeenCalledWith(
      expect.stringContaining('[DEBUG] Approval unknown for kind 1 on host1'),
      { account: 'acc1' }
    );
  });

  it('should log a general message to the console', () => {
    logService.log(LogLevel.WARN, 'warn msg', { key: 'val' });

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[WARN] warn msg'),
      { key: 'val' }
    );
  });

  it('should wrap an async function with logging', async () => {
    const originalFn = vi.fn().mockResolvedValue('success result');
    const wrappedFn = logService.wrapWithLogging(originalFn, 'TestService', 'testMethod');

    const result = await wrappedFn('arg1');

    expect(originalFn).toHaveBeenCalledWith('arg1');
    expect(result).toBe('success result');
    expect(console.debug).toHaveBeenCalledWith(
      expect.stringContaining('Calling TestService.testMethod'),
      { argCount: 1 }
    );
    expect(console.debug).toHaveBeenCalledWith(
      expect.stringContaining('TestService.testMethod completed successfully'),
      { resultType: 'string' }
    );
  });

  it('should log and re-throw error when wrapped function fails', async () => {
    const error = new Error('fail');
    const originalFn = vi.fn().mockRejectedValue(error);
    const wrappedFn = logService.wrapWithLogging(originalFn, 'TestService', 'testMethod');

    await expect(wrappedFn('arg1')).rejects.toThrow('fail');

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('TestService.testMethod failed: fail'),
      undefined
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(db.exceptions.add).toHaveBeenCalled();
  });
});
