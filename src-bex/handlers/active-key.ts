import type { Pubkey } from '@/types/pubkey';
import { NOSTR_ACTIVE, storageService } from '@/services/storage-service';
import type { StoredKey, VaultData } from '@/types/bridge';
import { handleVaultGetData, handleVaultIsUnlocked } from './vault-handler';
import { accountPubkeyOf, localSecretKeyOf } from '../services/account-key';

export async function getActiveStoredKey(): Promise<StoredKey> {
  const isUnlockedResult = await handleVaultIsUnlocked({}, '');
  if (!isUnlockedResult.success || !isUnlockedResult.data) {
    throw new Error('Vault is locked');
  }

  const activeAlias = await storageService.get<string>(NOSTR_ACTIVE);
  if (!activeAlias) {
    throw new Error('No active account found');
  }

  const vaultRes = await handleVaultGetData({}, '');
  if (!vaultRes.success || !vaultRes.data.vaultData) {
    throw new Error('Secret key not found');
  }

  const vaultData: VaultData = vaultRes.data.vaultData;
  const storedKey = vaultData.accounts?.find((account) => account.alias === activeAlias);

  if (!storedKey) {
    throw new Error('Secret key not found');
  }

  return storedKey;
}

/** @throws For a remote-signer account, whose key is not in Porwr (#138). */
export async function getActiveSecretKey(): Promise<Uint8Array> {
  return localSecretKeyOf(await getActiveStoredKey());
}

/**
 * The secret key of the vault account whose public key is `pubkey`, for signing as that account.
 *
 * Fails closed: a locked vault or an unknown account throws, and it never falls back to the active
 * account. Accounts are matched on the public key derived from their stored key, not on the stored
 * `id`, so the key used is always the one that produces `pubkey`.
 */
export async function getSecretKeyForAccount(pubkey: Pubkey): Promise<Uint8Array> {
  const isUnlockedResult = await handleVaultIsUnlocked({}, '');
  if (!isUnlockedResult.success || !isUnlockedResult.data) {
    throw new Error('Vault is locked');
  }

  const vaultRes = await handleVaultGetData({}, '');
  if (!vaultRes.success || !vaultRes.data.vaultData) {
    throw new Error('Vault is locked');
  }

  for (const account of vaultRes.data.vaultData.accounts ?? []) {
    // A malformed stored key belongs to no one, so `accountPubkeyOf` gives null and the search goes
    // on. A remote-signer account has no key here to sign with, and says so (#138).
    if (accountPubkeyOf(account) === pubkey) return localSecretKeyOf(account);
  }
  throw new Error('Account not found');
}
