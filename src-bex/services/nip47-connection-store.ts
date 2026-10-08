import type { Nip47Connection, Nip47ConnectionSummary } from '@/types/nip47';
import type { VaultData } from '@/types/bridge';

export function summarizeNip47Connection(connection: Nip47Connection): Nip47ConnectionSummary {
  const { clientSecret: _clientSecret, ...safeConnection } = connection;
  void _clientSecret;
  return {
    ...safeConnection,
    hasClientSecret: connection.clientSecret.length > 0,
  };
}

export function listNip47Connections(vaultData?: VaultData | null): Nip47Connection[] {
  return vaultData?.nip47Connections ?? [];
}

export function upsertNip47Connection(vaultData: VaultData, connection: Nip47Connection): VaultData {
  const existing = listNip47Connections(vaultData);
  const withoutConnection = existing
    .filter((item) => item.id !== connection.id)
    .map((item) => ({
      ...item,
      isActive: connection.isActive ? false : item.isActive,
    }));
  return {
    ...vaultData,
    nip47Connections: [...withoutConnection, connection],
  };
}

export function setActiveNip47Connection(vaultData: VaultData, connectionId: string): VaultData {
  const connections = listNip47Connections(vaultData);
  const hasConnection = connections.some((item) => item.id === connectionId);
  if (!hasConnection) {
    throw new Error('NIP-47 connection not found');
  }

  return {
    ...vaultData,
    nip47Connections: connections.map((item) => ({
      ...item,
      isActive: item.id === connectionId,
      updatedAt: item.id === connectionId ? new Date().toISOString() : item.updatedAt,
    })),
  };
}

export function removeNip47Connection(vaultData: VaultData, connectionId: string): VaultData {
  return {
    ...vaultData,
    nip47Connections: listNip47Connections(vaultData).filter((item) => item.id !== connectionId),
  };
}

export function findNip47Connection(vaultData: VaultData, connectionId: string): Nip47Connection | undefined {
  return listNip47Connections(vaultData).find((item) => item.id === connectionId);
}
