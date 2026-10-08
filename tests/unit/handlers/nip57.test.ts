import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VaultData } from '@/types/bridge';
import type { Nip47Connection } from '@/types/nip47';
import type { SendZapRequest } from '@/types/nip57';
import { ErrorCode } from '@/types/error-codes.d';

/* eslint-disable @typescript-eslint/unbound-method */

vi.mock('@/../src-bex/vault', () => ({
  getVaultData: vi.fn(),
  updateVaultData: vi.fn(),
  isVaultUnlocked: vi.fn(() => true),
}));

vi.mock('@/services/storage-service', () => ({
  NOSTR_ACTIVE: 'NOSTR_ACTIVE',
  SITE_BINDINGS_KEY: 'nostr:site-bindings',
  storageService: { get: vi.fn(), set: vi.fn(() => Promise.resolve()) },
}));

vi.mock('@/services/log-service', () => ({
  LogLevel: { INFO: 'info' },
  logService: { log: vi.fn() },
}));

vi.mock('@/../src-bex/services/nip47-connection-store', () => ({
  findNip47Connection: vi.fn(),
  listNip47Connections: vi.fn(),
}));

vi.mock('@/../src-bex/services/nip47-client', () => ({
  nip47Client: { payInvoice: vi.fn() },
}));

vi.mock('@/../src-bex/services/nip57-zap-history-store', () => ({
  appendNip57ZapHistory: vi.fn((vaultData: VaultData) => vaultData),
  listNip57ZapHistory: vi.fn(),
}));

vi.mock('@/services/nip57-lnurl', () => ({
  assertLnurlAmount: vi.fn(),
  fetchLnurlPayTarget: vi.fn(),
  requestZapInvoice: vi.fn(),
}));

vi.mock('@/services/nip57-zap-request', () => ({
  signZapRequest: vi.fn(),
}));

vi.mock('@/services/nip47-invoice', () => ({
  parseBolt11AmountMsat: vi.fn(),
  previewInvoice: vi.fn((invoice: string) => `preview:${invoice}`),
}));

import { getVaultData, updateVaultData } from '@/../src-bex/vault';
import { storageService } from '@/services/storage-service';
import { clearSiteBindingCache } from '@/../src-bex/services/site-binding-store';
import { findNip47Connection, listNip47Connections } from '@/../src-bex/services/nip47-connection-store';
import { nip47Client } from '@/../src-bex/services/nip47-client';
import { appendNip57ZapHistory, listNip57ZapHistory } from '@/../src-bex/services/nip57-zap-history-store';
import { assertLnurlAmount, fetchLnurlPayTarget, requestZapInvoice } from '@/services/nip57-lnurl';
import { signZapRequest } from '@/services/nip57-zap-request';
import { parseBolt11AmountMsat } from '@/services/nip47-invoice';
import {
  handleNip57GetCapabilities,
  handleNip57SendZap,
  handleNip57ZapHistoryList,
} from '@/../src-bex/handlers/nip57';

function buildConnection(overrides: Partial<Nip47Connection> = {}): Nip47Connection {
  return {
    id: 'wallet-a',
    label: 'Wallet A',
    walletServicePubkey: 'wallet-a-wallet-pubkey',
    clientSecret: 'wallet-a-secret',
    clientPubkey: 'wallet-a-client-pubkey',
    relays: ['wss://relay.example.com/'],
    capabilities: ['pay_invoice'],
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:00.000Z',
    isActive: true,
    ...overrides,
  };
}

const account = { id: 'sender-pubkey', alias: 'alpha', account: { privkey: 'secret' }, createdAt: '2026-01-01T00:00:00.000Z' };

function baseVaultData(): VaultData {
  return { accounts: [account] };
}

function baseRequest(overrides: Partial<SendZapRequest> = {}): SendZapRequest {
  return {
    target: { type: 'profile', recipientPubkey: 'recipient-pubkey' },
    amountSats: 21,
    receiptRelays: ['wss://relay.example.com'],
    ...overrides,
  };
}

describe('handleNip57GetCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getVaultData).mockResolvedValue({ success: true, vaultData: baseVaultData() });
  });

  it('reports unavailable with no active wallet connection', async () => {
    vi.mocked(listNip47Connections).mockReturnValue([]);

    const result = await handleNip57GetCapabilities();

    expect(result).toEqual({
      success: true,
      data: {
        available: false,
        requiresConfirmation: true,
        supportsComments: true,
        supportsEventZap: true,
        supportsProfileZap: true,
        supportsAddressableZap: true,
      },
    });
  });

  it('reports the active wallet connection when one exists', async () => {
    vi.mocked(listNip47Connections).mockReturnValue([buildConnection()]);

    const result = await handleNip57GetCapabilities();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.available).toBe(true);
      expect(result.data.activeWalletConnection).toEqual({
        id: 'wallet-a',
        label: 'Wallet A',
        supportsPayInvoice: true,
      });
    }
  });

  it('propagates a vault-locked error', async () => {
    vi.mocked(getVaultData).mockResolvedValue({ success: false, error: 'locked', errorCode: ErrorCode.VLT_LOCKED });

    await expect(handleNip57GetCapabilities()).rejects.toThrow('Vault is locked');
  });
});

describe('handleNip57ZapHistoryList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the zap history for the unlocked vault', async () => {
    const vaultData = baseVaultData();
    vi.mocked(getVaultData).mockResolvedValue({ success: true, vaultData });
    vi.mocked(listNip57ZapHistory).mockReturnValue([]);

    const result = await handleNip57ZapHistoryList();

    expect(result).toEqual({ success: true, data: [] });
    expect(listNip57ZapHistory).toHaveBeenCalledWith(vaultData);
  });
});

describe('handleNip57SendZap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.crypto.randomUUID = vi.fn(() => 'zap-entry-id') as () => `${string}-${string}-${string}-${string}-${string}`;
    clearSiteBindingCache();
    vi.mocked(getVaultData).mockResolvedValue({ success: true, vaultData: baseVaultData() });
    // The zap now uses the site's bound account, which binds to the active one on first contact.
    // This used to fall back to `accounts[0]` when nothing was active, which could attribute a
    // payment to an identity the user never chose (#116).
    vi.mocked(storageService.get).mockImplementation((key: string) =>
      Promise.resolve(key === 'NOSTR_ACTIVE' ? account.alias : undefined),
    );
    vi.mocked(updateVaultData).mockResolvedValue({ success: true });
  });

  it('returns a cancelled result without touching the vault when not approved', async () => {
    const result = await handleNip57SendZap({ request: baseRequest(), origin: 'https://example.com', approved: false });

    expect(result).toEqual({
      success: true,
      data: {
        status: 'cancelled',
        amountMsat: 0,
        recipientPubkey: 'recipient-pubkey',
        error: 'Zap payment was not approved',
        code: 'USER_REJECTED',
      },
    });
    expect(getVaultData).not.toHaveBeenCalled();
  });

  it('rejects when both amountSats and amountMsat are given', async () => {
    const request = baseRequest({ amountSats: 21, amountMsat: 21000 });

    await expect(
      handleNip57SendZap({ request, origin: 'https://example.com', approved: true }),
    ).rejects.toThrow('exactly one of amountSats or amountMsat');
  });

  it('rejects when neither amountSats nor amountMsat is given', async () => {
    const request: SendZapRequest = {
      target: { type: 'profile', recipientPubkey: 'recipient-pubkey' },
      receiptRelays: ['wss://relay.example.com'],
    };

    await expect(
      handleNip57SendZap({ request, origin: 'https://example.com', approved: true }),
    ).rejects.toThrow('exactly one of amountSats or amountMsat');
  });

  it('rejects when there is no active NIP-47 wallet connection', async () => {
    vi.mocked(listNip47Connections).mockReturnValue([]);

    await expect(
      handleNip57SendZap({ request: baseRequest(), origin: 'https://example.com', approved: true }),
    ).rejects.toThrow('No active NIP-47 wallet connection');
  });

  it('rejects when the connection does not advertise pay_invoice support', async () => {
    vi.mocked(listNip47Connections).mockReturnValue([buildConnection({ isActive: true, capabilities: ['get_balance'] })]);

    await expect(
      handleNip57SendZap({ request: baseRequest(), origin: 'https://example.com', approved: true }),
    ).rejects.toThrow('does not advertise pay_invoice support');
  });

  it('rejects when no receipt relays can be determined', async () => {
    vi.mocked(listNip47Connections).mockReturnValue([buildConnection()]);
    const request = baseRequest({ receiptRelays: [] });

    await expect(
      handleNip57SendZap({ request, origin: 'https://example.com', approved: true }),
    ).rejects.toThrow('At least one receipt relay is required');
  });

  it('pays a zap end-to-end and records a paid history entry', async () => {
    vi.mocked(listNip47Connections).mockReturnValue([buildConnection()]);
    vi.mocked(fetchLnurlPayTarget).mockResolvedValue({ lnurl: 'lnurl1...', callback: 'https://wallet.example.com/cb' } as never);
    vi.mocked(signZapRequest).mockReturnValue({ id: 'zap-request-id' } as never);
    vi.mocked(requestZapInvoice).mockResolvedValue({ invoice: 'lnbc210n1p...' } as never);
    vi.mocked(parseBolt11AmountMsat).mockReturnValue(21000);
    vi.mocked(nip47Client.payInvoice).mockResolvedValue({ preimage: 'preimage', paymentHash: 'hash', feesPaidMsat: 1, raw: {} });

    const result = await handleNip57SendZap({ request: baseRequest(), origin: 'https://example.com', approved: true });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({ status: 'paid', amountMsat: 21000, zapRequestId: 'zap-request-id', invoice: 'lnbc210n1p...' });
    }
    expect(appendNip57ZapHistory).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'paid', connectionId: 'wallet-a', senderPubkey: 'sender-pubkey' }),
    );
    expect(updateVaultData).toHaveBeenCalledTimes(1);
  });

  it('records a failed history entry and returns a classified error when payment fails', async () => {
    vi.mocked(listNip47Connections).mockReturnValue([buildConnection()]);
    vi.mocked(fetchLnurlPayTarget).mockResolvedValue({ lnurl: 'lnurl1...', callback: 'https://wallet.example.com/cb' } as never);
    vi.mocked(signZapRequest).mockReturnValue({ id: 'zap-request-id' } as never);
    vi.mocked(requestZapInvoice).mockResolvedValue({ invoice: 'lnbc210n1p...' } as never);
    vi.mocked(parseBolt11AmountMsat).mockReturnValue(21000);
    vi.mocked(nip47Client.payInvoice).mockRejectedValue(new Error('remote does not support pay_invoice'));

    const result = await handleNip57SendZap({ request: baseRequest(), origin: 'https://example.com', approved: true });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('failed');
      expect(result.data.error).toBe('remote does not support pay_invoice');
      expect(result.data.code).toBe('WALLET_UNSUPPORTED');
    }
    expect(appendNip57ZapHistory).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'failed', error: 'remote does not support pay_invoice' }),
    );
  });
});
