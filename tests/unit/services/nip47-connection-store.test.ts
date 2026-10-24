import { describe, expect, it } from 'vitest';

import type { VaultData } from '@/types/bridge';
import type { Nip47Command, Nip47Connection } from '@/types/nip47';
import {
  findActiveNip47Connection,
  findNip47Connection,
  listNip47Connections,
  removeAccountWalletData,
  removeNip47Connection,
  setActiveNip47Connection,
  upsertNip47Connection,
} from '@/../src-bex/services/nip47-connection-store';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

function buildConnection(
  id: string,
  isActive: boolean,
  accountPubkey: string = ALICE,
): Nip47Connection {
  return {
    id,
    accountPubkey,
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

const states = (vaultData: VaultData, account: string = ALICE) =>
  listNip47Connections(vaultData, account).map((connection) => ({
    id: connection.id,
    isActive: connection.isActive,
  }));

describe('nip47-connection-store', () => {
  it('deactivates existing wallet connections when upserting an active connection', () => {
    const vaultData: VaultData = {
      accounts: [],
      nip47Connections: [buildConnection('wallet-a', true)],
    };

    const result = upsertNip47Connection(vaultData, buildConnection('wallet-b', true));

    expect(states(result)).toEqual([
      { id: 'wallet-a', isActive: false },
      { id: 'wallet-b', isActive: true },
    ]);
  });

  it('preserves the selected active wallet across later metadata upserts', () => {
    const vaultData: VaultData = {
      accounts: [],
      nip47Connections: [buildConnection('coinos', true), buildConnection('alby', false)],
    };

    const activeResult = setActiveNip47Connection(vaultData, ALICE, 'alby');
    const albyAfterInfoRefresh: Nip47Connection = {
      ...buildConnection('alby', true),
      capabilities: ['pay_invoice' satisfies Nip47Command],
      updatedAt: '2026-06-14T00:01:00.000Z',
    };

    const result = upsertNip47Connection(activeResult, albyAfterInfoRefresh);

    expect(states(result)).toEqual([
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

    const result = setActiveNip47Connection(vaultData, ALICE, 'wallet-c');

    expect(states(result)).toEqual([
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

    expect(() => setActiveNip47Connection(vaultData, ALICE, 'missing-wallet')).toThrow(
      'NIP-47 connection not found',
    );
  });
});

describe('one account’s wallets are not another’s (#304)', () => {
  const vaultData: VaultData = {
    accounts: [],
    nip47Connections: [
      buildConnection('alice-wallet', true, ALICE),
      buildConnection('bob-wallet', true, BOB),
    ],
  };

  it('lists and finds only the named account’s connections', () => {
    expect(states(vaultData, ALICE)).toEqual([{ id: 'alice-wallet', isActive: true }]);
    expect(states(vaultData, BOB)).toEqual([{ id: 'bob-wallet', isActive: true }]);
    expect(findNip47Connection(vaultData, BOB, 'alice-wallet')).toBeUndefined();
    expect(findActiveNip47Connection(vaultData, BOB)?.id).toBe('bob-wallet');
  });

  it('keeps one active connection per account, not per vault', () => {
    const result = upsertNip47Connection(vaultData, buildConnection('alice-second', true, ALICE));

    expect(findActiveNip47Connection(result, ALICE)?.id).toBe('alice-second');
    expect(findActiveNip47Connection(result, BOB)?.id).toBe('bob-wallet');
  });

  it('will not activate another account’s connection', () => {
    expect(() => setActiveNip47Connection(vaultData, BOB, 'alice-wallet')).toThrow(
      'NIP-47 connection not found',
    );
  });

  it('removes a connection only from the account named', () => {
    const result = removeNip47Connection(vaultData, BOB, 'alice-wallet');

    expect(states(result, ALICE)).toEqual([{ id: 'alice-wallet', isActive: true }]);
  });

  // A site's permission to use a wallet goes with the wallet (#139).
  it('removes the WebLN permissions keyed to a removed connection', () => {
    const withPermissions: VaultData = {
      ...vaultData,
      webLnPermissions: [
        {
          origin: 'https://one.example',
          connectionId: 'alice-wallet',
          methods: ['enable'],
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          origin: 'https://one.example',
          connectionId: 'bob-wallet',
          methods: ['enable'],
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };

    const result = removeNip47Connection(withPermissions, ALICE, 'alice-wallet');

    expect(result.webLnPermissions).toEqual([
      {
        origin: 'https://one.example',
        connectionId: 'bob-wallet',
        methods: ['enable'],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('keeps the permissions of a connection another account still holds', () => {
    const shared: VaultData = {
      accounts: [],
      nip47Connections: [
        buildConnection('same-id', true, ALICE),
        buildConnection('same-id', true, BOB),
      ],
      webLnPermissions: [
        {
          origin: 'https://one.example',
          connectionId: 'same-id',
          methods: ['enable'],
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };

    const result = removeNip47Connection(shared, ALICE, 'same-id');

    expect(result.webLnPermissions).toEqual(shared.webLnPermissions);
    expect(removeNip47Connection(result, BOB, 'same-id').webLnPermissions).toEqual([]);
  });

  it('leaves permissions alone when no connection was removed', () => {
    const withPermissions: VaultData = {
      ...vaultData,
      webLnPermissions: [
        {
          origin: 'https://one.example',
          connectionId: 'alice-wallet',
          methods: ['enable'],
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };

    expect(removeNip47Connection(withPermissions, BOB, 'alice-wallet').webLnPermissions).toEqual(
      withPermissions.webLnPermissions,
    );
  });

  it('keeps each account’s record when two accounts import the same connection string', () => {
    const shared = upsertNip47Connection(
      { accounts: [], nip47Connections: [buildConnection('same-id', true, ALICE)] },
      buildConnection('same-id', true, BOB),
    );

    expect(states(shared, ALICE)).toEqual([{ id: 'same-id', isActive: true }]);
    expect(states(shared, BOB)).toEqual([{ id: 'same-id', isActive: true }]);
  });
});

describe('removeAccountWalletData (#304)', () => {
  const vaultData: VaultData = {
    accounts: [],
    nip47Connections: [
      buildConnection('alice-wallet', true, ALICE),
      buildConnection('bob-wallet', true, BOB),
      buildConnection('shared', false, ALICE),
      buildConnection('shared', false, BOB),
    ],
    nip47PaymentHistory: [
      {
        id: 'p1',
        accountPubkey: ALICE,
        connectionId: 'alice-wallet',
        connectionLabel: '',
        invoicePreview: '',
        status: 'succeeded',
        createdAt: '2026-01-01',
      },
      {
        id: 'p2',
        accountPubkey: BOB,
        connectionId: 'bob-wallet',
        connectionLabel: '',
        invoicePreview: '',
        status: 'succeeded',
        createdAt: '2026-01-02',
      },
    ],
    webLnPermissions: [
      {
        origin: 'https://a.example',
        connectionId: 'alice-wallet',
        methods: ['enable'],
        createdAt: '2026-01-01',
      },
      {
        origin: 'https://b.example',
        connectionId: 'bob-wallet',
        methods: ['enable'],
        createdAt: '2026-01-01',
      },
      {
        origin: 'https://s.example',
        connectionId: 'shared',
        methods: ['enable'],
        createdAt: '2026-01-01',
      },
    ],
  };

  it('drops the account’s connections, payments and grants, and nobody else’s', () => {
    const result = removeAccountWalletData(vaultData, ALICE);

    expect(
      result.nip47Connections?.map(
        (item) => `${item.accountPubkey === BOB ? 'bob' : 'alice'}:${item.id}`,
      ),
    ).toEqual(['bob:bob-wallet', 'bob:shared']);
    expect(result.nip47PaymentHistory?.map((item) => item.id)).toEqual(['p2']);
    // `shared` is still Bob's, so the grant on it stays.
    expect(result.webLnPermissions?.map((item) => item.connectionId)).toEqual([
      'bob-wallet',
      'shared',
    ]);
  });
});
