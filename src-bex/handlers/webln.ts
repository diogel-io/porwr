import type { HandlerResult } from '../types/background';
import type { VaultData } from '@/types/bridge';
import type {
  WebLnEnableRequest,
  WebLnGetInfoRequest,
  WebLnGetInfoResponse,
  WebLnMethod,
  WebLnSendPaymentRequest,
  WebLnSendPaymentResponse,
} from '@/types/webln';
import type { Nip47Connection } from '@/types/nip47';
import { isVaultUnlocked } from '../vault';
import { findActiveNip47Connection } from '../services/nip47-connection-store';
import { resolveSigningAccount } from '../services/signing-account';
import { mutateVault } from '../services/vault-mutation';
import { handleNip47PayInvoice, LOCKED_BEFORE_PAYMENT } from './nip47';
import { Nip47ResponseTimeoutError } from '../services/nip47-client';
import { describeError, LogLevel, logService } from '@/services/log-service';
import { readWalletVault } from '../services/wallet-vault';
import { NO_INVOICE_MESSAGE } from '../services/request-limits';
import {
  hasWebLnPermission,
  removeWebLnPermissionsForOrigin,
  upsertWebLnPermission,
} from '../services/webln-permission-store';
import {
  grantWebLnForPage,
  hasWebLnPageGrant,
  revokeWebLnPageGrants,
} from '../services/webln-session-grants';

export const NO_WALLET_FOR_ACCOUNT = 'No wallet is configured for this account.';
export const NOT_A_BOLT11_INVOICE = 'The invoice given is not a BOLT11 Lightning invoice.';
export const WEBLN_PAYMENT_FAILED = 'The payment failed.';
export const WEBLN_PAYMENT_UNCONFIRMED =
  'The wallet did not answer in time. The payment may still complete, so check your wallet before trying again.';

/**
 * What a site is told when a payment does not complete (porwr#370).
 *
 * Never the failure's own text: a wallet's error can hint at its balance or state, and a relay
 * failure can name the user's wallet relay. Only Porwr's own message for a payment refused before it
 * was sent is passed on. A timeout is not a failure, since the wallet may still pay, and saying
 * "failed" would invite the site to pay again.
 */
function paymentFailureForSite(error: unknown): string {
  if (error instanceof Error && error.message === LOCKED_BEFORE_PAYMENT)
    return LOCKED_BEFORE_PAYMENT;
  if (error instanceof Nip47ResponseTimeoutError) return WEBLN_PAYMENT_UNCONFIRMED;
  return WEBLN_PAYMENT_FAILED;
}

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
  if (!invoice) throw new Error(NO_INVOICE_MESSAGE);
  if (!/^ln(?:bc|tb|bcrt)[a-z0-9]+$/i.test(invoice)) throw new Error(NOT_A_BOLT11_INVOICE);
  return invoice;
}

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

/**
 * Whether a site may use WebLN with this connection: a stored grant, or one allowed for the visit
 * of a page that is still open.
 */
function isWebLnAllowed(
  vaultData: VaultData,
  origin: string,
  connectionId: string,
  method: WebLnMethod,
): boolean {
  return (
    hasWebLnPermission(vaultData, { origin, connectionId, method }) ||
    hasWebLnPageGrant(origin, connectionId)
  );
}

/**
 * Allow WebLN for a site for as long as the user chose (porwr#369).
 *
 * `always` is stored with no expiry and `8h` with one. `once` is this visit: nothing is stored, and
 * the access ends when `page` aborts. Without a page to tie it to there is nothing to grant, so the
 * site has to ask again. The newest decision replaces whatever the site held for this connection,
 * because `enable` asks the user every time.
 */
export async function handleWebLnEnable(
  payload: WebLnEnableRequest,
  page?: AbortSignal,
): Promise<HandlerResult<true>> {
  if (!payload.approved) {
    throw new Error('WebLN access was rejected by the user.');
  }
  const { connection } = await resolveWebLnWallet(payload.origin);
  assertPayInvoiceSupport(connection);

  const duration = payload.duration ?? 'once';
  const now = Date.now();
  revokeWebLnPageGrants(payload.origin, connection.id);

  // On the shared queue, against the vault as it is now, not the copy read above.
  await mutateVault((vault) => ({
    vault:
      duration === 'once'
        ? removeWebLnPermissionsForOrigin(vault, payload.origin, new Set([connection.id]))
        : upsertWebLnPermission(vault, {
            origin: payload.origin,
            connectionId: connection.id,
            methods: ['enable', 'getInfo'],
            createdAt: new Date(now).toISOString(),
            ...(duration === '8h'
              ? { expiresAt: new Date(now + EIGHT_HOURS_MS).toISOString() }
              : {}),
          }),
    result: undefined,
  }));

  if (duration === 'once' && page) grantWebLnForPage(payload.origin, connection.id, page);
  return { success: true, data: true };
}

export async function handleWebLnGetInfo(
  payload: WebLnGetInfoRequest,
): Promise<HandlerResult<WebLnGetInfoResponse>> {
  const { vaultData, connection } = await resolveWebLnWallet(payload.origin);
  if (!isWebLnAllowed(vaultData, payload.origin, connection.id, 'getInfo')) {
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
  if (!isWebLnAllowed(vaultData, payload.origin, connection.id, 'enable')) {
    throw new Error('WebLN access has not been enabled for this site.');
  }

  let result: Awaited<ReturnType<typeof handleNip47PayInvoice>>;
  try {
    result = await handleNip47PayInvoice({
      accountPubkey: connection.accountPubkey,
      connectionId: connection.id,
      invoice,
    });
  } catch (error: unknown) {
    logService.log(LogLevel.WARN, '[WebLN] Payment did not complete', {
      error: describeError(error),
    });
    throw new Error(paymentFailureForSite(error));
  }
  if (!result.success) {
    throw new Error(WEBLN_PAYMENT_FAILED);
  }
  return { success: true, data: { preimage: result.data.preimage } };
}
