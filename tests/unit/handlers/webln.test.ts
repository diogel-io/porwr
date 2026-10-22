import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleWebLnEnable,
  handleWebLnGetInfo,
  handleWebLnSendPayment,
} from '@/../src-bex/handlers/webln';
import { getVaultData, isVaultUnlocked, updateVaultData } from '@/../src-bex/vault';
import { handleNip47PayInvoice } from '@/../src-bex/handlers/nip47';
import { resolveSigningAccount } from '@/../src-bex/services/signing-account';
import type { StoredKey, VaultData } from '@/types/bridge';
import type { Nip47Connection } from '@/types/nip47';
import { ErrorCode } from '@/types/error-codes.d';

vi.mock('@/../src-bex/vault', () => ({
  getVaultData: vi.fn(),
  updateVaultData: vi.fn(),
  isVaultUnlocked: vi.fn(() => true),
}));

vi.mock('@/../src-bex/services/signing-account', () => ({
  resolveSigningAccount: vi.fn(),
}));

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const account = (id: string, alias: string): StoredKey => ({
  id,
  alias,
  account: { privkey: '1'.repeat(64) },
  createdAt: '2026-01-01T00:00:00.000Z',
});
const ACCOUNTS = [account(ALICE, 'Main Account'), account(BOB, 'work')];

/** The account the requesting site is connected as. */
function siteConnectedAs(pubkey: string): void {
  const found = ACCOUNTS.find((item) => item.id === pubkey)!;
  vi.mocked(resolveSigningAccount).mockResolvedValue({ account: found });
}

vi.mock('@/../src-bex/handlers/nip47', () => ({
  handleNip47PayInvoice: vi.fn(),
}));

function buildConnection(overrides: Partial<Nip47Connection> = {}): Nip47Connection {
  return {
    id: 'wallet-a',
    accountPubkey: ALICE,
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
    vi.mocked(isVaultUnlocked).mockReturnValue(true);
    siteConnectedAs(ALICE);
  });

  it('enables WebLN access for the active NIP-47 connection', async () => {
    mockVault({ accounts: ACCOUNTS, nip47Connections: [buildConnection()] });

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
      accounts: ACCOUNTS,
      nip47Connections: [buildConnection()],
      webLnPermissions: [
        {
          origin: 'https://jumble.social',
          connectionId: 'wallet-a',
          methods: ['enable', 'getInfo'],
          createdAt: '2026-06-23T00:00:00.000Z',
        },
      ],
    });

    const result = await handleWebLnGetInfo({ origin: 'https://jumble.social' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.node).toEqual({ alias: 'Wallet A', pubkey: 'f'.repeat(64) });
    }
  });

  it('pays a BOLT11 invoice through the active NIP-47 connection', async () => {
    mockVault({
      accounts: ACCOUNTS,
      nip47Connections: [buildConnection()],
      webLnPermissions: [
        {
          origin: 'https://jumble.social',
          connectionId: 'wallet-a',
          methods: ['enable'],
          createdAt: '2026-06-23T00:00:00.000Z',
        },
      ],
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
      accountPubkey: ALICE,
      connectionId: 'wallet-a',
      invoice: 'lnbc1u1pjqxyz',
    });
  });

  it('rejects sendPayment when WebLN has not been enabled for the origin', async () => {
    mockVault({ accounts: ACCOUNTS, nip47Connections: [buildConnection()] });

    await expect(
      handleWebLnSendPayment({
        origin: 'https://jumble.social',
        paymentRequest: 'lnbc1u1pjqxyz',
        approved: true,
      }),
    ).rejects.toThrow('has not been enabled');
  });

  it('rejects wallets that do not advertise pay_invoice support', async () => {
    mockVault({
      accounts: ACCOUNTS,
      nip47Connections: [buildConnection({ capabilities: ['get_info'] })],
    });

    await expect(
      handleWebLnEnable({ origin: 'https://jumble.social', approved: true }),
    ).rejects.toThrow('does not advertise pay_invoice support');
  });

  // The same rule payments use (#142): once the info event has been read, an empty list means the
  // wallet advertises nothing; before that, it means unknown.
  it('rejects a wallet whose info event was read and lists no methods', async () => {
    mockVault({
      accounts: ACCOUNTS,
      nip47Connections: [
        buildConnection({ capabilities: [], lastInfoCheckedAt: '2026-10-22T00:00:00.000Z' }),
      ],
    });

    await expect(
      handleWebLnEnable({ origin: 'https://jumble.social', approved: true }),
    ).rejects.toThrow('does not advertise pay_invoice support');
  });

  it('allows a wallet whose methods are not known yet, as for a connection just imported', async () => {
    mockVault({ accounts: ACCOUNTS, nip47Connections: [buildConnection({ capabilities: [] })] });

    await expect(
      handleWebLnEnable({ origin: 'https://jumble.social', approved: true }),
    ).resolves.toMatchObject({ success: true });
  });

  describe('pays from the wallet of the account the site is connected as (#304)', () => {
    const vault = (): VaultData => ({
      accounts: ACCOUNTS,
      nip47Connections: [buildConnection({ id: 'alice-wallet', accountPubkey: ALICE })],
      webLnPermissions: [
        {
          origin: 'https://jumble.social',
          connectionId: 'alice-wallet',
          methods: ['enable', 'getInfo'],
          createdAt: '2026-06-23T00:00:00.000Z',
        },
      ],
    });

    it('will not let a site connected as Bob pay with Alice’s wallet', async () => {
      mockVault(vault());
      siteConnectedAs(BOB);

      const request = {
        origin: 'https://jumble.social',
        paymentRequest: 'lnbc1u1pjqxyz',
        approved: true,
      };
      await expect(handleWebLnSendPayment(request)).rejects.toThrow(
        'No wallet is configured for this account.',
      );
      await expect(handleWebLnGetInfo({ origin: 'https://jumble.social' })).rejects.toThrow(
        'No wallet is configured',
      );
      await expect(
        handleWebLnEnable({ origin: 'https://jumble.social', approved: true }),
      ).rejects.toThrow('No wallet is configured');
      expect(handleNip47PayInvoice).not.toHaveBeenCalled();
    });

    it('uses Bob’s own wallet once he has one, and needs it enabled separately', async () => {
      const data = vault();
      data.nip47Connections!.push(buildConnection({ id: 'bob-wallet', accountPubkey: BOB }));
      mockVault(data);
      siteConnectedAs(BOB);

      // Alice's grant was on Alice's wallet; Bob's wallet has none yet.
      await expect(
        handleWebLnSendPayment({
          origin: 'https://jumble.social',
          paymentRequest: 'lnbc1u1pjqxyz',
          approved: true,
        }),
      ).rejects.toThrow('has not been enabled');

      await handleWebLnEnable({ origin: 'https://jumble.social', approved: true });
      const saved = vi.mocked(updateVaultData).mock.calls.at(-1)?.[0] as VaultData;
      expect(saved.webLnPermissions?.map((grant) => grant.connectionId)).toEqual([
        'alice-wallet',
        'bob-wallet',
      ]);
    });

    it('fails closed when the site’s account is gone, rather than paying from the active one', async () => {
      mockVault(vault());
      vi.mocked(resolveSigningAccount).mockResolvedValue({
        error: 'The account this site is connected to is no longer available',
        code: ErrorCode.SIG_NO_ACTIVE_KEY,
      });

      await expect(
        handleWebLnSendPayment({
          origin: 'https://jumble.social',
          paymentRequest: 'lnbc1u1pjqxyz',
          approved: true,
        }),
      ).rejects.toThrow('no longer available');
      expect(handleNip47PayInvoice).not.toHaveBeenCalled();
    });

    it('resolves the site’s account with the same rule as NIP-07', async () => {
      mockVault(vault());

      await handleWebLnGetInfo({ origin: 'https://jumble.social' });

      expect(resolveSigningAccount).toHaveBeenCalledWith('https://jumble.social');
    });

    it('refuses while the vault is locked', async () => {
      vi.mocked(isVaultUnlocked).mockReturnValue(false);

      await expect(handleWebLnGetInfo({ origin: 'https://jumble.social' })).rejects.toThrow(
        'Vault is locked',
      );
      expect(resolveSigningAccount).not.toHaveBeenCalled();
    });
  });
});
