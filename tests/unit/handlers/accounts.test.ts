import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import * as nip49 from 'nostr-tools/nip49';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

import type { VaultData } from '@/types/bridge';

/** An in-memory vault standing in for the encrypted one. */
const state = vi.hoisted(() => ({
  vault: null as VaultData | null,
  writes: 0,
  active: undefined as string | undefined,
  approvals: vi.fn(),
  exceptions: vi.fn(),
  clearContactCache: vi.fn(),
  sweepSiteState: vi.fn().mockResolvedValue({ grants: 0, bindings: 0 }),
  interruptForAccount: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/contact-cache', () => ({ clearAccount: state.clearContactCache }));
vi.mock('@/../src-bex/services/request-queue', () => ({
  interruptRequestsForAccount: state.interruptForAccount,
}));
vi.mock('@/../src-bex/services/connected-sites', () => ({
  sweepSiteStateForRemovedAccounts: state.sweepSiteState,
}));

// NIP-49 at full strength (scrypt, logn 16) takes seconds per call, and many times that under
// coverage. Tests run the handlers' calls at a low cost instead; the test "encrypts at full NIP-49
// strength" checks the handler asks for no cost of its own, so production uses the default.
vi.mock('nostr-tools/nip49', async () => {
  const actual = await vi.importActual<typeof import('nostr-tools/nip49')>('nostr-tools/nip49');
  return {
    ...actual,
    encrypt: vi.fn((secret: Uint8Array, password: string, logn?: number) =>
      actual.encrypt(secret, password, logn ?? 4),
    ),
  };
});

vi.mock('@/../src-bex/vault', () => ({
  getVaultData: vi.fn(() =>
    Promise.resolve(
      state.vault
        ? { success: true, vaultData: structuredClone(state.vault) }
        : { success: false, error: 'Vault is locked' },
    ),
  ),
  // The vault password the tests use; anything else fails, as a wrong password does (#141).
  verifyVaultPassword: vi.fn((password: string) => Promise.resolve(password === 'vault-password')),
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
  const table = (modify: ReturnType<typeof vi.fn>) => ({
    where: () => ({ equals: () => ({ modify }) }),
  });
  return { db: { approvals: table(state.approvals), exceptions: table(state.exceptions) } };
});

import {
  handleAccountsAdd,
  handleAccountsRemove,
  handleAccountsRename,
  handleAccountsRevealSecret,
  handleAccountsExportEncrypted,
  handleAccountsImportEncrypted,
  handleVaultGetView,
} from '@/../src-bex/handlers/accounts';

const aliceKey = generateSecretKey();
const bobKey = generateSecretKey();
const ALICE = getPublicKey(aliceKey);
const BOB = getPublicKey(bobKey);

beforeEach(() => {
  vi.clearAllMocks();
  state.clearContactCache.mockResolvedValue(undefined);
  state.writes = 0;
  state.active = 'alice';
  state.vault = {
    mnemonic: 'abandon abandon abandon',
    passphrase: 'correct horse',
    accounts: [
      {
        id: ALICE,
        alias: 'alice',
        account: { privkey: bytesToHex(aliceKey) },
        createdAt: '2026-01-01',
      },
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
    expect(result.data).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{64}$/),
      alias: 'carol',
      createdAt: expect.any(String),
    });
    expect(JSON.stringify(result)).not.toMatch(/privkey|nsec/);

    const stored = state.vault!.accounts.find((account) => account.alias === 'carol')!;
    expect(stored.id).toBe(result.data.id);
    expect(stored.account.privkey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('imports a given key, storing it under its own public key', async () => {
    const carolKey = generateSecretKey();

    const result = await handleAccountsAdd({ alias: 'carol', privkey: bytesToHex(carolKey) });

    expect(result).toMatchObject({
      success: true,
      data: { id: getPublicKey(carolKey), alias: 'carol' },
    });
    expect(state.vault!.accounts).toHaveLength(3);
  });

  it.each([
    ['an empty alias', { alias: '   ' }, 'Alias is required.'],
    ['the reserved alias', { alias: 'Main Account' }, 'Alias "Main Account" is reserved.'],
    ['a taken alias', { alias: 'alice' }, 'Key with the same alias already exists.'],
    [
      'a key already in the vault',
      { alias: 'again', privkey: bytesToHex(aliceKey) },
      'Key with the same npub already exists.',
    ],
    [
      'a key that is not hex',
      { alias: 'x', privkey: 'nsec1notallowedhere' },
      'privkey must be a 64-character hex key',
    ],
  ])('refuses %s and writes nothing', async (_label, request, error) => {
    await expect(handleAccountsAdd(request)).resolves.toEqual({ success: false, error });
    expect(state.writes).toBe(0);
  });

  it('serialises concurrent adds so neither is lost', async () => {
    await Promise.all([handleAccountsAdd({ alias: 'one' }), handleAccountsAdd({ alias: 'two' })]);

    expect(state.vault!.accounts.map((account) => account.alias)).toEqual([
      'alice',
      'bob',
      'one',
      'two',
    ]);
  });
});

describe('accounts.rename', () => {
  it('renames one account and leaves every key, and the other account, exactly as they were', async () => {
    const before = structuredClone(state.vault!);

    await expect(
      handleAccountsRename({ currentAlias: 'alice', newAlias: 'alicia' }),
    ).resolves.toEqual({
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
    await expect(
      handleAccountsRename({ currentAlias: 'nobody', newAlias: 'x' }),
    ).resolves.toMatchObject({ success: false });
    await expect(
      handleAccountsRename({ currentAlias: 'alice', newAlias: 'Main Account' }),
    ).resolves.toMatchObject({ success: false });
    await expect(
      handleAccountsRename({ currentAlias: 'alice', newAlias: 'bob' }),
    ).resolves.toMatchObject({ success: false });
    expect(state.writes).toBe(0);
  });
});

describe('accounts.remove', () => {
  it('removes one account and keeps the other’s key exactly as it was', async () => {
    const bob = structuredClone(state.vault!.accounts[1]);

    await expect(handleAccountsRemove({ accountPubkey: ALICE })).resolves.toEqual({
      success: true,
      data: true,
    });

    expect(state.vault!.accounts).toEqual([bob]);
  });

  it('forgets the removed account’s cached contacts (#257)', async () => {
    state.clearContactCache.mockResolvedValue(undefined);

    await handleAccountsRemove({ accountPubkey: ALICE });

    expect(state.clearContactCache).toHaveBeenCalledWith(ALICE);
  });

  // Its sites must not sign as it again if the same key is imported later (#139).
  it('removes the grants and bindings of the account it removed, keeping the rest', async () => {
    const bob = state.vault!.accounts[1]!.id;

    await handleAccountsRemove({ accountPubkey: ALICE });

    expect(state.sweepSiteState).toHaveBeenCalledWith([bob]);
  });

  // A request still waiting for the removed account must not be approvable: approving would bind a
  // site to, and grant for, an account that is gone (#139).
  it('interrupts requests waiting on a decision for the account it removed', async () => {
    await handleAccountsRemove({ accountPubkey: ALICE });

    expect(state.interruptForAccount).toHaveBeenCalledWith(ALICE);
  });

  // Wallet data from before #304 has no owner until a wallet action assigns it to the main account.
  // Removing that account must remove it, not leave it for the next main account (#139).
  it('removes the wallets the main account owned before ownership was recorded', async () => {
    state.vault = {
      ...state.vault!,
      nip47Connections: [{ id: 'legacy-wallet', relays: [], isActive: true }],
      nip47PaymentHistory: [{ id: 'legacy-payment', status: 'paid' }],
      webLnPermissions: [
        { origin: 'https://shop.example', connectionId: 'legacy-wallet', methods: ['enable'] },
      ],
    } as unknown as VaultData;

    await handleAccountsRemove({ accountPubkey: ALICE });

    expect(state.vault!.nip47Connections).toEqual([]);
    expect(state.vault!.nip47PaymentHistory).toEqual([]);
    expect(state.vault!.webLnPermissions).toEqual([]);
  });

  it('still reports the removal if the site cleanup fails, since unlock sweeps again', async () => {
    state.sweepSiteState.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(handleAccountsRemove({ accountPubkey: ALICE })).resolves.toEqual({
      success: true,
      data: true,
    });
  });

  it('still reports the removal if clearing the contact cache fails', async () => {
    state.clearContactCache.mockRejectedValue(new Error('IndexedDB unavailable'));

    await expect(handleAccountsRemove({ accountPubkey: ALICE })).resolves.toEqual({
      success: true,
      data: true,
    });
  });

  it('answers false for an account that is not there', async () => {
    await expect(handleAccountsRemove({ accountPubkey: 'c'.repeat(64) })).resolves.toEqual({
      success: true,
      data: false,
    });
    expect(state.clearContactCache).not.toHaveBeenCalled();
  });

  it('refuses a pubkey that is not hex', async () => {
    await expect(handleAccountsRemove({ accountPubkey: 'npub1x' })).resolves.toMatchObject({
      success: false,
    });
  });

  it('takes the account’s wallets, grants and payments with it, in the same write (#304)', async () => {
    const connection = (id: string, accountPubkey: string) => ({
      id,
      accountPubkey,
      label: id,
      walletServicePubkey: 'w',
      clientSecret: 's',
      clientPubkey: 'c',
      relays: [],
      capabilities: [],
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      isActive: true,
    });
    state.vault = {
      ...state.vault!,
      nip47Connections: [connection('alice-wallet', ALICE), connection('bob-wallet', BOB)],
      nip47PaymentHistory: [
        {
          id: 'p1',
          accountPubkey: ALICE,
          connectionId: 'alice-wallet',
          connectionLabel: '',
          invoicePreview: '',
          status: 'succeeded',
          createdAt: '2026-01-01',
        },
        {
          id: 'p2',
          accountPubkey: BOB,
          connectionId: 'bob-wallet',
          connectionLabel: '',
          invoicePreview: '',
          status: 'succeeded',
          createdAt: '2026-01-01',
        },
      ],
      webLnPermissions: [
        {
          origin: 'https://a.example',
          connectionId: 'alice-wallet',
          methods: ['enable'],
          createdAt: '2026-01-01',
        },
        {
          origin: 'https://b.example',
          connectionId: 'bob-wallet',
          methods: ['enable'],
          createdAt: '2026-01-01',
        },
      ],
    };

    await handleAccountsRemove({ accountPubkey: ALICE });

    // One write: a wallet left behind for a moment would be handed to the main account by the next
    // wallet action's migration.
    expect(state.writes).toBe(1);
    expect(state.vault!.nip47Connections?.map((item) => item.id)).toEqual(['bob-wallet']);
    expect(state.vault!.nip47PaymentHistory?.map((item) => item.id)).toEqual(['p2']);
    expect(state.vault!.webLnPermissions?.map((item) => item.connectionId)).toEqual(['bob-wallet']);
  });
});

describe('accounts.revealSecret', () => {
  it('returns that one account’s nsec once the vault password is given again (#141)', async () => {
    await expect(
      handleAccountsRevealSecret({ accountPubkey: BOB, password: 'vault-password' }),
    ).resolves.toEqual({ success: true, data: { nsec: nip19.nsecEncode(bobKey) } });
  });

  it.each([
    ['no password', ''],
    ['a wrong password', 'not-the-vault-password'],
  ])('refuses %s, and returns no key', async (_label, password) => {
    const result = await handleAccountsRevealSecret({ accountPubkey: BOB, password });

    expect(result).toEqual({ success: false, error: 'Incorrect vault password' });
    expect(JSON.stringify(result)).not.toContain(nip19.nsecEncode(bobKey));
  });

  it('refuses an unknown account and a locked vault', async () => {
    await expect(
      handleAccountsRevealSecret({ accountPubkey: 'c'.repeat(64), password: 'vault-password' }),
    ).resolves.toEqual({ success: false, error: 'Account not found' });
    state.vault = null;
    await expect(
      handleAccountsRevealSecret({ accountPubkey: BOB, password: 'vault-password' }),
    ).resolves.toMatchObject({ success: false });
  });
});

// An export is encrypted here as a NIP-49 ncryptsec, so the page never receives the nsec (#141).
describe('accounts.exportEncrypted', () => {
  it('returns an ncryptsec that decrypts to the key with the export password, and the npub', async () => {
    const result = await handleAccountsExportEncrypted({
      accountPubkey: BOB,
      password: 'export-password',
    });

    if (!result.success) throw new Error(result.error);
    expect(result.data.npub).toBe(nip19.npubEncode(BOB));
    expect(nip49.decrypt(result.data.ncryptsec, 'export-password')).toEqual(bobKey);
    expect(() => nip49.decrypt(result.data.ncryptsec, 'wrong-password')).toThrow();
    expect(JSON.stringify(result)).not.toContain(nip19.nsecEncode(bobKey));
    expect(JSON.stringify(result)).not.toContain(bytesToHex(bobKey));
  });

  it('encrypts at full NIP-49 strength, setting no cost of its own', async () => {
    await handleAccountsExportEncrypted({ accountPubkey: BOB, password: 'export-password' });

    expect(vi.mocked(nip49.encrypt)).toHaveBeenCalledWith(bobKey, 'export-password');
  });

  it('refuses an export password under the minimum', async () => {
    await expect(
      handleAccountsExportEncrypted({ accountPubkey: BOB, password: 'short' }),
    ).resolves.toMatchObject({ success: false, error: expect.stringMatching(/at least 8/) });
  });

  it('refuses an unknown account and a locked vault', async () => {
    await expect(
      handleAccountsExportEncrypted({ accountPubkey: 'c'.repeat(64), password: 'export-password' }),
    ).resolves.toEqual({ success: false, error: 'Account not found' });
    state.vault = null;
    await expect(
      handleAccountsExportEncrypted({ accountPubkey: BOB, password: 'export-password' }),
    ).resolves.toMatchObject({ success: false });
  });
});

describe('accounts.importEncrypted', () => {
  const newKey = generateSecretKey();
  const newPubkey = getPublicKey(newKey);

  it('decrypts an ncryptsec and adds the key under its own public key', async () => {
    const ncryptsec = nip49.encrypt(newKey, 'backup-password');

    const result = await handleAccountsImportEncrypted({
      ncryptsec,
      password: 'backup-password',
      alias: 'restored',
    });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ id: newPubkey, alias: 'restored' }),
    });
    expect(state.vault!.accounts.at(-1)?.account.privkey).toBe(bytesToHex(newKey));
  });

  it('round-trips an export into a vault that lacks the key', async () => {
    const exported = await handleAccountsExportEncrypted({
      accountPubkey: BOB,
      password: 'export-password',
    });
    if (!exported.success) throw new Error(exported.error);
    state.vault = { ...state.vault!, accounts: state.vault!.accounts.filter((a) => a.id !== BOB) };

    await expect(
      handleAccountsImportEncrypted({
        ncryptsec: exported.data.ncryptsec,
        password: 'export-password',
        alias: 'bob again',
      }),
    ).resolves.toMatchObject({ success: true, data: { id: BOB } });
  });

  it('refuses a wrong password, and adds nothing', async () => {
    const before = state.vault!.accounts.length;

    const result = await handleAccountsImportEncrypted({
      ncryptsec: nip49.encrypt(newKey, 'backup-password'),
      password: 'wrong-password',
      alias: 'restored',
    });

    expect(result).toMatchObject({ success: false });
    expect(state.vault!.accounts).toHaveLength(before);
  });

  it('refuses something that is not an ncryptsec', async () => {
    await expect(
      handleAccountsImportEncrypted({ ncryptsec: 'nsec1abc', password: 'x', alias: 'y' }),
    ).resolves.toEqual({ success: false, error: 'Not an ncryptsec key' });
  });

  it('refuses a key the vault already holds', async () => {
    await expect(
      handleAccountsImportEncrypted({
        ncryptsec: nip49.encrypt(bobKey, 'backup-password'),
        password: 'backup-password',
        alias: 'duplicate',
      }),
    ).resolves.toMatchObject({ success: false });
  });

  // The NIP-49 specification's own test vector, so the format is the standard one. It is fixed at
  // logn 16, which is slow under coverage.
  it('decrypts the NIP-49 specification test vector', { timeout: 120_000 }, async () => {
    const vector =
      'ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p';

    const result = await handleAccountsImportEncrypted({
      ncryptsec: vector,
      password: 'nostr',
      alias: 'vector',
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        id: getPublicKey(
          hexToBytes('3501454135014541350145413501453fefb02227e449e57cf4d3a3ce05378683'),
        ),
      },
    });
  });
});
