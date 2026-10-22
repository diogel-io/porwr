import type { HandlerResult } from '../types/background';
import type { VaultData } from '@/types/bridge';
import type {
  WebLnEnableRequest,
  WebLnGetInfoRequest,
  WebLnGetInfoResponse,
  WebLnSendPaymentRequest,
  WebLnSendPaymentResponse,
} from '@/types/webln';
import type { Nip47Connection } from '@/types/nip47';
import { isVaultUnlocked } from '../vault';
import { findActiveNip47Connection } from '../services/nip47-connection-store';
import { resolveSigningAccount } from '../services/signing-account';
import { mutateVault } from '../services/vault-mutation';
import { handleNip47PayInvoice } from './nip47';
import { readWalletVault } from '../services/wallet-vault';
import { hasWebLnPermission, upsertWebLnPermission } from '../services/webln-permission-store';

export const NO_WALLET_FOR_ACCOUNT = 'No wallet is configured for this account.';

/**
 * The wallet a site's WebLN calls use: the active connection of the account the site is connected
 * as (#304).
 *
 * The account is resolved exactly as for a NIP-07 request, so a site pays from the wallet of the
 * account it signs as. An unbound site binds to the active account; a site whose account was
 * removed fails closed rather than paying from whichever account happens to be active.
 */
async function resolveWebLnWallet(
  origin: string,
): Promise<{ vaultData: VaultData; connection: Nip47Connection }> {
  if (!isVaultUnlocked()) {
    throw new Error('Vault is locked. Unlock Porwr before using WebLN.');
  }
  const resolved = await resolveSigningAccount(origin);
  if ('error' in resolved) {
    throw new Error(resolved.error);
  }

  const vaultData = await readWalletVault();
  const connection = findActiveNip47Connection(vaultData, resolved.account.id);
  if (!connection) {
    throw new Error(NO_WALLET_FOR_ACCOUNT);
  }
  return { vaultData, connection };
}

/**
 * Refuses a wallet that has advertised its methods without `pay_invoice`. Until its info event has
 * been read (`lastInfoCheckedAt`), an empty list means unknown, as for a connection just imported
 * from a URI; after that it means the wallet advertises nothing, the rule payments apply (#142).
 */
function assertPayInvoiceSupport(connection: {
  capabilities: string[];
  lastInfoCheckedAt?: string;
}): void {
  const known = connection.capabilities.length > 0 || connection.lastInfoCheckedAt !== undefined;
  if (known && !connection.capabilities.includes('pay_invoice')) {
    throw new Error('The active wallet connection does not advertise pay_invoice support.');
  }
}

function normalizeInvoice(paymentRequest: string): string {
  const invoice = paymentRequest.trim();
  if (!invoice || !/^ln(?:bc|tb|bcrt)[a-z0-9]+$/i.test(invoice)) {
    throw new Error('WebLN sendPayment requires a BOLT11 invoice.');
  }
  return invoice;
}

export async function handleWebLnEnable(payload: WebLnEnableRequest): Promise<HandlerResult<true>> {
  if (!payload.approved) {
    throw new Error('WebLN access was rejected by the user.');
  }
  const { connection } = await resolveWebLnWallet(payload.origin);
  assertPayInvoiceSupport(connection);

  // On the shared queue, against the vault as it is now, not the copy read above.
  await mutateVault((vault) => ({
    vault: upsertWebLnPermission(vault, {
      origin: payload.origin,
      connectionId: connection.id,
      methods: ['enable', 'getInfo'],
      createdAt: new Date().toISOString(),
    }),
    result: undefined,
  }));
  return { success: true, data: true };
}

export async function handleWebLnGetInfo(
  payload: WebLnGetInfoRequest,
): Promise<HandlerResult<WebLnGetInfoResponse>> {
  const { vaultData, connection } = await resolveWebLnWallet(payload.origin);
  if (
    !hasWebLnPermission(vaultData, {
      origin: payload.origin,
      connectionId: connection.id,
      method: 'getInfo',
    })
  ) {
    throw new Error('WebLN access has not been enabled for this site.');
  }

  return {
    success: true,
    data: {
      node: {
        alias: connection.label || 'Porwr Wallet',
        pubkey: connection.walletServicePubkey,
      },
    },
  };
}

export async function handleWebLnSendPayment(
  payload: WebLnSendPaymentRequest,
): Promise<HandlerResult<WebLnSendPaymentResponse>> {
  if (!payload.approved) {
    throw new Error('WebLN payment was rejected by the user.');
  }
  const invoice = normalizeInvoice(payload.paymentRequest);
  const { vaultData, connection } = await resolveWebLnWallet(payload.origin);
  assertPayInvoiceSupport(connection);
  if (
    !hasWebLnPermission(vaultData, {
      origin: payload.origin,
      connectionId: connection.id,
      method: 'enable',
    })
  ) {
    throw new Error('WebLN access has not been enabled for this site.');
  }

  const result = await handleNip47PayInvoice({
    accountPubkey: connection.accountPubkey,
    connectionId: connection.id,
    invoice,
  });
  if (!result.success) {
    throw new Error(result.error);
  }
  return { success: true, data: { preimage: result.data.preimage } };
}
