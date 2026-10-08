import { describe, expect, it, vi, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/unbound-method */

import {
  handleNip47ConnectionImport,
  handleNip47ConnectionRemove,
  handleNip47ConnectionSetActive,
  handleNip47ConnectionsList,
  handleNip47GetBalance,
  handleNip47GetInfo,
  handleNip47PayInvoice,
  handleNip47PaymentHistoryList,
} from '@/../src-bex/handlers/nip47';
import { getVaultData, updateVaultData } from '@/../src-bex/vault';
import { nip47Client } from '@/../src-bex/services/nip47-client';
import { parseNwcUri, buildNip47ConnectionId } from '@/services/nip47-uri';
import { listNip47PaymentHistory } from '@/../src-bex/services/nip47-payment-history-store';
import type { VaultData } from '@/types/bridge';
import type { Nip47Connection } from '@/types/nip47';

vi.mock('@/../src-bex/vault', () => ({
  getVaultData: vi.fn(),
  updateVaultData: vi.fn(),
}));

vi.mock('@/../src-bex/services/nip47-client', () => ({
  nip47Client: {
    payInvoice: vi.fn(),
    getInfo: vi.fn(),
    getBalance: vi.fn(),
  },
}));

vi.mock('@/services/nip47-uri', () => ({
  parseNwcUri: vi.fn(),
  buildNip47ConnectionId: vi.fn(),
}));

vi.mock('@/../src-bex/services/nip47-payment-history-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/../src-bex/services/nip47-payment-history-store')>();
  return {
    ...actual,
    listNip47PaymentHistory: vi.fn(actual.listNip47PaymentHistory),
  };
});

function buildConnection(overrides: Partial<Nip47Connection> = {}): Nip47Connection {
  return {
    id: 'wallet-a',
    label: 'Wallet A',
    walletServicePubkey: 'wallet-a-wallet-pubkey',
    clientSecret: 'wallet-a-secret',
    clientPubkey: 'wallet-a-client-pubkey',
    relays: ['wss://relay.example.com/'],
    capabilities: ['pay_invoice', 'get_balance'],
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:00.000Z',
    isActive: true,
    ...overrides,
  };
}

const INVOICE = 'lnbc1u1pjqxyz';

describe('handleNip47PayInvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.crypto.randomUUID = vi.fn(() => 'history-entry-id') as () => `${string}-${string}-${string}-${string}-${string}`;
    vi.mocked(updateVaultData).mockResolvedValue({ success: true });
  });

  function mockVault(connection: Nip47Connection): VaultData {
    const vaultData: VaultData = { accounts: [], nip47Connections: [connection] };
    vi.mocked(getVaultData).mockResolvedValue({ success: true, vaultData });
    return vaultData;
  }

  it('pays the invoice and records a successful payment history entry', async () => {
    mockVault(buildConnection());
    vi.mocked(nip47Client.payInvoice).mockResolvedValue({
      preimage: 'preimage',
      paymentHash: 'hash',
      feesPaidMsat: 5,
      raw: {},
    });

    const result = await handleNip47PayInvoice({ connectionId: 'wallet-a', invoice: INVOICE });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.preimage).toBe('preimage');
    }

    expect(updateVaultData).toHaveBeenCalledTimes(1);
    const savedVaultData = vi.mocked(updateVaultData).mock.calls[0]?.[0] as VaultData;
    expect(savedVaultData.nip47PaymentHistory?.[0]).toMatchObject({
      connectionId: 'wallet-a',
      status: 'succeeded',
      paymentHash: 'hash',
      feesPaidMsat: 5,
    });
  });

  it('records a failed payment history entry when the wallet rejects the payment', async () => {
    mockVault(buildConnection());
    vi.mocked(nip47Client.payInvoice).mockRejectedValue(new Error('PAYMENT_FAILED: insufficient balance'));

    await expect(handleNip47PayInvoice({ connectionId: 'wallet-a', invoice: INVOICE })).rejects.toThrow(
      'PAYMENT_FAILED: insufficient balance',
    );

    expect(updateVaultData).toHaveBeenCalledTimes(1);
    const savedVaultData = vi.mocked(updateVaultData).mock.calls[0]?.[0] as VaultData;
    expect(savedVaultData.nip47PaymentHistory?.[0]).toMatchObject({
      connectionId: 'wallet-a',
      status: 'failed',
      error: 'PAYMENT_FAILED: insufficient balance',
    });
  });

  it('rejects payment when the connection does not advertise pay_invoice support', async () => {
    mockVault(buildConnection({ capabilities: ['get_balance'] }));

    await expect(handleNip47PayInvoice({ connectionId: 'wallet-a', invoice: INVOICE })).rejects.toThrow(
      'does not advertise pay_invoice support',
    );

    expect(nip47Client.payInvoice).not.toHaveBeenCalled();
    expect(updateVaultData).not.toHaveBeenCalled();
  });

  it('allows payment when capabilities are unknown (empty)', async () => {
    mockVault(buildConnection({ capabilities: [] }));
    vi.mocked(nip47Client.payInvoice).mockResolvedValue({ preimage: 'preimage', raw: {} });

    const result = await handleNip47PayInvoice({ connectionId: 'wallet-a', invoice: INVOICE });

    expect(result.success).toBe(true);
    expect(nip47Client.payInvoice).toHaveBeenCalled();
  });

  it('throws when the connection cannot be found', async () => {
    mockVault(buildConnection());

    await expect(handleNip47PayInvoice({ connectionId: 'missing-wallet', invoice: INVOICE })).rejects.toThrow(
      'NIP-47 connection not found',
    );
  });
});

describe('handleNip47ConnectionsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('summarizes all connections, stripping the client secret', async () => {
    vi.mocked(getVaultData).mockResolvedValue({
      success: true,
      vaultData: { accounts: [], nip47Connections: [buildConnection()] },
    });

    const result = await handleNip47ConnectionsList();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({ id: 'wallet-a', hasClientSecret: true });
      expect(result.data[0]).not.toHaveProperty('clientSecret');
    }
  });

  it('returns an empty list when the vault has no connections', async () => {
    vi.mocked(getVaultData).mockResolvedValue({ success: true, vaultData: { accounts: [] } });

    const result = await handleNip47ConnectionsList();

    expect(result).toEqual({ success: true, data: [] });
  });
});

describe('handleNip47ConnectionImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateVaultData).mockResolvedValue({ success: true });
    vi.mocked(parseNwcUri).mockReturnValue({
      walletServicePubkey: 'wallet-service-pubkey',
      clientSecret: 'aa'.repeat(32),
      relays: ['wss://relay.example.com/'],
    });
    vi.mocked(buildNip47ConnectionId).mockReturnValue('nip47:wallet-service-pubkey:client-pubkey');
  });

  it('creates a new connection from a parsed NWC URI', async () => {
    vi.mocked(getVaultData).mockResolvedValue({ success: true, vaultData: { accounts: [] } });

    const result = await handleNip47ConnectionImport({ uri: 'nostr+walletconnect://...', label: 'My Wallet' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        id: 'nip47:wallet-service-pubkey:client-pubkey',
        label: 'My Wallet',
        isActive: true,
        capabilities: [],
      });
      expect(result.data).not.toHaveProperty('clientSecret');
    }
    expect(updateVaultData).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(updateVaultData).mock.calls[0]?.[0] as VaultData;
    expect(saved.nip47Connections).toHaveLength(1);
  });

  it('preserves capabilities and createdAt when re-importing an existing connection', async () => {
    const existing = buildConnection({
      id: 'nip47:wallet-service-pubkey:client-pubkey',
      capabilities: ['pay_invoice'],
      createdAt: '2020-01-01T00:00:00.000Z',
    });
    vi.mocked(getVaultData).mockResolvedValue({
      success: true,
      vaultData: { accounts: [], nip47Connections: [existing] },
    });

    const result = await handleNip47ConnectionImport({ uri: 'nostr+walletconnect://...' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capabilities).toEqual(['pay_invoice']);
      expect(result.data.createdAt).toBe('2020-01-01T00:00:00.000Z');
      // No label was given, so it falls back to the existing label.
      expect(result.data.label).toBe(existing.label);
    }
  });
});

describe('handleNip47ConnectionRemove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateVaultData).mockResolvedValue({ success: true });
  });

  it('removes the connection and persists the vault', async () => {
    vi.mocked(getVaultData).mockResolvedValue({
      success: true,
      vaultData: { accounts: [], nip47Connections: [buildConnection()] },
    });

    const result = await handleNip47ConnectionRemove({ connectionId: 'wallet-a' });

    expect(result).toEqual({ success: true, data: true });
    const saved = vi.mocked(updateVaultData).mock.calls[0]?.[0] as VaultData;
    expect(saved.nip47Connections).toEqual([]);
  });
});

describe('handleNip47ConnectionSetActive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateVaultData).mockResolvedValue({ success: true });
  });

  it('activates the target connection and deactivates the rest', async () => {
    const other = buildConnection({ id: 'wallet-b', isActive: true });
    const target = buildConnection({ id: 'wallet-a', isActive: false });
    vi.mocked(getVaultData).mockResolvedValue({
      success: true,
      vaultData: { accounts: [], nip47Connections: [other, target] },
    });

    const result = await handleNip47ConnectionSetActive({ connectionId: 'wallet-a' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('wallet-a');
    }
    const saved = vi.mocked(updateVaultData).mock.calls[0]?.[0] as VaultData;
    expect(saved.nip47Connections?.find((c) => c.id === 'wallet-a')?.isActive).toBe(true);
    expect(saved.nip47Connections?.find((c) => c.id === 'wallet-b')?.isActive).toBe(false);
  });

  it('rejects when the connection does not exist', async () => {
    vi.mocked(getVaultData).mockResolvedValue({ success: true, vaultData: { accounts: [] } });

    await expect(handleNip47ConnectionSetActive({ connectionId: 'missing' })).rejects.toThrow(
      'NIP-47 connection not found',
    );
  });
});

describe('handleNip47GetInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateVaultData).mockResolvedValue({ success: true });
  });

  it('fetches wallet info and persists updated capabilities', async () => {
    vi.mocked(getVaultData).mockResolvedValue({
      success: true,
      vaultData: { accounts: [], nip47Connections: [buildConnection()] },
    });
    vi.mocked(nip47Client.getInfo).mockResolvedValue({
      capabilities: ['pay_invoice', 'get_balance'],
      checkedAt: '2026-06-14T00:00:00.000Z',
    } as never);

    const result = await handleNip47GetInfo({ connectionId: 'wallet-a' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capabilities).toEqual(['pay_invoice', 'get_balance']);
    }
    const saved = vi.mocked(updateVaultData).mock.calls[0]?.[0] as VaultData;
    expect(saved.nip47Connections?.[0]).toMatchObject({ capabilities: ['pay_invoice', 'get_balance'] });
  });

  it('rejects when the connection does not exist', async () => {
    vi.mocked(getVaultData).mockResolvedValue({ success: true, vaultData: { accounts: [] } });

    await expect(handleNip47GetInfo({ connectionId: 'missing' })).rejects.toThrow('NIP-47 connection not found');
  });
});

describe('handleNip47GetBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the wallet balance for an existing connection', async () => {
    vi.mocked(getVaultData).mockResolvedValue({
      success: true,
      vaultData: { accounts: [], nip47Connections: [buildConnection()] },
    });
    vi.mocked(nip47Client.getBalance).mockResolvedValue({ balanceMsat: 100_000 } as never);

    const result = await handleNip47GetBalance({ connectionId: 'wallet-a' });

    expect(result).toEqual({ success: true, data: { balanceMsat: 100_000 } });
  });

  it('rejects when the connection does not exist', async () => {
    vi.mocked(getVaultData).mockResolvedValue({ success: true, vaultData: { accounts: [] } });

    await expect(handleNip47GetBalance({ connectionId: 'missing' })).rejects.toThrow('NIP-47 connection not found');
  });
});

describe('handleNip47PaymentHistoryList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the payment history for the unlocked vault', async () => {
    const vaultData: VaultData = { accounts: [], nip47PaymentHistory: [] };
    vi.mocked(getVaultData).mockResolvedValue({ success: true, vaultData });

    const result = await handleNip47PaymentHistoryList();

    expect(result).toEqual({ success: true, data: [] });
    expect(listNip47PaymentHistory).toHaveBeenCalledWith(vaultData);
  });
});
