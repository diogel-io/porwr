import { describe, expect, it } from 'vitest';

import type { VaultData } from '@/types/bridge';
import type { Nip47PaymentHistoryEntry } from '@/types/nip47';
import {
  appendNip47PaymentHistory,
  listNip47PaymentHistory,
} from '@/../src-bex/services/nip47-payment-history-store';

function buildEntry(id: string, createdAt: string): Nip47PaymentHistoryEntry {
  return {
    id,
    connectionId: 'wallet-a',
    connectionLabel: 'Wallet A',
    invoicePreview: `invoice-${id}`,
    status: 'succeeded',
    createdAt,
  };
}

describe('nip47-payment-history-store', () => {
  it('lists payment history most-recent first', () => {
    const vaultData: VaultData = {
      accounts: [],
      nip47PaymentHistory: [
        buildEntry('older', '2026-06-01T00:00:00.000Z'),
        buildEntry('newer', '2026-06-10T00:00:00.000Z'),
      ],
    };

    expect(listNip47PaymentHistory(vaultData).map((entry) => entry.id)).toEqual(['newer', 'older']);
  });

  it('returns an empty list when no history exists', () => {
    const vaultData: VaultData = { accounts: [] };

    expect(listNip47PaymentHistory(vaultData)).toEqual([]);
  });

  it('prepends new entries and keeps the list sorted by most-recent first', () => {
    const vaultData: VaultData = {
      accounts: [],
      nip47PaymentHistory: [buildEntry('older', '2026-06-01T00:00:00.000Z')],
    };

    const result = appendNip47PaymentHistory(vaultData, buildEntry('newer', '2026-06-10T00:00:00.000Z'));

    expect(listNip47PaymentHistory(result).map((entry) => entry.id)).toEqual(['newer', 'older']);
  });

  it('caps payment history at 100 entries', () => {
    const existing = Array.from({ length: 100 }, (_, index) =>
      buildEntry(`entry-${index}`, new Date(2026, 0, index + 1).toISOString()),
    );
    const vaultData: VaultData = { accounts: [], nip47PaymentHistory: existing };

    const result = appendNip47PaymentHistory(
      vaultData,
      buildEntry('newest', new Date(2027, 0, 1).toISOString()),
    );

    const history = listNip47PaymentHistory(result);
    expect(history).toHaveLength(100);
    expect(history[0]?.id).toBe('newest');
    expect(history.some((entry) => entry.id === 'entry-0')).toBe(false);
  });
});
