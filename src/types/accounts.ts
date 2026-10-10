/**
 * What extension pages may know about the vault's accounts (#240).
 *
 * Never a private key, mnemonic, passphrase or wallet secret. `StoredKey` and `VaultData` hold those
 * and are for the background only; pages work with these instead, and change accounts through the
 * narrow `accounts.*` actions, which edit the decrypted vault inside the background.
 */

/** An account as a page sees it: who it is, never its key. `id` is the hex public key. */
export type AccountSummary = Readonly<{ id: string; alias: string; createdAt: string }>;

/** The vault as a page sees it. */
export interface VaultView {
  accounts: AccountSummary[];
}

/**
 * Add an account. With `privkey` (hex), it imports that key: the key crosses from the page into the
 * background once and never comes back. Without it, the background generates a new key.
 */
export interface AddAccountRequest {
  alias: string;
  privkey?: string;
}

export interface RenameAccountRequest {
  currentAlias: string;
  newAlias: string;
}

export interface AccountRequest {
  accountPubkey: string;
}

/** One account's nsec, returned only for the user's explicit reveal or export. */
export interface RevealedSecret {
  nsec: string;
}
