/**
 * Which account acts for a site.
 *
 * A site is bound to an account, and everything done on that site's behalf — signing, encrypting,
 * decrypting, zapping — uses the bound account rather than whichever account happens to be active
 * (#116). A NIP-07 client caches the public key it received at login and attributes everything
 * afterwards to that identity, so following the active account would silently break that.
 *
 * Encryption matters here as much as signing. Encrypting under the wrong identity tells the
 * recipient the wrong thing about who is talking to them, and decryption under the wrong key simply
 * fails, which looks like data loss rather than an identity mix-up.
 */

import { hexToBytes } from '@noble/hashes/utils';

import { NOSTR_ACTIVE, storageService } from '@/services/storage-service';
import type { StoredKey } from '@/types';
import { ErrorCode } from '@/types/error-codes.d';
import { getVaultData, isVaultUnlocked } from '../vault';
import { bindOriginIfUnbound, getBinding } from './site-binding-store';

export type SigningAccountResult = { account: StoredKey } | { error: string; code: ErrorCode };

export const BOUND_ACCOUNT_GONE = 'The account this site is connected to is no longer available';

export async function listAccounts(): Promise<StoredKey[]> {
  const vaultDataRes = await getVaultData();
  if (!vaultDataRes.success || !vaultDataRes.vaultData) return [];

  const data = vaultDataRes.vaultData as { accounts?: StoredKey[] };
  return data.accounts ?? [];
}

export async function getActiveAccount(): Promise<StoredKey | null> {
  const alias = await storageService.get<string>(NOSTR_ACTIVE);
  if (!alias) return null;

  const accounts = await listAccounts();
  return accounts.find((acc) => acc.alias === alias) ?? null;
}

/**
 * Resolves the account a site acts as: its bound account, or for an unbound site the active one.
 *
 * It never writes a binding. Asking is not consent, so a site is bound only once the user approves
 * one of its requests (`bindSiteToAccount`, called from `requestApproval`), and a rejected, expired
 * or interrupted request leaves no trace (#139). Once bound, the binding is fixed:
 * `bindOriginIfUnbound` never overwrites.
 */
export async function resolveSigningAccount(origin: string): Promise<SigningAccountResult> {
  // Checked here rather than inferred from an empty account list: a locked vault and a vault with
  // no accounts are different problems, and the caller's error message should say which. The
  // encryption handlers used to get this from `getActiveSecretKey`, which this replaced.
  if (!isVaultUnlocked()) {
    return { error: 'Vault is locked', code: ErrorCode.VLT_LOCKED };
  }

  const binding = await getBinding(origin);

  if (binding) {
    const accounts = await listAccounts();
    const bound = accounts.find((acc) => acc.id === binding.pubkey);
    if (bound) return { account: bound };

    // Fail closed. Falling back to the active account is the substitution this exists to prevent.
    return { error: BOUND_ACCOUNT_GONE, code: ErrorCode.SIG_NO_ACTIVE_KEY };
  }

  const active = await getActiveAccount();
  if (!active) return { error: 'No active account', code: ErrorCode.SIG_NO_ACTIVE_KEY };

  return { account: active };
}

/**
 * Bind a site to the account the user approved it as. A no-op for a site already bound, so an
 * approval can never move a site to another account (only the user can, from Porwr's own UI).
 */
export async function bindSiteToAccount(origin: string, accountPubkey: string): Promise<void> {
  await bindOriginIfUnbound(origin, accountPubkey);
}

/**
 * The bound account's secret key, for the encryption handlers.
 *
 * Throws rather than returning a result, because those handlers already turn a thrown error into
 * their failure shape and there is nothing useful to add on the way through.
 */
export async function resolveSigningSecretKey(origin: string): Promise<Uint8Array> {
  const resolved = await resolveSigningAccount(origin);
  if ('error' in resolved) throw new Error(resolved.error);

  return hexToBytes(resolved.account.account.privkey);
}
