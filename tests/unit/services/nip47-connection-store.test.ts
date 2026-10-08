import { describe, expect, it } from 'vitest';

import type { VaultData } from '@/types/bridge';
import type { Nip47Command, Nip47Connection } from '@/types/nip47';
import {
  listNip47Connections,
  setActiveNip47Connection,
  upsertNip47Connection,
} from '@/../src-bex/services/nip47-connection-store';

function buildConnection(id: string, isActive: boolean): Nip47Connection {
  return {
    id,
    label: id,
    walletServicePubkey: `${id}-wallet-pubkey`,
    clientSecret: `${id}-secret`,
    clientPubkey: `${id}-client-pubkey`,
    relays: ['wss://relay.example.com/'],
    capabilities: [],
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:00.000Z',
    isActive,
  };
}

describe('nip47-connection-store', () => {
  it('deactivates existing wallet connections when upserting an active connection', () => {
    const vaultData: VaultData = {
      accounts: [],
      nip47Connections: [buildConnection('wallet-a', true)],
    };

    const result = upsertNip47Connection(vaultData, buildConnection('wallet-b', true));

    expect(listNip47Connections(result).map((connection) => ({ id: connection.id, isActive: connection.isActive }))).toEqual([
      { id: 'wallet-a', isActive: false },
      { id: 'wallet-b', isActive: true },
    ]);
  });

  it('preserves the selected active wallet across later metadata upserts', () => {
    const vaultData: VaultData = {
      accounts: [],
      nip47Connections: [
        buildConnection('coinos', true),
        buildConnection('alby', false),
      ],
    };

    const activeResult = setActiveNip47Connection(vaultData, 'alby');
    const albyAfterInfoRefresh: Nip47Connection = {
      ...buildConnection('alby', true),
      capabilities: ['pay_invoice' satisfies Nip47Command],
      updatedAt: '2026-06-14T00:01:00.000Z',
    };

    const result = upsertNip47Connection(activeResult, albyAfterInfoRefresh);

    expect(listNip47Connections(result).map((connection) => ({ id: connection.id, isActive: connection.isActive }))).toEqual([
      { id: 'coinos', isActive: false },
      { id: 'alby', isActive: true },
    ]);
  });

  it('marks exactly one wallet connection active', () => {
    const vaultData: VaultData = {
      accounts: [],
      nip47Connections: [
        buildConnection('wallet-a', true),
        buildConnection('wallet-b', false),
        buildConnection('wallet-c', false),
      ],
    };

    const result = setActiveNip47Connection(vaultData, 'wallet-c');

    expect(listNip47Connections(result).map((connection) => ({ id: connection.id, isActive: connection.isActive }))).toEqual([
      { id: 'wallet-a', isActive: false },
      { id: 'wallet-b', isActive: false },
      { id: 'wallet-c', isActive: true },
    ]);
  });

  it('rejects setting an unknown wallet connection active', () => {
    const vaultData: VaultData = {
      accounts: [],
      nip47Connections: [buildConnection('wallet-a', true)],
    };

    expect(() => setActiveNip47Connection(vaultData, 'missing-wallet')).toThrow('NIP-47 connection not found');
  });
});
