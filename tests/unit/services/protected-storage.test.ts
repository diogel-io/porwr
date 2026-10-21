import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const local = vi.hoisted(() => new Map<string, unknown>());

vi.mock('@/services/storage-service', async () => {
  const actual = await vi.importActual<typeof import('@/services/storage-service')>(
    '@/services/storage-service',
  );
  return {
    ...actual,
    storageService: {
      getMultiple: vi.fn((keys: string[]) =>
        Promise.resolve(
          Object.fromEntries(keys.filter((k) => local.has(k)).map((k) => [k, local.get(k)])),
        ),
      ),
      remove: vi.fn((keys: string | string[]) => {
        for (const key of [keys].flat()) local.delete(key);
        return Promise.resolve();
      }),
    },
  };
});

vi.mock('@/../src-bex/handlers/permission-handler', () => ({ clearPermissionCache: vi.fn() }));
vi.mock('@/../src-bex/services/site-binding-store', () => ({ clearSiteBindingCache: vi.fn() }));

import { protectedStore } from '../mocks/protected-settings';
import {
  MOVED_KEYS,
  migrateProtectedStorage,
} from '@/../src-bex/services/protected-storage-migration';
import { clearPermissionCache } from '@/../src-bex/handlers/permission-handler';
import { clampAutoLockMinutes } from '@/services/auto-lock-minutes';

const GRANT = {
  origin: 'https://example.com',
  accountPubkey: 'a'.repeat(64),
  requestType: 'sign_event',
  eventKind: 1,
  granted: true,
  timestamp: 1,
};

/**
 * Grants, bindings and auto-lock state used to sit in `chrome.storage.local`, which Porwr's content
 * scripts can read and write (#140). They move once, at background start, and the old keys go.
 */
describe('moving protected state out of content-script storage', () => {
  beforeEach(() => {
    local.clear();
    vi.clearAllMocks();
  });

  it('copies each old value into the protected store and deletes every old key', async () => {
    local.set('nostr:permissions', [GRANT]);
    local.set('nostr:site-bindings', [{ origin: 'https://example.com', pubkey: 'a'.repeat(64) }]);
    local.set('vault:auto-lock-minutes', 30);
    local.set('vault:last-activity', 1234);
    local.set('nostr:active', 'alice');

    await expect(migrateProtectedStorage()).resolves.toBe(4);

    expect(protectedStore.get('protected:permissions')).toEqual([GRANT]);
    expect(protectedStore.get('protected:auto-lock-minutes')).toBe(30);
    expect([...local.keys()]).toEqual(['nostr:active']);
    expect(clearPermissionCache).toHaveBeenCalled();
  });

  it('never overwrites a protected value, so a later write to the old key cannot replace it', async () => {
    protectedStore.set('protected:auto-lock-minutes', 15);
    local.set('vault:auto-lock-minutes', 0);

    await expect(migrateProtectedStorage()).resolves.toBe(0);

    expect(protectedStore.get('protected:auto-lock-minutes')).toBe(15);
    expect(local.has('vault:auto-lock-minutes')).toBe(false);
  });

  it('deletes old keys even when there is nothing to copy', async () => {
    await expect(migrateProtectedStorage()).resolves.toBe(0);

    expect(clearPermissionCache).not.toHaveBeenCalled();
  });

  it('covers every key the issue moves', () => {
    expect(MOVED_KEYS.map(([oldKey]) => oldKey).sort()).toEqual([
      'nostr:permissions',
      'nostr:site-bindings',
      'vault:auto-lock-minutes',
      'vault:last-activity',
    ]);
  });

  // `background.ts` cannot be imported, so this reads its source, as other boundary tests do.
  it('runs at background start, straight after session storage is locked down', () => {
    const source = readFileSync(resolve(__dirname, '../../../src-bex/background.ts'), 'utf8');
    const start = source.indexOf('await lockDownSessionStorage();');
    const migrate = source.indexOf('await migrateProtectedStorage()');
    const restore = source.indexOf('await restoreLastActivity();');

    expect(start).toBeGreaterThan(-1);
    expect(migrate).toBeGreaterThan(start);
    expect(migrate).toBeLessThan(restore);
  });
});

describe('the auto-lock timeout as read back (#140)', () => {
  it.each([
    [15, 15],
    [0, 0],
    [7.9, 7],
    [-5, 0],
    [100_000, 1440],
    ['30', 30],
  ])('clamps %s to %s', (stored, expected) => {
    expect(clampAutoLockMinutes(stored)).toBe(expected);
  });

  it.each([undefined, null, 'never', Number.NaN])('falls back to the default for %s', (stored) => {
    expect(clampAutoLockMinutes(stored)).toBe(15);
  });
});
