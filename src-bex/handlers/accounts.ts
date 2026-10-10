import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

import { db } from '@/services/database';
import { NOSTR_ACTIVE, storageService } from '@/services/storage-service';
import type { StoredKey, VaultData } from '@/types/bridge';
import type {
  AccountRequest,
  AccountSummary,
  AddAccountRequest,
  RenameAccountRequest,
  RevealedSecret,
  VaultView,
} from '@/types/accounts';
import { createPubkey } from '@/types/pubkey';
import type { HandlerResult } from '../types/background';
import { mutateVault, readVault } from '../services/vault-mutation';

/**
 * Accounts, for Porwr's own pages (#240).
 *
 * Pages used to read the whole decrypted vault, edit it, and write it all back. Now they read a view
 * with no secrets in it and ask for one change at a time; the background makes the change to the
 * decrypted vault itself. The raw listener only accepts these from extension pages.
 */

const RESERVED_ALIAS = 'Main Account';
const HEX_64 = /^[0-9a-f]{64}$/;

export const summarise = (account: StoredKey): AccountSummary => ({
  id: account.id,
  alias: account.alias,
  createdAt: account.createdAt,
});

/** The vault as a page may see it: accounts by id, alias and creation date, and nothing secret. */
export const viewOf = (vault: VaultData): VaultView => ({ accounts: (vault.accounts ?? []).map(summarise) });

/** The account whose stored key produces `pubkey`, matched on the key itself rather than the stored id. */
const findByKey = (vault: VaultData, pubkey: string): StoredKey | undefined =>
  (vault.accounts ?? []).find((account) => {
    try {
      return getPublicKey(hexToBytes(account.account.privkey)) === pubkey;
    } catch {
      return false;
    }
  });

const checkAlias = (vault: VaultData, alias: unknown, ignore?: string): string => {
  const trimmed = typeof alias === 'string' ? alias.trim() : '';
  if (!trimmed) throw new Error('Alias is required.');
  if (trimmed === RESERVED_ALIAS) throw new Error(`Alias "${RESERVED_ALIAS}" is reserved.`);
  if ((vault.accounts ?? []).some((account) => account.alias === trimmed && account.alias !== ignore)) {
    throw new Error('Key with the same alias already exists.');
  }
  return trimmed;
};

const fail = (error: unknown): { success: false; error: string } => ({
  success: false,
  error: error instanceof Error ? error.message : String(error),
});

export async function handleVaultGetView(): Promise<HandlerResult<VaultView>> {
  return { success: true, data: viewOf(await readVault()) };
}

export async function handleAccountsAdd(payload: AddAccountRequest): Promise<HandlerResult<AccountSummary>> {
  let secretKey: Uint8Array;
  if (payload?.privkey === undefined) {
    secretKey = generateSecretKey();
  } else if (typeof payload.privkey === 'string' && HEX_64.test(payload.privkey)) {
    secretKey = hexToBytes(payload.privkey);
  } else {
    return { success: false, error: 'privkey must be a 64-character hex key' };
  }
  const pubkey = getPublicKey(secretKey);

  try {
    const added = await mutateVault((vault) => {
      const alias = checkAlias(vault, payload?.alias);
      if (findByKey(vault, pubkey)) throw new Error('Key with the same npub already exists.');

      const account: StoredKey = {
        id: pubkey,
        alias,
        account: { privkey: bytesToHex(secretKey) },
        createdAt: new Date().toISOString(),
      };
      return { vault: { ...vault, accounts: [...(vault.accounts ?? []), account] }, result: summarise(account) };
    });
    return { success: true, data: added };
  } catch (error: unknown) {
    return fail(error);
  }
}

export async function handleAccountsRename(payload: RenameAccountRequest): Promise<HandlerResult<AccountSummary>> {
  const currentAlias = typeof payload?.currentAlias === 'string' ? payload.currentAlias : '';
  try {
    const renamed = await mutateVault((vault) => {
      const target = (vault.accounts ?? []).find((account) => account.alias === currentAlias);
      if (!target) throw new Error('Key not found.');
      const newAlias = checkAlias(vault, payload?.newAlias, currentAlias);
      const accounts = (vault.accounts ?? []).map((account) =>
        account === target ? { ...account, alias: newAlias } : account,
      );
      return { vault: { ...vault, accounts }, result: summarise({ ...target, alias: newAlias }) };
    });

    if (renamed.alias !== currentAlias) {
      // History and the active account are keyed by alias, so they follow the rename.
      await db.approvals.where('account').equals(currentAlias).modify({ account: renamed.alias });
      await db.exceptions.where('account').equals(currentAlias).modify({ account: renamed.alias });
      if ((await storageService.get<string>(NOSTR_ACTIVE)) === currentAlias) {
        await storageService.set(NOSTR_ACTIVE, renamed.alias);
      }
    }
    return { success: true, data: renamed };
  } catch (error: unknown) {
    return fail(error);
  }
}

export async function handleAccountsRemove(payload: AccountRequest): Promise<HandlerResult<boolean>> {
  const pubkey = createPubkey(typeof payload?.accountPubkey === 'string' ? payload.accountPubkey : '');
  if (!pubkey) return { success: false, error: 'accountPubkey must be a hex public key' };

  try {
    const removed = await mutateVault((vault) => {
      const target = findByKey(vault, pubkey) ?? (vault.accounts ?? []).find((account) => account.id === pubkey);
      if (!target) return { vault, result: false };
      return { vault: { ...vault, accounts: (vault.accounts ?? []).filter((account) => account !== target) }, result: true };
    });
    return { success: true, data: removed };
  } catch (error: unknown) {
    return fail(error);
  }
}

/**
 * One account's nsec, for the user's explicit "show private key" or backup export.
 *
 * The only action that returns a private key to a page. It does not ask for the password again (a
 * decision on #240): the vault must already be unlocked, and only Porwr's own pages can call it.
 */
export async function handleAccountsRevealSecret(payload: AccountRequest): Promise<HandlerResult<RevealedSecret>> {
  const pubkey = createPubkey(typeof payload?.accountPubkey === 'string' ? payload.accountPubkey : '');
  if (!pubkey) return { success: false, error: 'accountPubkey must be a hex public key' };

  try {
    const account = findByKey(await readVault(), pubkey);
    if (!account) return { success: false, error: 'Account not found' };
    return { success: true, data: { nsec: nip19.nsecEncode(hexToBytes(account.account.privkey)) } };
  } catch (error: unknown) {
    return fail(error);
  }
}
