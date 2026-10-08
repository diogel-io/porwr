import type { VaultData } from '@/types/bridge';
import type { Nip57ZapHistoryEntry } from '@/types/nip57';

export function listNip57ZapHistory(vaultData?: VaultData | null): Nip57ZapHistoryEntry[] {
  return vaultData?.nip57ZapHistory ?? [];
}

export function appendNip57ZapHistory(vaultData: VaultData, entry: Nip57ZapHistoryEntry): VaultData {
  return {
    ...vaultData,
    nip57ZapHistory: [entry, ...listNip57ZapHistory(vaultData)].slice(0, 200),
  };
}
