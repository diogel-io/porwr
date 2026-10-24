import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock('@/services/log-service', () => ({
  LogLevel: { ERROR: 'ERROR' },
  logService: { log: mocks.log },
}));

import { lockDownSessionStorage } from '@/../src-bex/services/session-storage-lock';

/** Session storage holds the queue and the unlock marker; content scripts must never read it (T15). */
describe('lockDownSessionStorage', () => {
  const original = globalThis.chrome;

  const withSession = (session: unknown) => {
    (globalThis as { chrome?: unknown }).chrome = { storage: { session } };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    (globalThis as { chrome?: unknown }).chrome = original;
  });

  it('restricts session storage to trusted contexts', async () => {
    const setAccessLevel = vi.fn().mockResolvedValue(undefined);
    withSession({ setAccessLevel });

    await lockDownSessionStorage();

    expect(setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it('skips quietly where the browser offers no setAccessLevel', async () => {
    withSession({});

    await expect(lockDownSessionStorage()).resolves.toBeUndefined();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it('logs a failure rather than stopping the worker from starting', async () => {
    withSession({ setAccessLevel: vi.fn().mockRejectedValue(new Error('denied')) });

    await expect(lockDownSessionStorage()).resolves.toBeUndefined();
    expect(mocks.log).toHaveBeenCalledWith(
      'ERROR',
      '[BEX] Failed to set session storage access level',
      { error: 'denied' },
    );
  });

  // `background.ts` cannot be imported (it registers listeners at load), so this reads its source,
  // as `bridge-action-routing.test.ts` does.
  it('is the first thing the background does when it starts', () => {
    const source = readFileSync(resolve(__dirname, '../../../src-bex/background.ts'), 'utf8');
    const body = /async function initialize\(\): Promise<void> \{\s*try \{\s*([^;]+);/.exec(source);

    expect(body?.[1]).toBe('await lockDownSessionStorage()');
  });
});
