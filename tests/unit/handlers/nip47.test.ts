import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/unbound-method */

import {
  handleNip47AuthorizationBegin,
  handleNip47AuthorizationCancel,
  handleNip47AuthorizationComplete,
  handleNip47AuthorizationOpen,
  handleNip47AuthorizationPopupClosed,
  handleNip47AuthorizationProbe,
  handleNip47AuthorizationRelay,
  handleNip47ConnectionImport,
  handleNip47ConnectionRemove,
  handleNip47ConnectionSetActive,
  handleNip47ConnectionsList,
  handleNip47GetBalance,
  handleNip47GetInfo,
  handleNip47PayInvoice,
  WALLET_INFO_MAX_AGE_MS,
  WALLET_INFO_UNAVAILABLE,
  handleNip47PaymentHistoryList,
} from '@/../src-bex/handlers/nip47';
import { getVaultData, updateVaultData } from '@/../src-bex/vault';
import { NIP47_NO_ALLOWED_RELAYS, nip47Client } from '@/../src-bex/services/nip47-client';
import { parseNwcUri, buildNip47ConnectionId } from '@/services/nip47-uri';
import { listNip47PaymentHistory } from '@/../src-bex/services/nip47-payment-history-store';
import type { StoredKey, VaultData } from '@/types/bridge';
import type { Nip47Connection } from '@/types/nip47';
import type { HandlerResult } from '@/../src-bex/types/background';
import { ErrorCode } from '@/types/error-codes.d';
import {
  bindPendingNip47AuthorizationPopup,
  clearPendingNip47Authorizations,
  findPendingNip47AuthorizationByPopup,
  savePendingNip47Authorization,
  takePendingNip47Authorization,
  type PendingNip47Authorization,
} from '@/../src-bex/services/nip47-pending-authorization-store';
import { armWalletRelay } from '@/../src-bex/services/wallet-relay-arm';
import { postWalletConnectOutcome } from '@/services/wallet-connect-channel';

const lockListeners = vi.hoisted(() => [] as (() => void)[]);

vi.mock('@/../src-bex/vault', () => ({
  getVaultData: vi.fn(),
  updateVaultData: vi.fn(),
  onVaultLocked: (listener: () => void) => {
    lockListeners.push(listener);
    return () => undefined;
  },
}));

vi.mock('@/../src-bex/services/nip47-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/../src-bex/services/nip47-client')>()),
  nip47Client: {
    payInvoice: vi.fn(),
    getInfo: vi.fn(),
    getBalance: vi.fn(),
    sendRequest: vi.fn(),
  },
}));

vi.mock('@/../src-bex/services/nip47-pending-authorization-store', () => ({
  bindPendingNip47AuthorizationPopup: vi.fn(),
  clearPendingNip47Authorizations: vi.fn(() => Promise.resolve([])),
  findPendingNip47AuthorizationByPopup: vi.fn(),
  savePendingNip47Authorization: vi.fn(),
  takePendingNip47Authorization: vi.fn(),
}));

vi.mock('@/../src-bex/services/wallet-relay-arm', () => ({
  armWalletRelay: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/services/wallet-connect-channel', () => ({
  postWalletConnectOutcome: vi.fn(),
}));

vi.mock('@/services/nip47-uri', () => ({
  parseNwcUri: vi.fn(),
  buildNip47ConnectionId: vi.fn(),
}));

vi.mock('@/../src-bex/services/nip47-payment-history-store', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/../src-bex/services/nip47-payment-history-store')>();
  return {
    ...actual,
    listNip47PaymentHistory: vi.fn(actual.listNip47PaymentHistory),
  };
});

/** The account every connection here belongs to unless a test says otherwise (#304). */
const ACCOUNT = 'a'.repeat(64);
const MAIN_ACCOUNT: StoredKey = {
  id: ACCOUNT,
  alias: 'Main Account',
  account: { privkey: '1'.repeat(64) },
  createdAt: '2026-01-01T00:00:00.000Z',
};

function buildConnection(overrides: Partial<Nip47Connection> = {}): Nip47Connection {
  return {
    id: 'wallet-a',
    accountPubkey: ACCOUNT,
    label: 'Wallet A',
    walletServicePubkey: 'wallet-a-wallet-pubkey',
    clientSecret: 'wallet-a-secret',
    clientPubkey: 'wallet-a-client-pubkey',
    relays: ['wss://relay.example.com/'],
    capabilities: ['pay_invoice', 'get_balance'],
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:00.000Z',
    isActive: true,
    // Already read from the wallet's info event, recently, unless a test says otherwise (#142).
    encryption: [],
    lastInfoCheckedAt: new Date().toISOString(),
    ...overrides,
  };
}

const INVOICE = 'lnbc1u1pjqxyz';

describe('handleNip47PayInvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.crypto.randomUUID = vi.fn(
      () => 'history-entry-id',
    ) as () => `${string}-${string}-${string}-${string}-${string}`;
    vi.mocked(updateVaultData).mockResolvedValue({ success: true });
  });

  function mockVault(connection: Nip47Connection): VaultData {
    const vaultData: VaultData = { accounts: [MAIN_ACCOUNT], nip47Connections: [connection] };
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

    const result = await handleNip47PayInvoice({
      accountPubkey: ACCOUNT,
      connectionId: 'wallet-a',
      invoice: INVOICE,
    });

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
    vi.mocked(nip47Client.payInvoice).mockRejectedValue(
      new Error('PAYMENT_FAILED: insufficient balance'),
    );

    await expect(
      handleNip47PayInvoice({ accountPubkey: ACCOUNT, connectionId: 'wallet-a', invoice: INVOICE }),
    ).rejects.toThrow('PAYMENT_FAILED: insufficient balance');

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

    await expect(
      handleNip47PayInvoice({ accountPubkey: ACCOUNT, connectionId: 'wallet-a', invoice: INVOICE }),
    ).rejects.toThrow('does not advertise pay_invoice support');

    expect(nip47Client.payInvoice).not.toHaveBeenCalled();
    expect(updateVaultData).not.toHaveBeenCalled();
  });

  // By the time of this check the info event has been read, so an empty list is the wallet
  // advertising no methods (#142).
  it('refuses payment when the wallet advertises no methods', async () => {
    mockVault(buildConnection({ capabilities: [] }));

    await expect(
      handleNip47PayInvoice({ accountPubkey: ACCOUNT, connectionId: 'wallet-a', invoice: INVOICE }),
    ).rejects.toThrow('does not advertise pay_invoice');
    expect(nip47Client.payInvoice).not.toHaveBeenCalled();
  });

  it('throws when the connection cannot be found', async () => {
    mockVault(buildConnection());

    await expect(
      handleNip47PayInvoice({
        accountPubkey: ACCOUNT,
        connectionId: 'missing-wallet',
        invoice: INVOICE,
      }),
    ).rejects.toThrow('NIP-47 connection not found');
  });
});

describe('NIP-47 encryption negotiation before a request (diogel-io/workspace#142, T22)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.crypto.randomUUID = vi.fn(
      () => 'history-entry-id',
    ) as () => `${string}-${string}-${string}-${string}-${string}`;
    vi.mocked(updateVaultData).mockResolvedValue({ success: true });
  });

  function mockVault(connection: Nip47Connection): void {
    vi.mocked(getVaultData).mockResolvedValue({
      success: true,
      vaultData: { accounts: [MAIN_ACCOUNT], nip47Connections: [connection] },
    });
  }

  const INFO = {
    capabilities: ['pay_invoice', 'get_balance'],
    encryption: ['nip44_v2', 'nip04'],
    checkedAt: '2026-10-21T00:00:00.000Z',
  } as never;

  it('reads and stores the wallet encryption before paying from an imported connection', async () => {
    const { encryption: _unread, ...imported } = buildConnection();
    void _unread;
    mockVault(imported);
    vi.mocked(nip47Client.getInfo).mockResolvedValue(INFO);
    vi.mocked(nip47Client.payInvoice).mockResolvedValue({ preimage: 'preimage', raw: {} });

    await handleNip47PayInvoice({
      accountPubkey: ACCOUNT,
      connectionId: 'wallet-a',
      invoice: INVOICE,
    });

    expect(nip47Client.getInfo).toHaveBeenCalledTimes(1);
    expect(vi.mocked(nip47Client.payInvoice).mock.calls[0]![0]).toMatchObject({
      encryption: ['nip44_v2', 'nip04'],
    });
    const stored = vi.mocked(updateVaultData).mock.calls[0]?.[0] as VaultData;
    expect(stored.nip47Connections?.[0]).toMatchObject({ encryption: ['nip44_v2', 'nip04'] });
  });

  it('does the same before reading the balance', async () => {
    const { encryption: _unread, ...imported } = buildConnection();
    void _unread;
    mockVault(imported);
    vi.mocked(nip47Client.getInfo).mockResolvedValue(INFO);
    vi.mocked(nip47Client.getBalance).mockResolvedValue({ balanceMsat: 1, raw: {} });

    await handleNip47GetBalance({ accountPubkey: ACCOUNT, connectionId: 'wallet-a' });

    expect(vi.mocked(nip47Client.getBalance).mock.calls[0]![0]).toMatchObject({
      encryption: ['nip44_v2', 'nip04'],
    });
  });

  it('refuses to pay when the info event read for an imported connection lacks pay_invoice', async () => {
    const { encryption: _unread, ...imported } = buildConnection({ capabilities: [] });
    void _unread;
    mockVault(imported);
    vi.mocked(nip47Client.getInfo).mockResolvedValue({
      capabilities: ['get_balance'],
      encryption: ['nip44_v2'],
      checkedAt: '2026-10-21T00:00:00.000Z',
    } as never);

    await expect(
      handleNip47PayInvoice({ accountPubkey: ACCOUNT, connectionId: 'wallet-a', invoice: INVOICE }),
    ).rejects.toThrow('does not advertise pay_invoice');
    expect(nip47Client.payInvoice).not.toHaveBeenCalled();
  });

  it('refuses a connection saved with only plaintext ws:// relays, before contacting anything', async () => {
    mockVault(buildConnection({ relays: ['ws://relay.example.com/'] }));

    await expect(
      handleNip47GetBalance({ accountPubkey: ACCOUNT, connectionId: 'wallet-a' }),
    ).rejects.toThrow(NIP47_NO_ALLOWED_RELAYS);
    await expect(
      handleNip47PayInvoice({ accountPubkey: ACCOUNT, connectionId: 'wallet-a', invoice: INVOICE }),
    ).rejects.toThrow(NIP47_NO_ALLOWED_RELAYS);
    await expect(
      handleNip47GetInfo({ accountPubkey: ACCOUNT, connectionId: 'wallet-a' }),
    ).rejects.toThrow(NIP47_NO_ALLOWED_RELAYS);

    expect(nip47Client.getInfo).not.toHaveBeenCalled();
    expect(nip47Client.getBalance).not.toHaveBeenCalled();
    expect(nip47Client.payInvoice).not.toHaveBeenCalled();
  });

  it('reads the info event again once the recorded encryption is a day old', async () => {
    mockVault(
      buildConnection({
        encryption: [],
        lastInfoCheckedAt: new Date(Date.now() - WALLET_INFO_MAX_AGE_MS - 1000).toISOString(),
      }),
    );
    vi.mocked(nip47Client.getInfo).mockResolvedValue(INFO);
    vi.mocked(nip47Client.getBalance).mockResolvedValue({ balanceMsat: 1, raw: {} });

    await handleNip47GetBalance({ accountPubkey: ACCOUNT, connectionId: 'wallet-a' });

    expect(nip47Client.getInfo).toHaveBeenCalledTimes(1);
    expect(vi.mocked(nip47Client.getBalance).mock.calls[0]![0]).toMatchObject({
      encryption: ['nip44_v2', 'nip04'],
    });
  });

  it('waits before retrying a failed refresh, instead of paying its lookup on every request', async () => {
    mockVault(
      buildConnection({
        id: 'wallet-a',
        encryption: ['nip44_v2'],
        lastInfoCheckedAt: new Date(Date.now() - WALLET_INFO_MAX_AGE_MS - 1000).toISOString(),
      }),
    );
    vi.mocked(nip47Client.getInfo).mockRejectedValue(new Error('relay down'));
    vi.mocked(nip47Client.getBalance).mockResolvedValue({ balanceMsat: 1, raw: {} });

    await handleNip47GetBalance({ accountPubkey: ACCOUNT, connectionId: 'wallet-a' });
    await handleNip47GetBalance({ accountPubkey: ACCOUNT, connectionId: 'wallet-a' });

    expect(nip47Client.getInfo).toHaveBeenCalledTimes(1);
    expect(nip47Client.getBalance).toHaveBeenCalledTimes(2);
  });

  it('keeps a known encryption when the refresh cannot read the info event', async () => {
    mockVault(
      buildConnection({
        encryption: ['nip44_v2'],
        lastInfoCheckedAt: new Date(Date.now() - WALLET_INFO_MAX_AGE_MS - 1000).toISOString(),
      }),
    );
    vi.mocked(nip47Client.getInfo).mockRejectedValue(new Error('relay down'));
    vi.mocked(nip47Client.getBalance).mockResolvedValue({ balanceMsat: 1, raw: {} });

    await handleNip47GetBalance({ accountPubkey: ACCOUNT, connectionId: 'wallet-a' });

    expect(vi.mocked(nip47Client.getBalance).mock.calls[0]![0]).toMatchObject({
      encryption: ['nip44_v2'],
    });
  });

  it('does not read the info event again once the encryption is known', async () => {
    mockVault(buildConnection({ encryption: ['nip04'] }));
    vi.mocked(nip47Client.getBalance).mockResolvedValue({ balanceMsat: 1, raw: {} });

    await handleNip47GetBalance({ accountPubkey: ACCOUNT, connectionId: 'wallet-a' });

    expect(nip47Client.getInfo).not.toHaveBeenCalled();
  });

  it('sends nothing, rather than guessing NIP-04, when the info event cannot be read', async () => {
    const { encryption: _unread, ...imported } = buildConnection();
    void _unread;
    mockVault(imported);
    vi.mocked(nip47Client.getInfo).mockRejectedValue(new Error('No NIP-47 wallet info event'));

    await expect(
      handleNip47GetBalance({ accountPubkey: ACCOUNT, connectionId: 'wallet-a' }),
    ).rejects.toThrow(WALLET_INFO_UNAVAILABLE);
    await expect(
      handleNip47PayInvoice({ accountPubkey: ACCOUNT, connectionId: 'wallet-a', invoice: INVOICE }),
    ).rejects.toThrow(WALLET_INFO_UNAVAILABLE);

    expect(nip47Client.getBalance).not.toHaveBeenCalled();
    expect(nip47Client.payInvoice).not.toHaveBeenCalled();
  });

  it('stores the advertised encryption when wallet info is refreshed', async () => {
    mockVault(buildConnection());
    vi.mocked(nip47Client.getInfo).mockResolvedValue(INFO);

    await handleNip47GetInfo({ accountPubkey: ACCOUNT, connectionId: 'wallet-a' });

    const stored = vi.mocked(updateVaultData).mock.calls[0]?.[0] as VaultData;
    expect(stored.nip47Connections?.[0]).toMatchObject({ encryption: ['nip44_v2', 'nip04'] });
  });
});

describe('handleNip47ConnectionsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('summarizes all connections, stripping the client secret', async () => {
    vi.mocked(getVaultData).mockResolvedValue({
      success: true,
      vaultData: { accounts: [MAIN_ACCOUNT], nip47Connections: [buildConnection()] },
    });

    const result = await handleNip47ConnectionsList({ accountPubkey: ACCOUNT });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({ id: 'wallet-a', hasClientSecret: true });
      expect(result.data[0]).not.toHaveProperty('clientSecret');
    }
  });

  it('returns an empty list when the vault has no connections', async () => {
    vi.mocked(getVaultData).mockResolvedValue({
      success: true,
      vaultData: { accounts: [MAIN_ACCOUNT] },
    });

    const result = await handleNip47ConnectionsList({ accountPubkey: ACCOUNT });

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
    vi.mocked(getVaultData).mockResolvedValue({
      success: true,
      vaultData: { accounts: [MAIN_ACCOUNT] },
    });

    const result = await handleNip47ConnectionImport({
      accountPubkey: ACCOUNT,
      uri: 'nostr+walletconnect://...',
      label: 'My Wallet',
    });

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
      vaultData: { accounts: [MAIN_ACCOUNT], nip47Connections: [existing] },
    });

    const result = await handleNip47ConnectionImport({
      accountPubkey: ACCOUNT,
      uri: 'nostr+walletconnect://...',
    });

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
      vaultData: { accounts: [MAIN_ACCOUNT], nip47Connections: [buildConnection()] },
    });

    const result = await handleNip47ConnectionRemove({
      accountPubkey: ACCOUNT,
      connectionId: 'wallet-a',
    });

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
      vaultData: { accounts: [MAIN_ACCOUNT], nip47Connections: [other, target] },
    });

    const result = await handleNip47ConnectionSetActive({
      accountPubkey: ACCOUNT,
      connectionId: 'wallet-a',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('wallet-a');
    }
    const saved = vi.mocked(updateVaultData).mock.calls[0]?.[0] as VaultData;
    expect(saved.nip47Connections?.find((c) => c.id === 'wallet-a')?.isActive).toBe(true);
    expect(saved.nip47Connections?.find((c) => c.id === 'wallet-b')?.isActive).toBe(false);
  });

  it('rejects when the connection does not exist', async () => {
    vi.mocked(getVaultData).mockResolvedValue({
      success: true,
      vaultData: { accounts: [MAIN_ACCOUNT] },
    });

    await expect(
      handleNip47ConnectionSetActive({ accountPubkey: ACCOUNT, connectionId: 'missing' }),
    ).rejects.toThrow('NIP-47 connection not found');
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
      vaultData: { accounts: [MAIN_ACCOUNT], nip47Connections: [buildConnection()] },
    });
    vi.mocked(nip47Client.getInfo).mockResolvedValue({
      capabilities: ['pay_invoice', 'get_balance'],
      checkedAt: '2026-06-14T00:00:00.000Z',
    } as never);

    const result = await handleNip47GetInfo({ accountPubkey: ACCOUNT, connectionId: 'wallet-a' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capabilities).toEqual(['pay_invoice', 'get_balance']);
    }
    const saved = vi.mocked(updateVaultData).mock.calls[0]?.[0] as VaultData;
    expect(saved.nip47Connections?.[0]).toMatchObject({
      capabilities: ['pay_invoice', 'get_balance'],
    });
  });

  it('rejects when the connection does not exist', async () => {
    vi.mocked(getVaultData).mockResolvedValue({
      success: true,
      vaultData: { accounts: [MAIN_ACCOUNT] },
    });

    await expect(
      handleNip47GetInfo({ accountPubkey: ACCOUNT, connectionId: 'missing' }),
    ).rejects.toThrow('NIP-47 connection not found');
  });
});

describe('handleNip47GetBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the wallet balance for an existing connection', async () => {
    vi.mocked(getVaultData).mockResolvedValue({
      success: true,
      vaultData: { accounts: [MAIN_ACCOUNT], nip47Connections: [buildConnection()] },
    });
    vi.mocked(nip47Client.getBalance).mockResolvedValue({ balanceMsat: 100_000 } as never);

    const result = await handleNip47GetBalance({
      accountPubkey: ACCOUNT,
      connectionId: 'wallet-a',
    });

    expect(result).toEqual({ success: true, data: { balanceMsat: 100_000 } });
  });

  it('rejects when the connection does not exist', async () => {
    vi.mocked(getVaultData).mockResolvedValue({
      success: true,
      vaultData: { accounts: [MAIN_ACCOUNT] },
    });

    await expect(
      handleNip47GetBalance({ accountPubkey: ACCOUNT, connectionId: 'missing' }),
    ).rejects.toThrow('NIP-47 connection not found');
  });
});

describe('handleNip47PaymentHistoryList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the payment history for the unlocked vault', async () => {
    const vaultData: VaultData = { accounts: [MAIN_ACCOUNT], nip47PaymentHistory: [] };
    vi.mocked(getVaultData).mockResolvedValue({ success: true, vaultData });

    const result = await handleNip47PaymentHistoryList({ accountPubkey: ACCOUNT });

    expect(result).toEqual({ success: true, data: [] });
    expect(listNip47PaymentHistory).toHaveBeenCalledWith(vaultData, ACCOUNT);
  });
});

describe('wallet authorization (#110)', () => {
  const WALLET = 'b'.repeat(64);
  const COINOS_WALLET = 'ba80990666ef0b6f4ba5059347beb13242921e54669e680064ca755256a1e3a6';
  const SECRET = '1'.repeat(64);

  function pending(overrides: Partial<PendingNip47Authorization> = {}): PendingNip47Authorization {
    return {
      pendingId: 'pending-1',
      accountPubkey: ACCOUNT,
      providerId: 'coinos',
      origin: 'https://coinos.io',
      clientSecret: SECRET,
      clientPubkey: 'client-pubkey',
      createdAt: 0,
      expiresAt: Number.MAX_SAFE_INTEGER,
      ...overrides,
    };
  }

  let vaultData: VaultData;

  function dataOf<T>(result: HandlerResult<T>): T {
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.data;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vaultData = {
      accounts: [MAIN_ACCOUNT],
      nip47Connections: [buildConnection({ id: 'existing', isActive: true })],
    };
    vi.mocked(getVaultData).mockImplementation(() => Promise.resolve({ success: true, vaultData }));
    vi.mocked(updateVaultData).mockImplementation((next) => {
      vaultData = next as VaultData;
      return Promise.resolve({ success: true });
    });
    vi.mocked(buildNip47ConnectionId).mockImplementation(
      (wallet, client) => `nip47:${wallet}:${client}`,
    );
    vi.mocked(savePendingNip47Authorization).mockImplementation((entry) =>
      Promise.resolve({ ...entry, createdAt: 0, expiresAt: 1 }),
    );
    globalThis.crypto.randomUUID = vi.fn(
      () => 'pending-uuid',
    ) as () => `${string}-${string}-${string}-${string}-${string}`;
  });

  describe('handleNip47AuthorizationBegin', () => {
    it('keeps the secret in the background and returns only public values', async () => {
      const result = await handleNip47AuthorizationBegin({
        accountPubkey: ACCOUNT,
        provider: 'coinos',
      });

      const saved = vi.mocked(savePendingNip47Authorization).mock.calls[0]![0];
      expect(saved).toMatchObject({
        pendingId: 'pending-uuid',
        providerId: 'coinos',
        origin: 'https://coinos.io',
      });
      expect(saved.clientSecret).toMatch(/^[0-9a-f]{64}$/);

      const data = dataOf(result);
      expect(data).toEqual({
        pendingId: 'pending-uuid',
        clientPubkey: saved.clientPubkey,
        origin: 'https://coinos.io',
        authorizationUrl: expect.stringContaining(
          `https://coinos.io/apps/new?name=Porwr&pubkey=${saved.clientPubkey}`,
        ),
      });
      expect(JSON.stringify(data)).not.toContain(saved.clientSecret);
    });

    it('undoes a start the vault locked during, and opens no popup (#142)', async () => {
      vi.mocked(savePendingNip47Authorization).mockImplementationOnce((entry) => {
        for (const listener of lockListeners) listener();
        return Promise.resolve({ ...entry, createdAt: 1, expiresAt: 2 });
      });

      await expect(
        handleNip47AuthorizationBegin({ accountPubkey: ACCOUNT, provider: 'coinos' }),
      ).rejects.toThrow('vault locked');
      expect(takePendingNip47Authorization).toHaveBeenCalledWith('pending-uuid');
    });

    it('opens a self-hosted Alby Hub at its origin', async () => {
      const result = await handleNip47AuthorizationBegin({
        accountPubkey: ACCOUNT,
        provider: 'alby-hub',
        customOrigin: 'https://hub.example.com/some/path',
      });

      expect(dataOf(result).origin).toBe('https://hub.example.com');
      expect(dataOf(result).authorizationUrl).toMatch(/^https:\/\/hub\.example\.com\/apps\/new\?/);
    });

    it('opens a self-hosted Alby Hub on the home network over http (workspace#149)', async () => {
      const result = await handleNip47AuthorizationBegin({
        accountPubkey: ACCOUNT,
        provider: 'alby-hub',
        customOrigin: 'http://umbrel.local:59000',
      });

      expect(dataOf(result).origin).toBe('http://umbrel.local:59000');
      expect(dataOf(result).authorizationUrl).toMatch(/^http:\/\/umbrel\.local:59000\/apps\/new\?/);
    });

    it('rejects an unknown provider and an unusable address', async () => {
      await expect(
        handleNip47AuthorizationBegin({ accountPubkey: ACCOUNT, provider: 'mutiny' }),
      ).rejects.toThrow('Unsupported wallet provider');
      await expect(
        handleNip47AuthorizationBegin({
          accountPubkey: ACCOUNT,
          provider: 'alby-hub',
          customOrigin: 'http://hub.example.com',
        }),
      ).rejects.toThrow('https:// address of your Alby Hub, or its http:// address on your home');
      expect(savePendingNip47Authorization).not.toHaveBeenCalled();
    });

    it('refuses while the vault is locked', async () => {
      vi.mocked(getVaultData).mockResolvedValue({
        success: false,
        error: 'Vault is locked',
        errorCode: ErrorCode.VLT_LOCKED,
      });

      await expect(
        handleNip47AuthorizationBegin({ accountPubkey: ACCOUNT, provider: 'coinos' }),
      ).rejects.toThrow('Vault is locked');
      expect(savePendingNip47Authorization).not.toHaveBeenCalled();
    });
  });

  describe('handleNip47AuthorizationComplete', () => {
    const request = {
      pendingId: 'pending-1',
      walletServicePubkey: WALLET,
      relays: ['wss://relay.example.com'],
      lud16: 'alice@coinos.io',
    };

    it('saves nothing when the vault locked as the connection was being saved (#142)', async () => {
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(pending());
      vi.mocked(nip47Client.getInfo).mockResolvedValue({
        capabilities: ['pay_invoice'],
        encryption: ['nip44_v2'],
        checkedAt: '2026-10-22T00:00:00.000Z',
      } as never);
      const vault = vi.mocked(getVaultData).getMockImplementation();
      let reads = 0;
      vi.mocked(getVaultData).mockImplementation(async () => {
        // The second read is the save's own: lock just before the mutation decides.
        if (++reads === 2) for (const listener of lockListeners) listener();
        return vault ? vault() : { success: true, vaultData: { accounts: [MAIN_ACCOUNT] } };
      });

      await expect(handleNip47AuthorizationComplete(request)).rejects.toThrow('vault locked');
      expect(updateVaultData).not.toHaveBeenCalled();
    });

    it('saves nothing when the vault locked while the wallet answered (#142)', async () => {
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(pending());
      vi.mocked(nip47Client.getInfo).mockImplementation(() => {
        for (const listener of lockListeners) listener();
        return Promise.resolve({
          capabilities: ['pay_invoice'],
          encryption: ['nip44_v2'],
          checkedAt: '2026-10-22T00:00:00.000Z',
        } as never);
      });

      await expect(handleNip47AuthorizationComplete(request)).rejects.toThrow('vault locked');
      expect(updateVaultData).not.toHaveBeenCalled();
    });

    it('saves a checked connection as the active wallet and returns no secret', async () => {
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(pending());
      vi.mocked(nip47Client.getInfo).mockResolvedValue({
        pubkey: WALLET,
        capabilities: ['pay_invoice', 'get_balance'],
        relays: [],
        encryption: [],
        notifications: [],
        rawContent: '',
        checkedAt: '2026-10-12T00:00:00.000Z',
      });

      const result = await handleNip47AuthorizationComplete(request);

      expect(takePendingNip47Authorization).toHaveBeenCalledWith('pending-1');
      expect(nip47Client.getInfo).toHaveBeenCalledWith(
        expect.objectContaining({ walletServicePubkey: WALLET, clientSecret: SECRET }),
      );
      expect(dataOf(result)).toMatchObject({
        id: `nip47:${WALLET}:client-pubkey`,
        label: 'Coinos',
        lud16: 'alice@coinos.io',
        capabilities: ['pay_invoice', 'get_balance'],
        isActive: true,
        hasClientSecret: true,
      });
      expect(dataOf(result)).not.toHaveProperty('clientSecret');

      const saved = vaultData.nip47Connections!;
      expect(saved.find((item) => item.id === 'existing')?.isActive).toBe(false);
      expect(saved.find((item) => item.id === `nip47:${WALLET}:client-pubkey`)).toMatchObject({
        clientSecret: SECRET,
        lastInfoCheckedAt: '2026-10-12T00:00:00.000Z',
      });
    });

    it('saves nothing when the wallet service does not answer', async () => {
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(pending());
      vi.mocked(nip47Client.getInfo).mockRejectedValue(
        new Error('No NIP-47 wallet info event found'),
      );

      await expect(handleNip47AuthorizationComplete(request)).rejects.toThrow(
        'No NIP-47 wallet info event found',
      );
      expect(updateVaultData).not.toHaveBeenCalled();
    });

    it('rejects details it cannot use without asking the wallet', async () => {
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(pending());

      await expect(
        handleNip47AuthorizationComplete({ ...request, relays: ['ws://insecure.example.com'] }),
      ).rejects.toThrow('could not use');
      expect(nip47Client.getInfo).not.toHaveBeenCalled();
      expect(updateVaultData).not.toHaveBeenCalled();
    });

    it('rejects an expired or reused request', async () => {
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(null);

      await expect(handleNip47AuthorizationComplete(request)).rejects.toThrow('expired');
      expect(nip47Client.getInfo).not.toHaveBeenCalled();
    });
  });

  describe('handleNip47AuthorizationProbe', () => {
    beforeEach(() => {
      vi.mocked(nip47Client.getInfo).mockResolvedValue({
        capabilities: ['pay_invoice'],
        encryption: ['nip44_v2', 'nip04'],
        checkedAt: '2026-10-21T00:00:00.000Z',
      } as never);
    });

    it('probes in the encryption the wallet advertises, and stores it (#142)', async () => {
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(pending());
      vi.mocked(nip47Client.sendRequest).mockResolvedValue({
        result_type: 'get_info',
        result: { methods: ['pay_invoice'] },
      });

      await handleNip47AuthorizationProbe({ pendingId: 'pending-1' });

      expect(vi.mocked(nip47Client.sendRequest).mock.calls[0]![0]).toMatchObject({
        encryption: ['nip44_v2', 'nip04'],
      });
      const saved = vi.mocked(updateVaultData).mock.calls[0]?.[0] as VaultData;
      expect(
        saved.nip47Connections?.find((item) => item.walletServicePubkey === COINOS_WALLET),
      ).toMatchObject({ encryption: ['nip44_v2', 'nip04'] });
    });

    it('probes as NIP-04 when the info event cannot be read, and still saves the approval (#142)', async () => {
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(pending());
      vi.mocked(nip47Client.getInfo).mockRejectedValue(new Error('No NIP-47 wallet info event'));
      vi.mocked(nip47Client.sendRequest).mockResolvedValue({
        result_type: 'get_info',
        result: { methods: ['pay_invoice'] },
      });

      const result = await handleNip47AuthorizationProbe({ pendingId: 'pending-1' });

      // No `encryption` on the request: NIP-04, as NIP-47 reads an absent info event.
      expect(vi.mocked(nip47Client.sendRequest).mock.calls[0]![0].encryption).toBeUndefined();
      expect(dataOf(result)).toMatchObject({ capabilities: ['pay_invoice'] });
      const saved = vi.mocked(updateVaultData).mock.calls[0]?.[0] as VaultData;
      const stored = saved.nip47Connections?.find(
        (item) => item.walletServicePubkey === COINOS_WALLET,
      );
      // Recorded without an encryption, so its first request reads the info event again.
      expect(stored).toBeDefined();
      expect(stored!.encryption).toBeUndefined();
    });

    it('saves nothing when the vault locked while the probe waited (#142)', async () => {
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(pending());
      vi.mocked(nip47Client.sendRequest).mockImplementation(() => {
        for (const listener of lockListeners) listener();
        return Promise.resolve({ result_type: 'get_info', result: { methods: ['pay_invoice'] } });
      });

      await expect(handleNip47AuthorizationProbe({ pendingId: 'pending-1' })).resolves.toEqual({
        success: true,
        data: null,
      });
      expect(updateVaultData).not.toHaveBeenCalled();
    });

    it('saves a Coinos connection the wallet answers for', async () => {
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(pending());
      vi.mocked(nip47Client.sendRequest).mockResolvedValue({
        result_type: 'get_info',
        result: { methods: ['pay_invoice', 'get_balance', 7] },
      });

      const result = await handleNip47AuthorizationProbe({ pendingId: 'pending-1' });

      expect(nip47Client.sendRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          walletServicePubkey: COINOS_WALLET,
          relays: ['wss://relay.coinos.io'],
          clientSecret: SECRET,
        }),
        { method: 'get_info', params: {} },
      );
      expect(dataOf(result)).toMatchObject({
        id: `nip47:${COINOS_WALLET}:client-pubkey`,
        label: 'Coinos',
        capabilities: ['pay_invoice', 'get_balance'],
      });
      expect(updateVaultData).toHaveBeenCalledOnce();
    });

    it('treats any wallet error other than UNAUTHORIZED as approval', async () => {
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(pending());
      vi.mocked(nip47Client.sendRequest).mockResolvedValue({
        error: { code: 'RESTRICTED', message: 'not allowed' },
      });

      const result = await handleNip47AuthorizationProbe({ pendingId: 'pending-1' });

      expect(dataOf(result)).toMatchObject({ capabilities: [] });
    });

    it('saves nothing when the wallet refuses the key', async () => {
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(pending());
      vi.mocked(nip47Client.sendRequest).mockResolvedValue({
        error: { code: 'UNAUTHORIZED', message: 'no' },
      });

      await expect(handleNip47AuthorizationProbe({ pendingId: 'pending-1' })).resolves.toEqual({
        success: true,
        data: null,
      });
      expect(updateVaultData).not.toHaveBeenCalled();
    });

    it('saves nothing when the wallet does not answer', async () => {
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(pending());
      vi.mocked(nip47Client.sendRequest).mockRejectedValue(
        new Error('Timed out waiting for NIP-47 wallet response'),
      );

      await expect(handleNip47AuthorizationProbe({ pendingId: 'pending-1' })).resolves.toEqual({
        success: true,
        data: null,
      });
      expect(updateVaultData).not.toHaveBeenCalled();
    });

    it('cannot probe a provider without a known wallet service', async () => {
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(
        pending({ providerId: 'alby-hub' }),
      );

      await expect(handleNip47AuthorizationProbe({ pendingId: 'pending-1' })).resolves.toEqual({
        success: true,
        data: null,
      });
      expect(nip47Client.sendRequest).not.toHaveBeenCalled();
    });

    it('rejects an expired request', async () => {
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(null);

      await expect(handleNip47AuthorizationProbe({ pendingId: 'pending-1' })).rejects.toThrow(
        'expired',
      );
    });
  });
});

describe('wallets belong to one account (#304)', () => {
  const OTHER = 'c'.repeat(64);
  const OTHER_ACCOUNT: StoredKey = {
    id: OTHER,
    alias: 'work',
    account: { privkey: '2'.repeat(64) },
    createdAt: '2026-01-02T00:00:00.000Z',
  };

  let vaultData: VaultData;

  beforeEach(() => {
    vi.clearAllMocks();
    vaultData = {
      accounts: [MAIN_ACCOUNT, OTHER_ACCOUNT],
      nip47Connections: [
        buildConnection({ id: 'wallet-a', accountPubkey: ACCOUNT, isActive: true }),
        buildConnection({ id: 'wallet-b', accountPubkey: OTHER, isActive: true }),
      ],
    };
    vi.mocked(getVaultData).mockImplementation(() => Promise.resolve({ success: true, vaultData }));
    vi.mocked(updateVaultData).mockImplementation((next) => {
      vaultData = next as VaultData;
      return Promise.resolve({ success: true });
    });
    globalThis.crypto.randomUUID = vi.fn(
      () => 'uuid',
    ) as () => `${string}-${string}-${string}-${string}-${string}`;
  });

  it('lists only the named account’s connections', async () => {
    const result = await handleNip47ConnectionsList({ accountPubkey: OTHER });

    expect(result.success && result.data.map((item) => item.id)).toEqual(['wallet-b']);
  });

  it('refuses an action that names no account, or one not in the vault', async () => {
    // Falling back to the active account is how one wallet came to serve every account.
    await expect(handleNip47ConnectionsList({} as never)).rejects.toThrow(
      'accountPubkey must be a hex public key',
    );
    await expect(handleNip47ConnectionsList({ accountPubkey: 'd'.repeat(64) })).rejects.toThrow(
      'Account not found',
    );
  });

  it('does not find another account’s connection, whatever the action', async () => {
    const request = { accountPubkey: OTHER, connectionId: 'wallet-a' };

    await expect(handleNip47GetBalance(request)).rejects.toThrow('NIP-47 connection not found');
    await expect(handleNip47GetInfo(request)).rejects.toThrow('NIP-47 connection not found');
    await expect(handleNip47ConnectionSetActive(request)).rejects.toThrow(
      'NIP-47 connection not found',
    );
    await expect(handleNip47PayInvoice({ ...request, invoice: INVOICE })).rejects.toThrow(
      'NIP-47 connection not found',
    );
    expect(nip47Client.payInvoice).not.toHaveBeenCalled();
  });

  it('leaves another account’s connection alone when asked to remove it', async () => {
    await handleNip47ConnectionRemove({ accountPubkey: OTHER, connectionId: 'wallet-a' });

    expect(vaultData.nip47Connections!.map((item) => item.id)).toEqual(['wallet-a', 'wallet-b']);
  });

  it('activating a connection leaves every other account’s active connection active', async () => {
    vaultData.nip47Connections!.push(
      buildConnection({ id: 'wallet-a2', accountPubkey: ACCOUNT, isActive: false }),
    );

    await handleNip47ConnectionSetActive({ accountPubkey: ACCOUNT, connectionId: 'wallet-a2' });

    const active = vaultData
      .nip47Connections!.filter((item) => item.isActive)
      .map((item) => item.id)
      .sort();
    expect(active).toEqual(['wallet-a2', 'wallet-b']);
  });

  it('records a payment against the paying account and lists it only for that account', async () => {
    vi.mocked(nip47Client.payInvoice).mockResolvedValue({ preimage: 'preimage', raw: {} });

    await handleNip47PayInvoice({
      accountPubkey: OTHER,
      connectionId: 'wallet-b',
      invoice: INVOICE,
    });

    expect(vaultData.nip47PaymentHistory?.[0]).toMatchObject({
      accountPubkey: OTHER,
      connectionId: 'wallet-b',
    });
    const mine = await handleNip47PaymentHistoryList({ accountPubkey: ACCOUNT });
    const theirs = await handleNip47PaymentHistoryList({ accountPubkey: OTHER });
    expect(mine.success && mine.data).toEqual([]);
    expect(theirs.success && theirs.data).toHaveLength(1);
  });

  it('imports a connection for the named account without touching another account’s active wallet', async () => {
    vi.mocked(parseNwcUri).mockReturnValue({
      walletServicePubkey: 'wallet-service-pubkey',
      clientSecret: 'aa'.repeat(32),
      relays: ['wss://relay.example.com/'],
    });
    vi.mocked(buildNip47ConnectionId).mockReturnValue('nip47:imported');

    await handleNip47ConnectionImport({ accountPubkey: OTHER, uri: 'nostr+walletconnect://...' });

    const byId = Object.fromEntries(vaultData.nip47Connections!.map((item) => [item.id, item]));
    expect(byId['nip47:imported']).toMatchObject({ accountPubkey: OTHER, isActive: true });
    expect(byId['wallet-b']?.isActive).toBe(false);
    expect(byId['wallet-a']?.isActive).toBe(true);
  });

  it('fixes the account when the wallet popup opens, and saves the connection to it', async () => {
    vi.mocked(savePendingNip47Authorization).mockImplementation((entry) =>
      Promise.resolve({ ...entry, createdAt: 0, expiresAt: 1 }),
    );
    await handleNip47AuthorizationBegin({ accountPubkey: OTHER, provider: 'coinos' });
    const saved = vi.mocked(savePendingNip47Authorization).mock.calls[0]![0];
    expect(saved.accountPubkey).toBe(OTHER);

    vi.mocked(buildNip47ConnectionId).mockImplementation(
      (wallet, client) => `nip47:${wallet}:${client}`,
    );
    vi.mocked(takePendingNip47Authorization).mockResolvedValue({
      ...saved,
      createdAt: 0,
      expiresAt: Number.MAX_SAFE_INTEGER,
    });
    vi.mocked(nip47Client.getInfo).mockResolvedValue({
      pubkey: 'b'.repeat(64),
      capabilities: ['pay_invoice'],
      relays: [],
      encryption: [],
      notifications: [],
      rawContent: '',
      checkedAt: '2026-10-16T00:00:00.000Z',
    });

    const result = await handleNip47AuthorizationComplete({
      pendingId: saved.pendingId,
      walletServicePubkey: 'b'.repeat(64),
      relays: ['wss://relay.example.com'],
    });

    expect(result.success && result.data.accountPubkey).toBe(OTHER);
    expect(vaultData.nip47Connections!.find((item) => item.id === 'wallet-a')?.isActive).toBe(true);
  });

  it('saves nothing when the account was removed while the user was in the wallet’s popup', async () => {
    vi.mocked(takePendingNip47Authorization).mockResolvedValue({
      pendingId: 'p',
      accountPubkey: 'd'.repeat(64),
      providerId: 'coinos',
      origin: 'https://coinos.io',
      clientSecret: '1'.repeat(64),
      clientPubkey: 'client',
      createdAt: 0,
      expiresAt: Number.MAX_SAFE_INTEGER,
    });
    vi.mocked(nip47Client.getInfo).mockResolvedValue({
      pubkey: 'b'.repeat(64),
      capabilities: [],
      relays: [],
      encryption: [],
      notifications: [],
      rawContent: '',
      checkedAt: '2026-10-16T00:00:00.000Z',
    });

    await expect(
      handleNip47AuthorizationComplete({
        pendingId: 'p',
        walletServicePubkey: 'b'.repeat(64),
        relays: ['wss://relay.example.com'],
      }),
    ).rejects.toThrow('Account not found');
    expect(vaultData.nip47Connections).toHaveLength(2);
  });

  it('gives a 0.2.x wallet to the main account on the first wallet action, and writes it once', async () => {
    const legacy = buildConnection({ id: 'legacy' });
    delete (legacy as Partial<Nip47Connection>).accountPubkey;
    vaultData = { accounts: [OTHER_ACCOUNT, MAIN_ACCOUNT], nip47Connections: [legacy] };

    const theirs = await handleNip47ConnectionsList({ accountPubkey: OTHER });
    const mine = await handleNip47ConnectionsList({ accountPubkey: ACCOUNT });

    expect(theirs.success && theirs.data).toEqual([]);
    expect(mine.success && mine.data.map((item) => item.id)).toEqual(['legacy']);
    // Migrated on the first read; the second found nothing to change and wrote nothing.
    expect(updateVaultData).toHaveBeenCalledTimes(1);
    expect(vaultData.nip47Connections?.[0]?.accountPubkey).toBe(ACCOUNT);
  });
});

describe('vault lock (diogel-io/workspace#142, T22)', () => {
  it('clears pending wallet authorizations when the vault locks', () => {
    vi.mocked(clearPendingNip47Authorizations).mockClear();
    expect(lockListeners.length).toBeGreaterThan(0);

    for (const listener of lockListeners) listener();

    expect(clearPendingNip47Authorizations).toHaveBeenCalledTimes(1);
  });

  it('closes a wallet popup the background opened, and says why (workspace#85)', async () => {
    const remove = vi.fn(() => Promise.resolve());
    vi.stubGlobal('chrome', { windows: { remove } });
    vi.mocked(postWalletConnectOutcome).mockClear();
    vi.mocked(clearPendingNip47Authorizations).mockResolvedValueOnce([
      {
        pendingId: 'p',
        accountPubkey: ACCOUNT,
        providerId: 'alby-hub',
        origin: 'https://my.albyhub.com',
        clientSecret: '1'.repeat(64),
        clientPubkey: 'c',
        createdAt: 0,
        expiresAt: 1,
        popup: { windowId: 7, tabId: 70, requestId: 'req-1' },
      },
    ]);

    for (const listener of lockListeners) listener();
    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith(7));

    expect(postWalletConnectOutcome).toHaveBeenCalledWith('req-1', {
      status: 'error',
      message: expect.stringContaining('vault locked') as string,
    });
    vi.unstubAllGlobals();
  });
});

describe('a wallet popup the background owns (workspace#85)', () => {
  const WALLET = 'b'.repeat(64);
  const POPUP = { windowId: 7, tabId: 70, requestId: 'req-1' };
  const create = vi.fn();
  const remove = vi.fn(() => Promise.resolve());
  const get = vi.fn(() => Promise.resolve({ id: 7 }));
  const query = vi.fn(() => Promise.resolve([] as { id?: number }[]));
  let vaultData: VaultData;

  function pending(overrides: Partial<PendingNip47Authorization> = {}): PendingNip47Authorization {
    return {
      pendingId: 'pending-1',
      accountPubkey: ACCOUNT,
      providerId: 'alby-hub',
      origin: 'http://192.168.1.50:59000',
      clientSecret: '1'.repeat(64),
      clientPubkey: 'client-pubkey',
      createdAt: 0,
      expiresAt: Number.MAX_SAFE_INTEGER,
      popup: POPUP,
      ...overrides,
    };
  }

  const success = {
    type: 'nwc:success',
    walletPubkey: WALLET,
    relayUrls: ['wss://relay.getalby.com/v1'],
    lud16: 'alice@getalby.com',
  };
  const topFrame = { tabId: 70, frameId: 0, url: 'http://192.168.1.50:59000/apps/created' };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('chrome', { windows: { create, remove, get }, tabs: { query } });
    get.mockResolvedValue({ id: 7 });
    create.mockResolvedValue({ id: 7, tabs: [{ id: 70 }] });
    vaultData = { accounts: [MAIN_ACCOUNT], nip47Connections: [] };
    vi.mocked(getVaultData).mockImplementation(() => Promise.resolve({ success: true, vaultData }));
    vi.mocked(updateVaultData).mockImplementation((next) => {
      vaultData = next as VaultData;
      return Promise.resolve({ success: true });
    });
    vi.mocked(buildNip47ConnectionId).mockImplementation(
      (wallet, client) => `nip47:${wallet}:${client}`,
    );
    vi.mocked(savePendingNip47Authorization).mockImplementation((entry) =>
      Promise.resolve({ ...entry, createdAt: 0, expiresAt: 1 }),
    );
    vi.mocked(bindPendingNip47AuthorizationPopup).mockResolvedValue(true);
    vi.mocked(nip47Client.getInfo).mockResolvedValue({
      pubkey: WALLET,
      capabilities: ['pay_invoice'],
      relays: [],
      encryption: ['nip44_v2'],
      notifications: [],
      rawContent: '',
      checkedAt: '2026-10-24T00:00:00.000Z',
    });
    globalThis.crypto.randomUUID = vi.fn(
      () => 'pending-uuid',
    ) as () => `${string}-${string}-${string}-${string}-${string}`;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('handleNip47AuthorizationOpen', () => {
    it('opens the wallet itself, binds the popup, and returns no secret', async () => {
      const result = await handleNip47AuthorizationOpen({
        accountPubkey: ACCOUNT,
        provider: 'alby-hub',
        customOrigin: 'http://192.168.1.50:59000',
        requestId: 'req-1',
      });

      expect(result).toEqual({ success: true, data: { pendingId: 'pending-uuid' } });
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'popup',
          url: expect.stringMatching(/^http:\/\/192\.168\.1\.50:59000\/apps\/new\?/) as string,
        }),
      );
      expect(bindPendingNip47AuthorizationPopup).toHaveBeenCalledWith('pending-uuid', POPUP);
      expect(armWalletRelay).toHaveBeenCalledWith(70);
      expect(JSON.stringify(result)).not.toContain(
        vi.mocked(savePendingNip47Authorization).mock.calls[0]![0].clientSecret,
      );
    });

    it('closes and reports a popup an older authorization owned when it is pushed out', async () => {
      vi.mocked(savePendingNip47Authorization).mockImplementationOnce((entry, _now, onEvicted) => {
        onEvicted?.([
          pending({ pendingId: 'oldest', popup: { ...POPUP, windowId: 3, requestId: 'req-0' } }),
        ]);
        return Promise.resolve({ ...entry, createdAt: 0, expiresAt: 1 });
      });

      await handleNip47AuthorizationOpen({
        accountPubkey: ACCOUNT,
        provider: 'coinos',
        requestId: 'req-1',
      });

      expect(remove).toHaveBeenCalledWith(3);
      expect(postWalletConnectOutcome).toHaveBeenCalledWith('req-0', {
        status: 'error',
        message: expect.stringContaining('Too many wallet connections') as string,
      });
    });

    it('finds the tab when the new window does not list it', async () => {
      create.mockResolvedValue({ id: 7 });
      query.mockResolvedValue([{ id: 70 }]);

      await handleNip47AuthorizationOpen({
        accountPubkey: ACCOUNT,
        provider: 'coinos',
        requestId: 'req-1',
      });

      expect(query).toHaveBeenCalledWith({ windowId: 7 });
      expect(bindPendingNip47AuthorizationPopup).toHaveBeenCalledWith('pending-uuid', POPUP);
    });

    it('refuses without a request to report back to', async () => {
      await expect(
        handleNip47AuthorizationOpen({ accountPubkey: ACCOUNT, provider: 'coinos', requestId: '' }),
      ).rejects.toThrow('Missing wallet connection request');
      expect(create).not.toHaveBeenCalled();
    });

    it('drops the authorization and closes the window when a lock removed it meanwhile', async () => {
      vi.mocked(bindPendingNip47AuthorizationPopup).mockResolvedValue(false);

      await expect(
        handleNip47AuthorizationOpen({
          accountPubkey: ACCOUNT,
          provider: 'coinos',
          requestId: 'req-1',
        }),
      ).rejects.toThrow('vault locked');
      expect(takePendingNip47Authorization).toHaveBeenCalledWith('pending-uuid');
      expect(remove).toHaveBeenCalledWith(7);
    });
  });

  describe('a popup the user closed before it was bound', () => {
    it('is settled at once instead of left waiting', async () => {
      get.mockRejectedValue(new Error('No window with id: 7'));
      vi.mocked(findPendingNip47AuthorizationByPopup).mockResolvedValue(pending());
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(pending());

      await handleNip47AuthorizationOpen({
        accountPubkey: ACCOUNT,
        provider: 'alby-hub',
        customOrigin: 'http://192.168.1.50:59000',
        requestId: 'req-1',
      });

      expect(findPendingNip47AuthorizationByPopup).toHaveBeenCalledWith({ windowId: 7 });
      expect(postWalletConnectOutcome).toHaveBeenCalledWith('req-1', { status: 'no-response' });
      expect(armWalletRelay).not.toHaveBeenCalled();
    });
  });

  describe('handleNip47AuthorizationCancel', () => {
    it('drops the authorization and closes its popup', async () => {
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(pending());

      await expect(handleNip47AuthorizationCancel({ pendingId: 'pending-1' })).resolves.toEqual({
        success: true,
        data: true,
      });
      expect(takePendingNip47Authorization).toHaveBeenCalledWith('pending-1');
      expect(remove).toHaveBeenCalledWith(7);
      expect(postWalletConnectOutcome).not.toHaveBeenCalled();
    });

    it('stops a relayed answer it claimed from saving, and closes the popup', async () => {
      vi.mocked(findPendingNip47AuthorizationByPopup).mockResolvedValue(pending());
      vi.mocked(takePendingNip47Authorization)
        .mockResolvedValueOnce(pending())
        .mockResolvedValueOnce(null);
      let answer!: () => void;
      vi.mocked(nip47Client.getInfo).mockImplementation(
        () =>
          new Promise((resolve) => {
            answer = () =>
              resolve({
                pubkey: WALLET,
                capabilities: ['pay_invoice'],
                relays: [],
                encryption: [],
                notifications: [],
                rawContent: '',
                checkedAt: '2026-10-24T00:00:00.000Z',
              });
          }),
      );

      const relayed = handleNip47AuthorizationRelay(topFrame, success);
      await vi.waitFor(() => expect(nip47Client.getInfo).toHaveBeenCalled());
      await expect(handleNip47AuthorizationCancel({ pendingId: 'pending-1' })).resolves.toEqual({
        success: true,
        data: true,
      });
      answer();
      await relayed;

      expect(updateVaultData).not.toHaveBeenCalled();
      expect(postWalletConnectOutcome).not.toHaveBeenCalled();
      expect(remove).toHaveBeenCalledWith(7);
    });

    it('stops a Coinos check the closing popup started from saving', async () => {
      const coinos = pending({ providerId: 'coinos', origin: 'https://coinos.io' });
      vi.mocked(findPendingNip47AuthorizationByPopup).mockResolvedValue(coinos);
      vi.mocked(takePendingNip47Authorization)
        .mockResolvedValueOnce(coinos)
        .mockResolvedValueOnce(null);
      let answer!: () => void;
      vi.mocked(nip47Client.sendRequest).mockImplementation(
        () =>
          new Promise((resolve) => {
            answer = () =>
              resolve({ result_type: 'get_info', result: { methods: ['pay_invoice'] } });
          }),
      );

      const closing = handleNip47AuthorizationPopupClosed(7);
      await vi.waitFor(() => expect(nip47Client.sendRequest).toHaveBeenCalled());
      await handleNip47AuthorizationCancel({ pendingId: 'pending-1' });
      answer();
      await closing;

      expect(updateVaultData).not.toHaveBeenCalled();
      expect(postWalletConnectOutcome).not.toHaveBeenCalled();
    });

    it('does nothing for an authorization already settled', async () => {
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(null);

      await expect(handleNip47AuthorizationCancel({ pendingId: 'pending-1' })).resolves.toEqual({
        success: true,
        data: false,
      });
      expect(remove).not.toHaveBeenCalled();
    });
  });

  describe('handleNip47AuthorizationRelay', () => {
    it('saves the wallet the bound tab relayed, posts the outcome, and closes the popup', async () => {
      vi.mocked(findPendingNip47AuthorizationByPopup).mockResolvedValue(pending());
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(pending());

      await expect(handleNip47AuthorizationRelay(topFrame, success)).resolves.toBe(true);

      expect(findPendingNip47AuthorizationByPopup).toHaveBeenCalledWith({ tabId: 70 });
      expect(vaultData.nip47Connections?.[0]).toMatchObject({
        walletServicePubkey: WALLET,
        relays: ['wss://relay.getalby.com/v1'],
      });
      expect(postWalletConnectOutcome).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({ status: 'connected' }),
      );
      expect(remove).toHaveBeenCalledWith(7);
    });

    it.each([
      ['a subframe', { ...topFrame, frameId: 3 }, success],
      ['another origin', { ...topFrame, url: 'http://192.168.1.50:2000/app-auth' }, success],
      ['another scheme', { ...topFrame, url: 'https://192.168.1.50:59000/' }, success],
      ['a malformed url', { ...topFrame, url: 'not a url' }, success],
      ['another message type', topFrame, { ...success, type: 'nwc:other' }],
      ['a plaintext relay', topFrame, { ...success, relayUrls: ['ws://relay.example.com'] }],
    ])('ignores %s', async (_label, sender, message) => {
      vi.mocked(findPendingNip47AuthorizationByPopup).mockResolvedValue(pending());

      await expect(handleNip47AuthorizationRelay(sender, message)).resolves.toBe(false);

      expect(takePendingNip47Authorization).not.toHaveBeenCalled();
      expect(postWalletConnectOutcome).not.toHaveBeenCalled();
    });

    it('ignores a tab no pending authorization owns', async () => {
      vi.mocked(findPendingNip47AuthorizationByPopup).mockResolvedValue(null);

      await expect(handleNip47AuthorizationRelay(topFrame, success)).resolves.toBe(false);
      expect(postWalletConnectOutcome).not.toHaveBeenCalled();
    });

    it('leaves the outcome to the popup closing when that claimed the authorization first', async () => {
      vi.mocked(findPendingNip47AuthorizationByPopup).mockResolvedValue(pending());
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(null);

      await expect(handleNip47AuthorizationRelay(topFrame, success)).resolves.toBe(false);
      expect(postWalletConnectOutcome).not.toHaveBeenCalled();
    });

    it('reports the error when the wallet does not answer', async () => {
      vi.mocked(findPendingNip47AuthorizationByPopup).mockResolvedValue(pending());
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(pending());
      vi.mocked(nip47Client.getInfo).mockRejectedValue(new Error('No answer from the wallet'));

      await handleNip47AuthorizationRelay(topFrame, success);

      expect(postWalletConnectOutcome).toHaveBeenCalledWith('req-1', {
        status: 'error',
        message: 'No answer from the wallet',
      });
      expect(updateVaultData).not.toHaveBeenCalled();
    });
  });

  describe('handleNip47AuthorizationPopupClosed', () => {
    it('reports no response for a wallet it cannot ask directly', async () => {
      vi.mocked(findPendingNip47AuthorizationByPopup).mockResolvedValue(pending());
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(pending());

      await handleNip47AuthorizationPopupClosed(7);

      expect(findPendingNip47AuthorizationByPopup).toHaveBeenCalledWith({ windowId: 7 });
      expect(postWalletConnectOutcome).toHaveBeenCalledWith('req-1', { status: 'no-response' });
    });

    it('saves a Coinos approval it confirms with the wallet', async () => {
      const coinos = pending({ providerId: 'coinos', origin: 'https://coinos.io' });
      vi.mocked(findPendingNip47AuthorizationByPopup).mockResolvedValue(coinos);
      vi.mocked(takePendingNip47Authorization).mockResolvedValue(coinos);
      vi.mocked(nip47Client.sendRequest).mockResolvedValue({
        result_type: 'get_info',
        result: { methods: ['pay_invoice'] },
      });

      await handleNip47AuthorizationPopupClosed(7);

      expect(postWalletConnectOutcome).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({ status: 'connected' }),
      );
    });

    it('does nothing for a window no pending authorization owns, or one already settled', async () => {
      vi.mocked(findPendingNip47AuthorizationByPopup).mockResolvedValueOnce(null);
      await handleNip47AuthorizationPopupClosed(8);

      vi.mocked(findPendingNip47AuthorizationByPopup).mockResolvedValueOnce(pending());
      vi.mocked(takePendingNip47Authorization).mockResolvedValueOnce(null);
      await handleNip47AuthorizationPopupClosed(7);

      expect(postWalletConnectOutcome).not.toHaveBeenCalled();
    });
  });
});
