import type { Nip47Connection } from '@/types/nip47';
import type { VaultData } from '@/types/bridge';
import { MAIN_ACCOUNT_ALIAS } from '@/types/accounts';

/**
 * Gives wallet data from before #304 an owner.
 *
 * Vaults from 0.2.x hold connections and payment history with no account: one wallet shared by
 * every account. The decision on #304 is that it all goes to the main account, and every other
 * account starts with no wallet.
 *
 * Applied lazily, at the start of each wallet action, rather than on unlock: a worker that restores
 * an unlocked session does not run the unlock listeners, so a migration hung there could be missed
 * for as long as the browser stays open. Stamping a pubkey rather than resolving "main" on every
 * read means a later rename or new account cannot move the data again.
 */

/** The account aliased "Main Account", or the vault's first account, or null for an empty vault. */
export function mainAccountPubkey(vaultData: VaultData): string | null {
  const accounts = vaultData.accounts ?? [];
  return (accounts.find((account) => account.alias === MAIN_ACCOUNT_ALIAS) ?? accounts[0])?.id ?? null;
}

const isUnowned = (item: { accountPubkey?: string }): boolean =>
  typeof item.accountPubkey !== 'string' || item.accountPubkey.length === 0;

/**
 * Keeps only the most recently updated active connection on an account that ends up with several.
 *
 * Only possible straight after migration, since the old single-active rule held vault-wide; but
 * a wallet action must never have two active connections to choose between.
 */
function oneActivePerAccount(connections: Nip47Connection[]): Nip47Connection[] {
  const winner = new Map<string, Nip47Connection>();
  for (const connection of connections) {
    if (!connection.isActive) continue;
    const current = winner.get(connection.accountPubkey);
    if (!current || connection.updatedAt > current.updatedAt) winner.set(connection.accountPubkey, connection);
  }
  return connections.map((connection) =>
    connection.isActive && winner.get(connection.accountPubkey) !== connection
      ? { ...connection, isActive: false }
      : connection,
  );
}

/**
 * The vault with every unowned connection and payment assigned to the main account.
 *
 * Idempotent, and returns the very same object when there is nothing to assign, so the caller's
 * `mutateVault` writes nothing. With no accounts at all the data stays unowned: there is no one to
 * give it to, and nothing can reach it until there is.
 */
export function assignUnownedWalletData(vaultData: VaultData): VaultData {
  const connections = vaultData.nip47Connections ?? [];
  const history = vaultData.nip47PaymentHistory ?? [];
  if (!connections.some(isUnowned) && !history.some(isUnowned)) return vaultData;

  const owner = mainAccountPubkey(vaultData);
  if (!owner) return vaultData;

  return {
    ...vaultData,
    nip47Connections: oneActivePerAccount(
      connections.map((item) => (isUnowned(item) ? { ...item, accountPubkey: owner } : item)),
    ),
    nip47PaymentHistory: history.map((item) => (isUnowned(item) ? { ...item, accountPubkey: owner } : item)),
  };
}
