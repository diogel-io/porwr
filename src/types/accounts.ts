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

/**
 * The shortest password Porwr accepts for the vault and for a key export. Enforced in the
 * background as well as offered by the UI (#141).
 */
export const MIN_PASSWORD_LENGTH = 8;

/** Showing one account's nsec. The vault password is asked for again first (#141). */
export interface RevealSecretRequest {
  accountPubkey: string;
  password: string;
}

/** One account's nsec, returned only for the user's explicit "show private key". */
export interface RevealedSecret {
  nsec: string;
}

/** Exporting one account's key, encrypted with a password chosen for the export. */
export interface ExportEncryptedRequest {
  accountPubkey: string;
  password: string;
}

/**
 * An exported key: a NIP-49 `ncryptsec`, which any NIP-49 client can import with the export
 * password, and the public key it belongs to. Never the nsec (#141).
 */
export interface EncryptedKeyExport {
  ncryptsec: string;
  npub: string;
}

/** Importing a NIP-49 `ncryptsec`, decrypted in the background with its password. */
export interface ImportEncryptedRequest {
  ncryptsec: string;
  password: string;
  alias: string;
}

/**
 * The alias of the account a new vault starts with, reserved so no other account can take it.
 * Wallet data from before per-account wallets migrates to the account carrying it (#304).
 */
export const MAIN_ACCOUNT_ALIAS = 'Main Account';
