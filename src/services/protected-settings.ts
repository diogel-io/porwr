import { db } from './database';

/**
 * Settings that decide what a site may do, kept where a content script cannot reach them.
 *
 * `chrome.storage.local` is open to Porwr's content scripts, which run inside every website's
 * renderer. A compromised renderer could have read the connected sites there, planted a grant, or
 * switched auto-lock off. These values now live in the extension's own IndexedDB, in the
 * `appSettings` table: that database belongs to the `chrome-extension://` origin, which no content
 * script or web page can open (#140, threat model T29).
 *
 * Only Porwr's background and its own pages use this. Values are returned as stored; every caller
 * validates what it reads, because storage is not trusted to hold the shape it expects.
 */

export {
  PROTECTED_AUTO_LOCK_MINUTES,
  PROTECTED_LAST_ACTIVITY,
  PROTECTED_PERMISSIONS,
  PROTECTED_SITE_BINDINGS,
} from './protected-settings-keys';
export type { ProtectedKey } from './protected-settings-keys';
import type { ProtectedKey } from './protected-settings-keys';

export async function getProtected<T>(key: ProtectedKey): Promise<T | undefined> {
  const row = await db.appSettings.get(key);
  return row?.value as T | undefined;
}

export async function setProtected(key: ProtectedKey, value: unknown): Promise<void> {
  await db.appSettings.put({ key, value, updatedAt: new Date().toISOString() });
}

export async function hasProtected(key: ProtectedKey): Promise<boolean> {
  return (await db.appSettings.get(key)) !== undefined;
}

export async function removeProtected(key: ProtectedKey): Promise<void> {
  await db.appSettings.delete(key);
}
