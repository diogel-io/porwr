import type { AccountSummary, AddAccountRequest } from '@/types/accounts';
import { getVaultView, isVaultUnlocked, sendBexMessage } from './vault-service';
import { NOSTR_ACTIVE, storageService } from './storage-service';

/**
 * Accounts, from a page's side (#240).
 *
 * Every change is a narrow request the background carries out on the decrypted vault: a page reads
 * a view with no secrets in it and never writes the vault back. The active alias lives in extension
 * storage, not the vault, and is read and set here directly.
 */

const fail = (response: unknown, fallback: string): never => {
  const error =
    response && typeof response === 'object' && 'error' in response && typeof response.error === 'string'
      ? response.error
      : fallback;
  throw new Error(error);
};

export async function get(): Promise<Record<string, AccountSummary>> {
  if (!(await isVaultUnlocked())) {
    return {};
  }
  try {
    const view = await getVaultView();
    return Object.fromEntries(view.accounts.map((account) => [account.alias, account]));
  } catch {
    return {};
  }
}

export async function getActive(): Promise<string | undefined> {
  return await storageService.get<string>(NOSTR_ACTIVE);
}

export async function setActive(alias: string): Promise<void> {
  await storageService.set(NOSTR_ACTIVE, alias);
}

/**
 * Adds an account and makes it active. With `privkey` (hex) it imports that key, which crosses into
 * the background once and is never read back; without it, the background generates a key.
 */
export async function save(request: AddAccountRequest): Promise<AccountSummary> {
  if (!(await isVaultUnlocked())) {
    throw new Error('Vault is locked. Cannot save key.');
  }
  const response = await sendBexMessage('accounts.add', request);
  if (!response || typeof response !== 'object' || !('id' in response)) {
    return fail(response, 'Failed to save the key');
  }
  await setActive(response.alias);
  return response;
}

export async function renameAlias(currentAlias: string, newAlias: string): Promise<void> {
  if (!(await isVaultUnlocked())) {
    throw new Error('Vault is locked. Cannot rename key.');
  }
  const response = await sendBexMessage('accounts.rename', { currentAlias, newAlias });
  if (!response || typeof response !== 'object' || !('id' in response)) {
    fail(response, 'Failed to rename the key');
  }
}

export async function remove(id: string): Promise<void> {
  if (!(await isVaultUnlocked())) {
    throw new Error('Vault is locked. Cannot remove key.');
  }
  const response = await sendBexMessage('accounts.remove', { accountPubkey: id });
  if (typeof response !== 'boolean') {
    fail(response, 'Failed to remove the key');
  }
}

/**
 * One account's nsec, for the user's explicit "show private key" or backup export. The only path by
 * which a private key reaches a page; callers hold it no longer than they show or write it.
 */
export async function revealSecret(accountPubkey: string): Promise<string> {
  const response = await sendBexMessage('accounts.revealSecret', { accountPubkey });
  if (!response || typeof response !== 'object' || !('nsec' in response)) {
    return fail(response, 'Failed to reveal the key');
  }
  return response.nsec;
}
