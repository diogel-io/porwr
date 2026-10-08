import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/storage-service', () => ({
  storageService: {
    get: vi.fn(),
    set: vi.fn(),
  },
  VAULT_AUTO_LOCK_MINUTES: 'vault:auto-lock-minutes',
  VAULT_LAST_ACTIVITY: 'vault:last-activity',
}));

vi.mock('@/../src-bex/vault', () => ({
  isVaultUnlocked: vi.fn(),
  lockVault: vi.fn(),
}));

import { storageService, VAULT_LAST_ACTIVITY } from '@/services/storage-service';
import { isVaultUnlocked, lockVault } from '@/../src-bex/vault';
import {
  checkAutoLock,
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

    expect(storageService.set).toHaveBeenCalledWith(
      VAULT_LAST_ACTIVITY,
      new Date('2026-04-17T12:00:00.000Z').getTime(),
    );
  });

  it('persists last activity when resetting the auto-lock timer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T12:05:00.000Z'));

    await resetAutoLockTimer();

    expect(storageService.set).toHaveBeenCalledWith(
      VAULT_LAST_ACTIVITY,
      new Date('2026-04-17T12:05:00.000Z').getTime(),
    );
  });

  it('restores last activity from storage before checking idle timeout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T12:30:00.000Z'));
    vi.mocked(storageService.get).mockImplementation(async (key: string) => {
      if (key === 'vault:last-activity') {
        return new Date('2026-04-17T12:25:00.000Z').getTime();
      }
      if (key === 'vault:auto-lock-minutes') {
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
    vi.mocked(storageService.get).mockImplementation(async (key: string) => {
      if (key === 'vault:last-activity') {
        return new Date('2026-04-17T12:00:00.000Z').getTime();
      }
      if (key === 'vault:auto-lock-minutes') {
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
