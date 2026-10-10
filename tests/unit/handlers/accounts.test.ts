import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils';

import type { VaultData } from '@/types/bridge';

/** An in-memory vault standing in for the encrypted one. */
const state = vi.hoisted(() => ({
  vault: null as VaultData | null,
  writes: 0,
  active: undefined as string | undefined,
  approvals: vi.fn(),
  exceptions: vi.fn(),
}));

vi.mock('@/../src-bex/vault', () => ({
  getVaultData: vi.fn(() =>
    Promise.resolve(state.vault ? { success: true, vaultData: structuredClone(state.vault) } : { success: false, error: 'Vault is locked' }),
  ),
  updateVaultData: vi.fn((next: VaultData) => {
    state.vault = structuredClone(next);
    state.writes += 1;
    return Promise.resolve({ success: true });
  }),
}));

vi.mock('@/services/storage-service', () => ({
  NOSTR_ACTIVE: 'nostr:active',
  storageService: {
    get: vi.fn(() => Promise.resolve(state.active)),
    set: vi.fn((_key: string, value: string) => {
      state.active = value;
      return Promise.resolve();
    }),
  },
}));

vi.mock('@/services/database', () => {
  const table = (modify: ReturnType<typeof vi.fn>) => ({ where: () => ({ equals: () => ({ modify }) }) });
  return { db: { approvals: table(state.approvals), exceptions: table(state.exceptions) } };
});

import {
  handleAccountsAdd,
  handleAccountsRemove,
  handleAccountsRename,
  handleAccountsRevealSecret,
  handleVaultGetView,
} from '@/../src-bex/handlers/accounts';

const aliceKey = generateSecretKey();
const bobKey = generateSecretKey();
const ALICE = getPublicKey(aliceKey);
const BOB = getPublicKey(bobKey);

beforeEach(() => {
  vi.clearAllMocks();
  state.writes = 0;
  state.active = 'alice';
  state.vault = {
    mnemonic: 'abandon abandon abandon',
    passphrase: 'correct horse',
    accounts: [
      { id: ALICE, alias: 'alice', account: { privkey: bytesToHex(aliceKey) }, createdAt: '2026-01-01' },
      { id: BOB, alias: 'bob', account: { privkey: bytesToHex(bobKey) }, createdAt: '2026-01-02' },
    ],
  };
});

describe('vault.getView', () => {
  it('lists accounts by id, alias and creation date only', async () => {
    await expect(handleVaultGetView()).resolves.toEqual({
      success: true,
      data: {
        accounts: [
          { id: ALICE, alias: 'alice', createdAt: '2026-01-01' },
          { id: BOB, alias: 'bob', createdAt: '2026-01-02' },
        ],
      },
    });
  });

  it('fails while the vault is locked', async () => {
    state.vault = null;
    await expect(handleVaultGetView()).rejects.toThrow('Vault is locked');
  });
});

describe('accounts.add', () => {
  it('generates a key in the background and returns only the new account’s summary', async () => {
    const result = await handleAccountsAdd({ alias: '  carol  ' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ id: expect.stringMatching(/^[0-9a-f]{64}$/), alias: 'carol', createdAt: expect.any(String) });
    expect(JSON.stringify(result)).not.toMatch(/privkey|nsec/);

    const stored = state.vault!.accounts.find((account) => account.alias === 'carol')!;
    expect(stored.id).toBe(result.data.id);
    expect(stored.account.privkey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('imports a given key, storing it under its own public key', async () => {
    const carolKey = generateSecretKey();

    const result = await handleAccountsAdd({ alias: 'carol', privkey: bytesToHex(carolKey) });

    expect(result).toMatchObject({ success: true, data: { id: getPublicKey(carolKey), alias: 'carol' } });
    expect(state.vault!.accounts).toHaveLength(3);
  });

  it.each([
    ['an empty alias', { alias: '   ' }, 'Alias is required.'],
    ['the reserved alias', { alias: 'Main Account' }, 'Alias "Main Account" is reserved.'],
    ['a taken alias', { alias: 'alice' }, 'Key with the same alias already exists.'],
    ['a key already in the vault', { alias: 'again', privkey: bytesToHex(aliceKey) }, 'Key with the same npub already exists.'],
    ['a key that is not hex', { alias: 'x', privkey: 'nsec1notallowedhere' }, 'privkey must be a 64-character hex key'],
  ])('refuses %s and writes nothing', async (_label, request, error) => {
    await expect(handleAccountsAdd(request)).resolves.toEqual({ success: false, error });
    expect(state.writes).toBe(0);
  });

  it('serialises concurrent adds so neither is lost', async () => {
    await Promise.all([handleAccountsAdd({ alias: 'one' }), handleAccountsAdd({ alias: 'two' })]);

    expect(state.vault!.accounts.map((account) => account.alias)).toEqual(['alice', 'bob', 'one', 'two']);
  });
});

describe('accounts.rename', () => {
  it('renames one account and leaves every key, and the other account, exactly as they were', async () => {
    const before = structuredClone(state.vault!);

    await expect(handleAccountsRename({ currentAlias: 'alice', newAlias: 'alicia' })).resolves.toEqual({
      success: true,
      data: { id: ALICE, alias: 'alicia', createdAt: '2026-01-01' },
    });

    expect(state.vault!.accounts[0]).toEqual({ ...before.accounts[0], alias: 'alicia' });
    expect(state.vault!.accounts[1]).toEqual(before.accounts[1]);
    expect(state.vault!.mnemonic).toBe(before.mnemonic);
  });

  it('carries history and the active account over to the new alias', async () => {
    await handleAccountsRename({ currentAlias: 'alice', newAlias: 'alicia' });

    expect(state.approvals).toHaveBeenCalledWith({ account: 'alicia' });
    expect(state.exceptions).toHaveBeenCalledWith({ account: 'alicia' });
    expect(state.active).toBe('alicia');
  });

  it('leaves the active account alone when renaming another one', async () => {
    await handleAccountsRename({ currentAlias: 'bob', newAlias: 'robert' });
    expect(state.active).toBe('alice');
  });

  it('refuses a missing account, the reserved alias, and a taken alias', async () => {
    await expect(handleAccountsRename({ currentAlias: 'nobody', newAlias: 'x' })).resolves.toMatchObject({ success: false });
    await expect(handleAccountsRename({ currentAlias: 'alice', newAlias: 'Main Account' })).resolves.toMatchObject({ success: false });
    await expect(handleAccountsRename({ currentAlias: 'alice', newAlias: 'bob' })).resolves.toMatchObject({ success: false });
    expect(state.writes).toBe(0);
  });
});

describe('accounts.remove', () => {
  it('removes one account and keeps the other’s key exactly as it was', async () => {
    const bob = structuredClone(state.vault!.accounts[1]);

    await expect(handleAccountsRemove({ accountPubkey: ALICE })).resolves.toEqual({ success: true, data: true });

    expect(state.vault!.accounts).toEqual([bob]);
  });

  it('answers false for an account that is not there', async () => {
    await expect(handleAccountsRemove({ accountPubkey: 'c'.repeat(64) })).resolves.toEqual({ success: true, data: false });
  });

  it('refuses a pubkey that is not hex', async () => {
    await expect(handleAccountsRemove({ accountPubkey: 'npub1x' })).resolves.toMatchObject({ success: false });
  });
});

describe('accounts.revealSecret', () => {
  it('returns that one account’s nsec', async () => {
    await expect(handleAccountsRevealSecret({ accountPubkey: BOB })).resolves.toEqual({
      success: true,
      data: { nsec: nip19.nsecEncode(bobKey) },
    });
  });

  it('refuses an unknown account and a locked vault', async () => {
    await expect(handleAccountsRevealSecret({ accountPubkey: 'c'.repeat(64) })).resolves.toEqual({
      success: false,
      error: 'Account not found',
    });
    state.vault = null;
    await expect(handleAccountsRevealSecret({ accountPubkey: BOB })).resolves.toMatchObject({ success: false });
  });
});
