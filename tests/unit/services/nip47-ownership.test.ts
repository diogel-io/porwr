import { describe, expect, it } from 'vitest';

import type { StoredKey, VaultData } from '@/types/bridge';
import type { Nip47Connection, Nip47PaymentHistoryEntry } from '@/types/nip47';
import { assignUnownedWalletData, mainAccountPubkey } from '@/../src-bex/services/nip47-ownership';

/**
 * Wallet data from 0.2.x has no account; on upgrade it all goes to the main account (#304).
 */

const MAIN = 'a'.repeat(64);
const WORK = 'b'.repeat(64);

const account = (id: string, alias: string): StoredKey => ({
  id,
  alias,
  account: { privkey: '1'.repeat(64) },
  createdAt: '2026-01-01T00:00:00.000Z',
});

/** A connection as 0.2.x stored it: no `accountPubkey`. */
function legacyConnection(
  id: string,
  isActive: boolean,
  updatedAt = '2026-06-14T00:00:00.000Z',
): Nip47Connection {
  return {
    id,
    label: id,
    walletServicePubkey: `${id}-wallet`,
    clientSecret: `${id}-secret`,
    clientPubkey: `${id}-client`,
    relays: ['wss://relay.example.com/'],
    capabilities: [],
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt,
    isActive,
  } as unknown as Nip47Connection;
}

const legacyPayment = (id: string): Nip47PaymentHistoryEntry =>
  ({
    id,
    connectionId: 'wallet',
    connectionLabel: 'wallet',
    invoicePreview: 'lnbc…',
    status: 'succeeded',
    createdAt: '2026-06-14T00:00:00.000Z',
  }) as unknown as Nip47PaymentHistoryEntry;

describe('mainAccountPubkey', () => {
  it('is the account aliased Main Account, wherever it sits', () => {
    expect(
      mainAccountPubkey({ accounts: [account(WORK, 'work'), account(MAIN, 'Main Account')] }),
    ).toBe(MAIN);
  });

  it('falls back to the first account when none carries the alias', () => {
    expect(
      mainAccountPubkey({ accounts: [account(WORK, 'work'), account(MAIN, 'personal')] }),
    ).toBe(WORK);
  });

  it('is null for a vault with no accounts', () => {
    expect(mainAccountPubkey({ accounts: [] })).toBeNull();
  });
});

describe('assignUnownedWalletData', () => {
  it('gives every unowned connection and payment to the main account', () => {
    const vault: VaultData = {
      accounts: [account(WORK, 'work'), account(MAIN, 'Main Account')],
      nip47Connections: [legacyConnection('wallet', true)],
      nip47PaymentHistory: [legacyPayment('p1')],
    };

    const migrated = assignUnownedWalletData(vault);

    expect(migrated.nip47Connections?.[0]?.accountPubkey).toBe(MAIN);
    expect(migrated.nip47PaymentHistory?.[0]?.accountPubkey).toBe(MAIN);
    // Pure: the vault it was given is untouched.
    expect(vault.nip47Connections?.[0]).not.toHaveProperty('accountPubkey');
  });

  it('returns the very same vault when nothing is unowned, so nothing is written', () => {
    const vault: VaultData = {
      accounts: [account(MAIN, 'Main Account')],
      nip47Connections: [{ ...legacyConnection('wallet', true), accountPubkey: WORK }],
    };

    expect(assignUnownedWalletData(vault)).toBe(vault);
    expect(assignUnownedWalletData({ accounts: [] })).toEqual({ accounts: [] });
  });

  it('is idempotent', () => {
    const vault: VaultData = {
      accounts: [account(MAIN, 'Main Account')],
      nip47Connections: [legacyConnection('wallet', true)],
    };

    const once = assignUnownedWalletData(vault);

    expect(assignUnownedWalletData(once)).toBe(once);
  });

  it('leaves data unowned while there is no account to give it to', () => {
    const vault: VaultData = { accounts: [], nip47Connections: [legacyConnection('wallet', true)] };

    expect(assignUnownedWalletData(vault)).toBe(vault);
  });

  it('never moves data that already has an owner', () => {
    const vault: VaultData = {
      accounts: [account(MAIN, 'Main Account'), account(WORK, 'work')],
      nip47Connections: [
        legacyConnection('legacy', false),
        { ...legacyConnection('work', true), accountPubkey: WORK },
      ],
    };

    const migrated = assignUnownedWalletData(vault);

    expect(migrated.nip47Connections?.map((item) => [item.id, item.accountPubkey])).toEqual([
      ['legacy', MAIN],
      ['work', WORK],
    ]);
  });

  it('leaves the main account with one active connection, the most recently updated', () => {
    const vault: VaultData = {
      accounts: [account(MAIN, 'Main Account')],
      nip47Connections: [
        legacyConnection('older', true, '2026-06-01T00:00:00.000Z'),
        legacyConnection('newer', true, '2026-06-10T00:00:00.000Z'),
      ],
    };

    const migrated = assignUnownedWalletData(vault);

    expect(
      migrated.nip47Connections?.filter((item) => item.isActive).map((item) => item.id),
    ).toEqual(['newer']);
  });
});
