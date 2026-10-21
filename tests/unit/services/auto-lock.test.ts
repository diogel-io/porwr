import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Auto-lock state is kept in the protected store (#140); spies stand in for it.
vi.mock('@/services/protected-settings', () => ({
  getProtected: vi.fn(),
  setProtected: vi.fn(),
  PROTECTED_AUTO_LOCK_MINUTES: 'protected:auto-lock-minutes',
  PROTECTED_LAST_ACTIVITY: 'protected:last-activity',
}));

vi.mock('@/../src-bex/vault', () => ({
  isVaultUnlocked: vi.fn(),
  lockVault: vi.fn(),
}));

import { getProtected, PROTECTED_LAST_ACTIVITY, setProtected } from '@/services/protected-settings';
import { isVaultUnlocked, lockVault } from '@/../src-bex/vault';
import {
  checkAutoLock,
  isAutoLockOverdue,
  resetAutoLockTimer,
  restoreLastActivity,
  updateLastActivity,
} from '@/../src-bex/services/auto-lock';

describe('auto-lock service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('persists last activity when updated directly', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T12:00:00.000Z'));

    await updateLastActivity();

    expect(setProtected).toHaveBeenCalledWith(
      PROTECTED_LAST_ACTIVITY,
      new Date('2026-04-17T12:00:00.000Z').getTime(),
    );
  });

  it('persists last activity when resetting the auto-lock timer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T12:05:00.000Z'));

    await resetAutoLockTimer();

    expect(setProtected).toHaveBeenCalledWith(
      PROTECTED_LAST_ACTIVITY,
      new Date('2026-04-17T12:05:00.000Z').getTime(),
    );
  });

  describe('isAutoLockOverdue (#139)', () => {
    const stored = (lastActivity: number, minutes: number | undefined) =>
      vi.mocked(getProtected).mockImplementation(async (key: string) => {
        if (key === 'protected:last-activity') return lastActivity;
        if (key === 'protected:auto-lock-minutes') return minutes;
        return undefined;
      });
    const NOW = new Date('2026-04-17T12:30:00.000Z').getTime();

    it('is overdue once the restored idle time reaches the timeout', async () => {
      stored(NOW - 15 * 60 * 1000, 15);
      await restoreLastActivity();

      await expect(isAutoLockOverdue(NOW)).resolves.toBe(true);
    });

    it('is not overdue before the timeout', async () => {
      stored(NOW - 5 * 60 * 1000, 15);
      await restoreLastActivity();

      await expect(isAutoLockOverdue(NOW)).resolves.toBe(false);
    });

    it('is never overdue with auto-lock turned off', async () => {
      stored(NOW - 24 * 60 * 60 * 1000, 0);
      await restoreLastActivity();

      await expect(isAutoLockOverdue(NOW)).resolves.toBe(false);
    });

    // `background.ts` cannot be imported, so this reads its source, as other boundary tests do.
    it('is what the background asks before restoring the unlocked key', () => {
      const source = readFileSync(resolve(__dirname, '../../../src-bex/background.ts'), 'utf8');

      expect(source).toContain('restoreVaultState(isAutoLockOverdue)');
    });
  });

  // A last-activity time in the future would postpone locking indefinitely (#140).
  it('treats a last-activity time in the future as now', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-04-17T12:30:00.000Z').getTime();
    vi.setSystemTime(now);
    vi.mocked(getProtected).mockImplementation(async (key: string) => {
      if (key === 'protected:last-activity') return now + 365 * 24 * 60 * 60 * 1000;
      if (key === 'protected:auto-lock-minutes') return 15;
      return undefined;
    });

    await restoreLastActivity();

    await expect(isAutoLockOverdue(now + 15 * 60 * 1000)).resolves.toBe(true);
  });

  it('caps a stored timeout at a day', async () => {
    const now = Date.now();
    vi.mocked(getProtected).mockImplementation(async (key: string) => {
      if (key === 'protected:last-activity') return now - 25 * 60 * 60 * 1000;
      if (key === 'protected:auto-lock-minutes') return 1_000_000;
      return undefined;
    });

    await restoreLastActivity();

    await expect(isAutoLockOverdue(now)).resolves.toBe(true);
  });

  it('restores last activity from storage before checking idle timeout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T12:30:00.000Z'));
    vi.mocked(getProtected).mockImplementation(async (key: string) => {
      if (key === 'protected:last-activity') {
        return new Date('2026-04-17T12:25:00.000Z').getTime();
      }
      if (key === 'protected:auto-lock-minutes') {
        return 15;
      }
      return undefined;
    });
    vi.mocked(isVaultUnlocked).mockReturnValue(true);

    await restoreLastActivity();
    await checkAutoLock();

    expect(lockVault).not.toHaveBeenCalled();
  });

  it('locks the vault when restored inactivity exceeds the limit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T12:30:00.000Z'));
    vi.mocked(getProtected).mockImplementation(async (key: string) => {
      if (key === 'protected:last-activity') {
        return new Date('2026-04-17T12:00:00.000Z').getTime();
      }
      if (key === 'protected:auto-lock-minutes') {
        return 15;
      }
      return undefined;
    });
    vi.mocked(isVaultUnlocked).mockReturnValue(true);

    await restoreLastActivity();
    await checkAutoLock();

    expect(lockVault).toHaveBeenCalled();
  });
});
