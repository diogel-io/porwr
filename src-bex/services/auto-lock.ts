/**
 * Auto-lock timer service
 * Manages automatic vault locking after inactivity
 */

import {
  storageService,
  VAULT_AUTO_LOCK_MINUTES,
  VAULT_LAST_ACTIVITY,
} from '@/services/storage-service';
import { LogLevel, logService } from '@/services/log-service';
import { lockVault } from '../vault';

let autoLockTimer: ReturnType<typeof setInterval> | null = null;
let lastActivityAt = Date.now();

const AUTO_LOCK_DEFAULT_MINUTES = 15;
const AUTO_LOCK_CHECK_INTERVAL_MS = 15000;

async function persistLastActivity(timestamp: number): Promise<void> {
  lastActivityAt = timestamp;
  await storageService.set(VAULT_LAST_ACTIVITY, timestamp);
}

export async function updateLastActivity(): Promise<void> {
  await persistLastActivity(Date.now());
}

export async function checkAutoLock(): Promise<void> {
  const { isVaultUnlocked } = await import('../vault');

  if (!isVaultUnlocked()) {
    stopAutoLockTimer();
    return;
  }

  const minutes = Number(
    (await storageService.get<number>(VAULT_AUTO_LOCK_MINUTES)) ?? AUTO_LOCK_DEFAULT_MINUTES,
  );

  if (minutes <= 0) {
    return;
  }

  const idleMs = Date.now() - lastActivityAt;
  const maxIdleMs = minutes * 60 * 1000;

  if (idleMs >= maxIdleMs) {
    logService.log(LogLevel.WARN, `[AutoLock] Auto-locking vault after ${minutes} minutes`);
    await lockVault();
    stopAutoLockTimer();
  }
}

export function startAutoLockTimer(): void {
  if (autoLockTimer) return;
  logService.log(LogLevel.DEBUG, '[AutoLock] Starting timer');
  autoLockTimer = setInterval(() => {
    void checkAutoLock();
  }, AUTO_LOCK_CHECK_INTERVAL_MS);
}

export function stopAutoLockTimer(): void {
  if (autoLockTimer) {
    clearInterval(autoLockTimer);
    autoLockTimer = null;
  }
}

export async function resetAutoLockTimer(): Promise<void> {
  await persistLastActivity(Date.now());
  if (autoLockTimer) {
    stopAutoLockTimer();
    startAutoLockTimer();
  }
}

export function isAutoLockEnabled(): boolean {
  return autoLockTimer !== null;
}

export async function restoreLastActivity(): Promise<void> {
  const activity = await storageService.get<number>(VAULT_LAST_ACTIVITY);
  if (activity) {
    lastActivityAt = Number(activity);
  }
}
