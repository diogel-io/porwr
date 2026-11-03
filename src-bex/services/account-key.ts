/**
 * What kind of key stands behind a vault account (diogel-io/workspace#138).
 *
 * A local account holds its private key in the vault. A remote-signer account holds none: its key
 * stays with a NIP-46 signer, and the vault keeps only Porwr's client key for that connection.
 * Everything that needs the private key itself asks for it here, so a remote account fails closed
 * with one clear error rather than a hex parse error, and never signs with the client key.
 */

import { hexToBytes } from '@noble/hashes/utils.js';
import { getPublicKey } from 'nostr-tools';

import type { RemoteAccount, StoredKey } from '@/types';

export const REMOTE_ACCOUNT_UNSUPPORTED =
  'This is not available for a remote-signer account, whose key is not in Porwr';

export class RemoteAccountUnsupportedError extends Error {
  constructor() {
    super(REMOTE_ACCOUNT_UNSUPPORTED);
    this.name = 'RemoteAccountUnsupportedError';
  }
}

export type RemoteStoredKey = StoredKey & { account: RemoteAccount };

export const isRemoteAccount = (stored: StoredKey): stored is RemoteStoredKey =>
  stored.account.type === 'remote';

/**
 * The account's private key.
 *
 * @throws {RemoteAccountUnsupportedError} For a remote-signer account, which has none here.
 */
export function localSecretKeyOf(stored: StoredKey): Uint8Array {
  const account = stored.account;
  if (account.type === 'remote') throw new RemoteAccountUnsupportedError();
  return hexToBytes(account.privkey);
}

/**
 * The public key an account acts as. For a local account it is derived from the stored key, not
 * read from the stored `id`; for a remote account it is the `id`, which the signer reported when
 * the account was connected. Null for a malformed local key, which belongs to no one.
 */
export function accountPubkeyOf(stored: StoredKey): string | null {
  const account = stored.account;
  if (account.type === 'remote') return stored.id;
  try {
    return getPublicKey(hexToBytes(account.privkey));
  } catch {
    return null;
  }
}
