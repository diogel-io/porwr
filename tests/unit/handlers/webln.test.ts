import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleWebLnEnable,
  handleWebLnGetInfo,
  handleWebLnSendPayment,
} from '@/../src-bex/handlers/webln';
import { getVaultData, updateVaultData } from '@/../src-bex/vault';
import { handleNip47PayInvoice } from '@/../src-bex/handlers/nip47';
import type { VaultData } from '@/types/bridge';
import type { Nip47Connection } from '@/types/nip47';

vi.mock('@/../src-bex/vault', () => ({
  getVaultData: vi.fn(),
  updateVaultData: vi.fn(),
}));

vi.mock('@/../src-bex/handlers/nip47', () => ({
  handleNip47PayInvoice: vi.fn(),
}));

function buildConnection(overrides: Partial<Nip47Connection> = {}): Nip47Connection {
  return {
    id: 'wallet-a',
    label: 'Wallet A',
    walletServicePubkey: 'f'.repeat(64),
    clientSecret: 'secret',
    clientPubkey: 'client-pubkey',
    relays: ['wss://relay.example.com'],
    capabilities: ['pay_invoice', 'get_info'],
    createdAt: '2026-06-23T00:00:00.000Z',
    updatedAt: '2026-06-23T00:00:00.000Z',
    isActive: true,
    ...overrides,
  };
}

function mockVault(vaultData: VaultData): void {
  vi.mocked(getVaultData).mockResolvedValue({ success: true, vaultData });
}

describe('WebLN handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateVaultData).mockResolvedValue({ success: true });
  });

  it('enables WebLN access for the active NIP-47 connection', async () => {
    mockVault({ accounts: [], nip47Connections: [buildConnection()] });

    const result = await handleWebLnEnable({ origin: 'https://jumble.social', approved: true });

    expect(result).toEqual({ success: true, data: true });
    expect(updateVaultData).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(updateVaultData).mock.calls[0]?.[0] as VaultData;
    expect(saved.webLnPermissions?.[0]).toMatchObject({
      origin: 'https://jumble.social',
      connectionId: 'wallet-a',
      methods: ['enable', 'getInfo'],
    });
  });

  it('returns WebLN getInfo for an enabled origin', async () => {
    mockVault({
      accounts: [],
      nip47Connections: [buildConnection()],
      webLnPermissions: [{
        origin: 'https://jumble.social',
        connectionId: 'wallet-a',
        methods: ['enable', 'getInfo'],
        createdAt: '2026-06-23T00:00:00.000Z',
      }],
    });

    const result = await handleWebLnGetInfo({ origin: 'https://jumble.social' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.node).toEqual({ alias: 'Wallet A', pubkey: 'f'.repeat(64) });
    }
  });

  it('pays a BOLT11 invoice through the active NIP-47 connection', async () => {
    mockVault({
      accounts: [],
      nip47Connections: [buildConnection()],
      webLnPermissions: [{
        origin: 'https://jumble.social',
        connectionId: 'wallet-a',
        methods: ['enable'],
        createdAt: '2026-06-23T00:00:00.000Z',
      }],
    });
    vi.mocked(handleNip47PayInvoice).mockResolvedValue({
      success: true,
      data: { preimage: 'preimage', raw: {} },
    });

    const result = await handleWebLnSendPayment({
      origin: 'https://jumble.social',
      paymentRequest: 'lnbc1u1pjqxyz',
      approved: true,
    });

    expect(result).toEqual({ success: true, data: { preimage: 'preimage' } });
    expect(handleNip47PayInvoice).toHaveBeenCalledWith({
      connectionId: 'wallet-a',
      invoice: 'lnbc1u1pjqxyz',
    });
  });

  it('rejects sendPayment when WebLN has not been enabled for the origin', async () => {
    mockVault({ accounts: [], nip47Connections: [buildConnection()] });

    await expect(handleWebLnSendPayment({
      origin: 'https://jumble.social',
      paymentRequest: 'lnbc1u1pjqxyz',
      approved: true,
    })).rejects.toThrow('has not been enabled');
  });

  it('rejects wallets that do not advertise pay_invoice support', async () => {
    mockVault({ accounts: [], nip47Connections: [buildConnection({ capabilities: ['get_info'] })] });

    await expect(handleWebLnEnable({ origin: 'https://jumble.social', approved: true })).rejects.toThrow(
      'does not advertise pay_invoice support',
    );
  });
});
