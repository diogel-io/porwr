import { describe, it, expect, vi, beforeEach } from 'vitest';

// The real module, over a stand-in for the `appSettings` table.
vi.unmock('@/services/protected-settings');

const rows = vi.hoisted(
  () => new Map<string, { key: string; value: unknown; updatedAt: string }>(),
);

vi.mock('@/services/database', () => ({
  db: {
    appSettings: {
      get: vi.fn((key: string) => Promise.resolve(rows.get(key))),
      put: vi.fn((row: { key: string; value: unknown; updatedAt: string }) => {
        rows.set(row.key, row);
        return Promise.resolve(row.key);
      }),
      delete: vi.fn((key: string) => {
        rows.delete(key);
        return Promise.resolve();
      }),
    },
  },
}));

import {
  getProtected,
  hasProtected,
  PROTECTED_PERMISSIONS,
  removeProtected,
  setProtected,
} from '@/services/protected-settings';

/** Kept in the extension's own IndexedDB, which content scripts cannot open (#140). */
describe('the protected settings store', () => {
  beforeEach(() => rows.clear());

  it('reads back what it wrote, in the appSettings table', async () => {
    await setProtected(PROTECTED_PERMISSIONS, [{ origin: 'https://example.com' }]);

    await expect(getProtected(PROTECTED_PERMISSIONS)).resolves.toEqual([
      { origin: 'https://example.com' },
    ]);
    expect(rows.get(PROTECTED_PERMISSIONS)?.updatedAt).toEqual(expect.any(String));
  });

  it('tells a missing value from a stored one, and removes it', async () => {
    await expect(hasProtected(PROTECTED_PERMISSIONS)).resolves.toBe(false);
    await setProtected(PROTECTED_PERMISSIONS, []);
    await expect(hasProtected(PROTECTED_PERMISSIONS)).resolves.toBe(true);

    await removeProtected(PROTECTED_PERMISSIONS);
    await expect(getProtected(PROTECTED_PERMISSIONS)).resolves.toBeUndefined();
  });
});
