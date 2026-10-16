import type { Nip47Connection, Nip47ConnectionSummary } from '@/types/nip47';
import type { VaultData } from '@/types/bridge';

/**
 * Wallet connections, each belonging to one account (#304).
 *
 * Every read and change names the account. A connection id alone is not enough: before #304 the
 * list was vault-wide with one active flag, so every account paid through the same wallet. Each
 * account now has its own connections and at most one active connection among them.
 */

export function summarizeNip47Connection(connection: Nip47Connection): Nip47ConnectionSummary {
  const { clientSecret: _clientSecret, ...safeConnection } = connection;
  void _clientSecret;
  return {
    ...safeConnection,
    hasClientSecret: connection.clientSecret.length > 0,
  };
}

/** Every connection in the vault, whoever owns it. For migration and cleanup only. */
export function listAllNip47Connections(vaultData?: VaultData | null): Nip47Connection[] {
  return vaultData?.nip47Connections ?? [];
}

export function listNip47Connections(vaultData: VaultData | null | undefined, accountPubkey: string): Nip47Connection[] {
  return listAllNip47Connections(vaultData).filter((item) => item.accountPubkey === accountPubkey);
}

export function findActiveNip47Connection(vaultData: VaultData, accountPubkey: string): Nip47Connection | undefined {
  return listNip47Connections(vaultData, accountPubkey).find((item) => item.isActive);
}

/**
 * Adds or replaces a connection. Making it active deactivates only the same account's others.
 *
 * Matched on id and account together: two accounts can hold connections to the same wallet service
 * and, with an imported string, even the same client key. Each is that account's own record.
 */
export function upsertNip47Connection(vaultData: VaultData, connection: Nip47Connection): VaultData {
  const others = listAllNip47Connections(vaultData)
    .filter((item) => !(item.id === connection.id && item.accountPubkey === connection.accountPubkey))
    .map((item) => ({
      ...item,
      isActive: connection.isActive && item.accountPubkey === connection.accountPubkey ? false : item.isActive,
    }));
  return {
    ...vaultData,
    nip47Connections: [...others, connection],
  };
}

export function setActiveNip47Connection(vaultData: VaultData, accountPubkey: string, connectionId: string): VaultData {
  if (!findNip47Connection(vaultData, accountPubkey, connectionId)) {
    throw new Error('NIP-47 connection not found');
  }

  return {
    ...vaultData,
    nip47Connections: listAllNip47Connections(vaultData).map((item) => {
      if (item.accountPubkey !== accountPubkey) return item;
      const isTarget = item.id === connectionId;
      return {
        ...item,
        isActive: isTarget,
        updatedAt: isTarget ? new Date().toISOString() : item.updatedAt,
      };
    }),
  };
}

export function removeNip47Connection(vaultData: VaultData, accountPubkey: string, connectionId: string): VaultData {
  return {
    ...vaultData,
    nip47Connections: listAllNip47Connections(vaultData).filter(
      (item) => !(item.id === connectionId && item.accountPubkey === accountPubkey),
    ),
  };
}

/** One of the account's connections. Another account's connection is not found, by design. */
export function findNip47Connection(
  vaultData: VaultData,
  accountPubkey: string,
  connectionId: string,
): Nip47Connection | undefined {
  return listNip47Connections(vaultData, accountPubkey).find((item) => item.id === connectionId);
}

/**
 * Drops everything wallet-related an account held: its connections, the WebLN grants made on them,
 * and its payment history. Run with the account's own removal, in the same vault write.
 *
 * A grant is matched on connection id only when no other account still holds that id, so removing
 * one account can never revoke another's grant.
 */
export function removeAccountWalletData(vaultData: VaultData, accountPubkey: string): VaultData {
  const all = listAllNip47Connections(vaultData);
  const kept = all.filter((item) => item.accountPubkey !== accountPubkey);
  const keptIds = new Set(kept.map((item) => item.id));
  const removedIds = new Set(
    all.filter((item) => item.accountPubkey === accountPubkey && !keptIds.has(item.id)).map((item) => item.id),
  );

  return {
    ...vaultData,
    nip47Connections: kept,
    nip47PaymentHistory: (vaultData.nip47PaymentHistory ?? []).filter((entry) => entry.accountPubkey !== accountPubkey),
    webLnPermissions: (vaultData.webLnPermissions ?? []).filter((grant) => !removedIds.has(grant.connectionId)),
  };
}
