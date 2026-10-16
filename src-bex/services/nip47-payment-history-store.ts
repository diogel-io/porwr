import type { Nip47PaymentHistoryEntry } from '@/types/nip47';
import type { VaultData } from '@/types/bridge';

const MAX_PAYMENT_HISTORY_ENTRIES = 100;

/** The account's payments, newest first (#304). */
export function listNip47PaymentHistory(vaultData: VaultData, accountPubkey: string): Nip47PaymentHistoryEntry[] {
  return (vaultData.nip47PaymentHistory ?? [])
    .filter((entry) => entry.accountPubkey === accountPubkey)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function appendNip47PaymentHistory(
  vaultData: VaultData,
  entry: Nip47PaymentHistoryEntry,
): VaultData {
  const current = vaultData.nip47PaymentHistory ?? [];
  // Capped per account, not per vault (#304): one account paying often must not push another
  // account's payments out of its history.
  const kept = new Map<string, number>();
  const next = [entry, ...current]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((item) => {
      const count = (kept.get(item.accountPubkey) ?? 0) + 1;
      kept.set(item.accountPubkey, count);
      return count <= MAX_PAYMENT_HISTORY_ENTRIES;
    });

  return {
    ...vaultData,
    nip47PaymentHistory: next,
  };
}
