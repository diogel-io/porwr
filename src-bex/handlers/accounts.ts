import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import * as nip49 from 'nostr-tools/nip49';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

import { db } from '@/services/database';
import { clearAccount as clearContactCache } from '@/services/contact-cache';
import { NOSTR_ACTIVE, storageService } from '@/services/storage-service';
import type { StoredKey, VaultData } from '@/types/bridge';
import type {
  AccountRequest,
  AccountSummary,
  AddAccountRequest,
  EncryptedKeyExport,
  ExportEncryptedRequest,
  ImportEncryptedRequest,
  RenameAccountRequest,
  RevealedSecret,
  RevealSecretRequest,
  VaultView,
} from '@/types/accounts';
import { MAIN_ACCOUNT_ALIAS, MIN_PASSWORD_LENGTH } from '@/types/accounts';
import { verifyVaultPassword } from '../vault';
import { createPubkey } from '@/types/pubkey';
import type { HandlerResult } from '../types/background';
import { mutateVault, readVault } from '../services/vault-mutation';
import { removeAccountWalletData } from '../services/nip47-connection-store';
import { assignUnownedWalletData } from '../services/nip47-ownership';
import { interruptRequestsForAccount } from '../services/request-queue';
import { sweepSiteStateForRemovedAccounts } from '../services/connected-sites';

/**
 * Accounts, for Porwr's own pages (#240).
 *
 * Pages used to read the whole decrypted vault, edit it, and write it all back. Now they read a view
 * with no secrets in it and ask for one change at a time; the background makes the change to the
 * decrypted vault itself. The raw listener only accepts these from extension pages.
 */

const HEX_64 = /^[0-9a-f]{64}$/;

export const summarise = (account: StoredKey): AccountSummary => ({
  id: account.id,
  alias: account.alias,
  createdAt: account.createdAt,
});

/** The vault as a page may see it: accounts by id, alias and creation date, and nothing secret. */
export const viewOf = (vault: VaultData): VaultView => ({
  accounts: (vault.accounts ?? []).map(summarise),
});

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
  if (trimmed === MAIN_ACCOUNT_ALIAS) throw new Error(`Alias "${MAIN_ACCOUNT_ALIAS}" is reserved.`);
  if (
    (vault.accounts ?? []).some((account) => account.alias === trimmed && account.alias !== ignore)
  ) {
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

export async function handleAccountsAdd(
  payload: AddAccountRequest,
): Promise<HandlerResult<AccountSummary>> {
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
      return {
        vault: { ...vault, accounts: [...(vault.accounts ?? []), account] },
        result: summarise(account),
      };
    });
    return { success: true, data: added };
  } catch (error: unknown) {
    return fail(error);
  }
}

export async function handleAccountsRename(
  payload: RenameAccountRequest,
): Promise<HandlerResult<AccountSummary>> {
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

export async function handleAccountsRemove(
  payload: AccountRequest,
): Promise<HandlerResult<boolean>> {
  const pubkey = createPubkey(
    typeof payload?.accountPubkey === 'string' ? payload.accountPubkey : '',
  );
  if (!pubkey) return { success: false, error: 'accountPubkey must be a hex public key' };

  try {
    const removedId = await mutateVault((vault) => {
      const target =
        findByKey(vault, pubkey) ?? (vault.accounts ?? []).find((account) => account.id === pubkey);
      if (!target) return { vault, result: undefined };
      // Its wallets go with it, in the same write (#304): a connection with no account behind it
      // would otherwise be migrated to the main account on the next wallet action. Pre-#304 data is
      // given its owner first, so removing the main account removes the wallets it owned instead of
      // leaving them to be handed to whichever account is main next (#139).
      const withoutWallets = removeAccountWalletData(assignUnownedWalletData(vault), target.id);
      return {
        vault: {
          ...withoutWallets,
          accounts: (vault.accounts ?? []).filter((account) => account !== target),
        },
        result: target.id,
      };
    });
    if (removedId !== undefined) {
      // A request waiting on a decision for it can no longer be approved: approving would bind a
      // site to, and grant for, an account that no longer exists (#139).
      await interruptRequestsForAccount(removedId).catch(() => undefined);
      // Its sites must not sign as it again if the same key is imported later (#139). Best-effort:
      // the account is gone, signing as it already fails closed, and unlock sweeps again.
      await readVault()
        .then((vault) => sweepSiteStateForRemovedAccounts((vault.accounts ?? []).map((a) => a.id)))
        .catch(() => undefined);
      // Its cached contacts would otherwise outlive the account (#257). Best-effort: the account is gone.
      await clearContactCache(removedId).catch(() => undefined);
    }
    return { success: true, data: removedId !== undefined };
  } catch (error: unknown) {
    return fail(error);
  }
}

/**
 * One account's nsec, for the user's explicit "show private key".
 *
 * The only action that returns a private key to a page, and only to Porwr's own. The vault password
 * is asked for again first, so a moment at an unlocked browser is not enough to read a key (#141;
 * this replaces the no-re-authentication decision on #240). Export no longer uses it: an export is
 * encrypted here and the page receives only the `ncryptsec`.
 */
export async function handleAccountsRevealSecret(
  payload: RevealSecretRequest,
): Promise<HandlerResult<RevealedSecret>> {
  const pubkey = createPubkey(
    typeof payload?.accountPubkey === 'string' ? payload.accountPubkey : '',
  );
  if (!pubkey) return { success: false, error: 'accountPubkey must be a hex public key' };
  if (!(await verifyVaultPassword(payload?.password))) {
    return { success: false, error: 'Incorrect vault password' };
  }

  try {
    const account = findByKey(await readVault(), pubkey);
    if (!account) return { success: false, error: 'Account not found' };
    return { success: true, data: { nsec: nip19.nsecEncode(hexToBytes(account.account.privkey)) } };
  } catch (error: unknown) {
    return fail(error);
  }
}

/**
 * One account's key, encrypted for export as a NIP-49 `ncryptsec` with a password chosen for the
 * export (#141). The key is encrypted here, so the page never receives the nsec. Any NIP-49 client,
 * Porwr included, can import the result with the same password.
 *
 * The vault password is checked first, as for showing a key: whoever chooses the export password
 * can decrypt the export, so exporting is as sensitive as showing.
 */
export async function handleAccountsExportEncrypted(
  payload: ExportEncryptedRequest,
): Promise<HandlerResult<EncryptedKeyExport>> {
  const pubkey = createPubkey(
    typeof payload?.accountPubkey === 'string' ? payload.accountPubkey : '',
  );
  if (!pubkey) return { success: false, error: 'accountPubkey must be a hex public key' };
  if (typeof payload?.password !== 'string' || payload.password.length < MIN_PASSWORD_LENGTH) {
    return {
      success: false,
      error: `The export password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    };
  }
  if (!(await verifyVaultPassword(payload?.vaultPassword))) {
    return { success: false, error: 'Incorrect vault password' };
  }

  try {
    const account = findByKey(await readVault(), pubkey);
    if (!account) return { success: false, error: 'Account not found' };
    return {
      success: true,
      data: {
        ncryptsec: nip49.encrypt(hexToBytes(account.account.privkey), payload.password),
        npub: nip19.npubEncode(account.id),
      },
    };
  } catch (error: unknown) {
    return fail(error);
  }
}

/**
 * Import a NIP-49 `ncryptsec`, decrypted here with its password, then added as any key is
 * (`handleAccountsAdd`). The decrypted key never reaches the page (#141).
 */
export async function handleAccountsImportEncrypted(
  payload: ImportEncryptedRequest,
): Promise<HandlerResult<AccountSummary>> {
  const ncryptsec = typeof payload?.ncryptsec === 'string' ? payload.ncryptsec.trim() : '';
  if (!ncryptsec.startsWith('ncryptsec1')) {
    return { success: false, error: 'Not an ncryptsec key' };
  }

  let secretKey: Uint8Array;
  try {
    secretKey = nip49.decrypt(
      ncryptsec,
      typeof payload?.password === 'string' ? payload.password : '',
    );
  } catch {
    return { success: false, error: 'Incorrect password, or not a valid ncryptsec' };
  }

  return handleAccountsAdd({ alias: payload?.alias, privkey: bytesToHex(secretKey) });
}
