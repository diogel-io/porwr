import { webcrypto } from 'node:crypto';

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type * as VaultModule from '@/../src-bex/vault';

// `tests/setup.ts` installs a mock WebCrypto for every file. This one needs the real thing: whether a
// key can be exported is exactly what is under test, and the mock exports anything.
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  writable: true,
  configurable: true,
});

/**
 * The unlocked vault survives a worker restart without its key ever existing as bytes (#245).
 *
 * Real WebCrypto, so `extractable` is the browser's own answer. Session storage and the
 * `vaultSession` table are in-memory stand-ins with the real semantics: session storage is what a
 * browser restart wipes, IndexedDB is what outlives it. A fresh import of the vault module stands in
 * for a restarted service worker, which has lost every in-memory key.
 */

const state = vi.hoisted(() => ({
  session: new Map<string, unknown>(),
  vaults: new Map<string, { id: string; encryptedData: string; createdAt: string }>(),
  vaultSession: new Map<string, { id: string; key: CryptoKey; salt: Uint8Array }>(),
}));

vi.mock('@/services/database', () => ({
  db: {
    vaults: {
      get: (id: string) => Promise.resolve(state.vaults.get(id)),
      put: (row: { id: string; encryptedData: string; createdAt: string }) => {
        state.vaults.set(row.id, row);
        return Promise.resolve(row.id);
      },
    },
    vaultSession: {
      get: (id: string) => Promise.resolve(state.vaultSession.get(id)),
      put: (row: { id: string; key: CryptoKey; salt: Uint8Array }) => {
        state.vaultSession.set(row.id, row);
        return Promise.resolve(row.id);
      },
      delete: (id: string) => {
        state.vaultSession.delete(id);
        return Promise.resolve();
      },
    },
  },
}));

const sessionArea = {
  get: (keys: string[]) =>
    Promise.resolve(
      Object.fromEntries(
        keys.filter((key) => state.session.has(key)).map((key) => [key, state.session.get(key)]),
      ),
    ),
  set: (items: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(items)) state.session.set(key, value);
    return Promise.resolve();
  },
  remove: (keys: string | string[]) => {
    for (const key of [keys].flat()) state.session.delete(key);
    return Promise.resolve();
  },
};
vi.stubGlobal('chrome', { storage: { session: sessionArea, local: sessionArea } });

/** The vault module as a freshly started service worker sees it: no key in memory. */
const freshWorker = async (): Promise<typeof VaultModule> => {
  vi.resetModules();
  return import('@/../src-bex/vault');
};

const PASSWORD = 'correct horse battery staple';
const DATA = { accounts: [] };

beforeEach(() => {
  state.session.clear();
  state.vaults.clear();
  state.vaultSession.clear();
});

/** Any 32-byte value written as base64: what a raw AES-256 key looked like before #245. */
const looksLikeRawKey = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  try {
    return atob(value).length === 32;
  } catch {
    return false;
  }
};

describe('the vault key (#245)', () => {
  it('cannot be exported, however it was derived', async () => {
    const { deriveNewKey, deriveKeyFromEncryptedVault, encryptWithKey } =
      await import('@/services/crypto');
    const { key, salt } = await deriveNewKey(PASSWORD);
    const { key: again } = await deriveKeyFromEncryptedVault(
      PASSWORD,
      await encryptWithKey(DATA, key, salt),
    );

    for (const derived of [key, again]) {
      expect(derived.extractable).toBe(false);
      await expect(crypto.subtle.exportKey('raw', derived)).rejects.toThrow();
    }
  });

  it('is never written to session storage, only a marker that the vault is unlocked', async () => {
    const vault = await freshWorker();
    await vault.createNewVault(PASSWORD, DATA);
    await vault.lockVault();
    await vault.unlockVault(PASSWORD);

    expect([...state.session.keys()]).toEqual(['vault:unlocked']);
    expect([...state.session.values()].some(looksLikeRawKey)).toBe(false);

    const kept = state.vaultSession.get('current');
    expect(Object.prototype.toString.call(kept?.key)).toBe('[object CryptoKey]');
    expect(kept?.key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', kept!.key)).rejects.toThrow();
  });
});

describe('keeping the vault unlocked (#245)', () => {
  it('survives a worker restart within the same browser session', async () => {
    await (await freshWorker()).createNewVault(PASSWORD, DATA);

    const restarted = await freshWorker();
    expect(restarted.isVaultUnlocked()).toBe(false);
    await expect(restarted.restoreVaultState()).resolves.toBe(true);

    expect(restarted.isVaultUnlocked()).toBe(true);
    await expect(restarted.getVaultData()).resolves.toMatchObject({
      success: true,
      vaultData: DATA,
    });
  });

  it('starts locked after a browser restart, and deletes the key that outlived it', async () => {
    await (await freshWorker()).createNewVault(PASSWORD, DATA);
    state.session.clear(); // What a browser restart does to session storage.

    const restarted = await freshWorker();
    await expect(restarted.restoreVaultState()).resolves.toBe(false);

    expect(restarted.isVaultUnlocked()).toBe(false);
    expect(state.vaultSession.size).toBe(0);
  });

  it('never imports the raw key bytes an older version left in session storage', async () => {
    await (await freshWorker()).createNewVault(PASSWORD, DATA);
    state.session.set('vault:session-key', btoa('k'.repeat(32)));
    state.session.set('vault:session-salt', btoa('s'.repeat(32)));

    const restarted = await freshWorker();
    await expect(restarted.restoreVaultState()).resolves.toBe(false);

    expect(restarted.isVaultUnlocked()).toBe(false);
    expect(state.session.size).toBe(0);
    expect(state.vaultSession.size).toBe(0);
  });

  it('is cleared by locking', async () => {
    const vault = await freshWorker();
    await vault.createNewVault(PASSWORD, DATA);

    await vault.lockVault();

    expect(state.session.size).toBe(0);
    expect(state.vaultSession.size).toBe(0);
    await expect((await freshWorker()).restoreVaultState()).resolves.toBe(false);
  });

  it('is cleared by importing a vault, and by a wrong password', async () => {
    const vault = await freshWorker();
    const { encryptedVault } = (await vault.createNewVault(PASSWORD, DATA)) as {
      encryptedVault: string;
    };

    await vault.importVault(encryptedVault);
    expect(state.vaultSession.size).toBe(0);
    expect(state.session.size).toBe(0);

    await vault.unlockVault(PASSWORD);
    expect(state.vaultSession.size).toBe(1);
    await vault.unlockVault('wrong password');
    expect(state.vaultSession.size).toBe(0);
    expect(state.session.size).toBe(0);
  });
});
