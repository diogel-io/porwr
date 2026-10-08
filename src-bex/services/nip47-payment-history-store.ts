import type { Nip47PaymentHistoryEntry } from '@/types/nip47';
import type { VaultData } from '@/types/bridge';

const MAX_PAYMENT_HISTORY_ENTRIES = 100;

export function listNip47PaymentHistory(vaultData: VaultData): Nip47PaymentHistoryEntry[] {
  return [...(vaultData.nip47PaymentHistory ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function appendNip47PaymentHistory(
  vaultData: VaultData,
  entry: Nip47PaymentHistoryEntry,
): VaultData {
  const current = vaultData.nip47PaymentHistory ?? [];
  const next = [entry, ...current]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_PAYMENT_HISTORY_ENTRIES);

  return {
    ...vaultData,
    nip47PaymentHistory: next,
  };
}
