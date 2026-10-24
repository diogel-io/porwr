import {
  PERMISSIONS_KEY,
  SITE_BINDINGS_KEY,
  storageService,
  VAULT_AUTO_LOCK_MINUTES,
  VAULT_LAST_ACTIVITY,
} from '@/services/storage-service';
import {
  hasProtected,
  PROTECTED_AUTO_LOCK_MINUTES,
  PROTECTED_LAST_ACTIVITY,
  PROTECTED_PERMISSIONS,
  PROTECTED_SITE_BINDINGS,
  setProtected,
  type ProtectedKey,
} from '@/services/protected-settings';

import { clearPermissionCache } from '../handlers/permission-handler';
import { clearSiteBindingCache } from './site-binding-store';

/** Each key that used to live in content-script-readable storage, and where it lives now. */
export const MOVED_KEYS: ReadonlyArray<readonly [string, ProtectedKey]> = [
  [PERMISSIONS_KEY, PROTECTED_PERMISSIONS],
  [SITE_BINDINGS_KEY, PROTECTED_SITE_BINDINGS],
  [VAULT_AUTO_LOCK_MINUTES, PROTECTED_AUTO_LOCK_MINUTES],
  [VAULT_LAST_ACTIVITY, PROTECTED_LAST_ACTIVITY],
];

/**
 * Move grants, bindings and auto-lock state out of `chrome.storage.local` (#140).
 *
 * Run at background start, before anything reads them. A value is copied only when the protected
 * store has none, so a page that writes the old key later can never overwrite the real one. The old
 * keys are then deleted every time, so nothing left there, or planted there, is read again.
 *
 * Copied values are not trusted: each owner validates what it reads, so a planted grant that breaks
 * the rules is dropped on load (`migrateGrants`), and the auto-lock values are clamped.
 */
export async function migrateProtectedStorage(): Promise<number> {
  const legacy = await storageService.getMultiple(MOVED_KEYS.map(([oldKey]) => oldKey));
  let copied = 0;

  for (const [oldKey, newKey] of MOVED_KEYS) {
    if (legacy[oldKey] === undefined || (await hasProtected(newKey))) continue;
    await setProtected(newKey, legacy[oldKey]);
    copied += 1;
  }

  await storageService.remove(MOVED_KEYS.map(([oldKey]) => oldKey));

  // A request can arrive before this runs (page handlers are registered at load) and cache an
  // empty list. Clearing the caches makes the next read see what was migrated. If a grant was
  // written in that window, it won and the migrated grants were not copied: the user is asked
  // again, which is the safe direction.
  if (copied > 0) {
    clearPermissionCache();
    clearSiteBindingCache();
  }
  return copied;
}
