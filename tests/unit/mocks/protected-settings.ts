/**
 * An in-memory stand-in for `src/services/protected-settings.ts`, installed for every unit test by
 * `tests/setup.ts`. The real module reads the extension's IndexedDB, which the test environment
 * does not have. Tests seed and inspect values through `protectedStore`.
 */
export {
  PROTECTED_AUTO_LOCK_MINUTES,
  PROTECTED_LAST_ACTIVITY,
  PROTECTED_LOAD_REMOTE_IMAGES,
  PROTECTED_PERMISSIONS,
  PROTECTED_SITE_BINDINGS,
} from '@/services/protected-settings-keys';
export type { ProtectedKey } from '@/services/protected-settings-keys';

export const protectedStore = new Map<string, unknown>();

export async function getProtected<T>(key: string): Promise<T | undefined> {
  return Promise.resolve(structuredClone(protectedStore.get(key)) as T | undefined);
}

export async function setProtected(key: string, value: unknown): Promise<void> {
  protectedStore.set(key, structuredClone(value));
  return Promise.resolve();
}

export async function hasProtected(key: string): Promise<boolean> {
  return Promise.resolve(protectedStore.has(key));
}

export async function removeProtected(key: string): Promise<void> {
  protectedStore.delete(key);
  return Promise.resolve();
}
