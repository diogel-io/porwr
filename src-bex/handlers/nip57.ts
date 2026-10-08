import type { HandlerResult } from '../types/background';
import type { StoredKey } from '@/types';
import { resolveSigningAccount } from '../services/signing-account';
import type { VaultData } from '@/types/bridge';
import type {
  Nip57ZapHistoryEntry,
  SendZapErrorCode,
  SendZapRequest,
  SendZapResult,
  ZapCapabilities,
} from '@/types/nip57';
import { getVaultData, updateVaultData } from '../vault';
import { findNip47Connection, listNip47Connections } from '../services/nip47-connection-store';
import { nip47Client } from '../services/nip47-client';
import { appendNip57ZapHistory, listNip57ZapHistory } from '../services/nip57-zap-history-store';
import { assertLnurlAmount, fetchLnurlPayTarget, requestZapInvoice } from '@/services/nip57-lnurl';
import { signZapRequest } from '@/services/nip57-zap-request';
import { parseBolt11AmountMsat, previewInvoice } from '@/services/nip47-invoice';

async function requireUnlockedVaultData(): Promise<VaultData> {
  const result = await getVaultData();
  if (!result.success || !result.vaultData) {
    throw new Error('Vault is locked. Unlock Porwr before sending a zap.');
  }
  return result.vaultData as VaultData;
}

/**
 * The account a zap is sent from.
 *
 * A zap request is a signed Nostr event carrying the sender's identity, so it follows the same rule
 * as every other site-initiated action: the site's bound account, never whichever is active (#116).
 * Falling back to `accounts[0]` when nothing is active, as this used to, could attribute a payment
 * to an identity the user never chose.
 */
async function getZapAccount(vaultData: VaultData, origin: string): Promise<StoredKey | undefined> {
  const resolved = await resolveSigningAccount(origin);
  if ('error' in resolved) return undefined;

  // Resolved against the vault snapshot this call already holds, so the account and the wallet
  // connection below are read from one consistent view.
  return vaultData.accounts.find((account) => account.id === resolved.account.id);
}

function normalizeAmountMsat(request: SendZapRequest): number {
  const hasSats = request.amountSats !== undefined;
  const hasMsat = request.amountMsat !== undefined;
  if (hasSats === hasMsat) {
    throw new Error('Request must include exactly one of amountSats or amountMsat');
  }
  const amountMsat = hasMsat && request.amountMsat !== undefined
    ? request.amountMsat
    : Number(request.amountSats) * 1000;
  if (!Number.isSafeInteger(amountMsat) || amountMsat <= 0) {
    throw new Error('Zap amount must be a positive integer millisat value');
  }
  return amountMsat;
}

function buildTargetResult(request: SendZapRequest): SendZapResult['target'] {
  if (request.target.type === 'event') {
    return { eventId: request.target.eventId, eventKind: request.target.eventKind };
  }
  if (request.target.type === 'addressable') {
    return { coordinate: request.target.coordinate, eventKind: request.target.eventKind };
  }
  return undefined;
}

function pickReceiptRelays(request: SendZapRequest): string[] {
  const relays = request.receiptRelays ?? (request.target.type === 'profile' ? [] : request.target.eventRelays ?? []);
  return [...new Set(relays.map((relay) => relay.trim()).filter((relay) => relay.length > 0))];
}

function classifyError(error: unknown): SendZapErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Vault is locked')) return 'VAULT_LOCKED';
  if (message.includes('active account')) return 'NO_ACTIVE_ACCOUNT';
  if (message.includes('wallet')) return 'NO_ACTIVE_WALLET';
  if (message.includes('pay_invoice')) return 'WALLET_UNSUPPORTED';
  if (message.includes('LNURL endpoint does not support')) return 'LNURL_UNSUPPORTED_NOSTR';
  if (message.includes('between') || message.includes('amount')) return 'INVALID_AMOUNT';
  if (message.includes('callback')) return 'LNURL_CALLBACK_FAILED';
  if (message.includes('invoice')) return 'INVOICE_INVALID';
  return 'PAYMENT_FAILED';
}

function buildHistoryEntry(input: {
  request: SendZapRequest;
  origin: string;
  connectionId: string;
  connectionLabel: string;
  senderPubkey: string;
  amountMsat: number;
  lnurl: string;
  status: Nip57ZapHistoryEntry['status'];
  invoice?: string;
  paymentHash?: string;
  feesPaidMsat?: number;
  zapRequestId?: string;
  error?: string;
}): Nip57ZapHistoryEntry {
  return {
    id: crypto.randomUUID(),
    origin: input.origin,
    connectionId: input.connectionId,
    connectionLabel: input.connectionLabel,
    senderPubkey: input.senderPubkey,
    recipientPubkey: input.request.target.recipientPubkey,
    amountMsat: input.amountMsat,
    ...(input.request.comment?.trim() ? { comment: input.request.comment.trim() } : {}),
    targetType: input.request.target.type,
    ...(input.request.target.type === 'event' ? { eventId: input.request.target.eventId, eventKind: input.request.target.eventKind } : {}),
    ...(input.request.target.type === 'addressable' ? { coordinate: input.request.target.coordinate, eventKind: input.request.target.eventKind } : {}),
    lnurl: input.lnurl,
    ...(input.invoice ? { invoicePreview: previewInvoice(input.invoice) } : {}),
    ...(input.paymentHash ? { paymentHash: input.paymentHash } : {}),
    ...(input.feesPaidMsat !== undefined ? { feesPaidMsat: input.feesPaidMsat } : {}),
    ...(input.zapRequestId ? { zapRequestId: input.zapRequestId } : {}),
    status: input.status,
    ...(input.error ? { error: input.error } : {}),
    createdAt: new Date().toISOString(),
  };
}

export async function handleNip57GetCapabilities(): Promise<HandlerResult<ZapCapabilities>> {
  const vaultData = await requireUnlockedVaultData();
  const activeConnection = listNip47Connections(vaultData).find((connection) => connection.isActive);
  return {
    success: true,
    data: {
      available: Boolean(activeConnection),
      ...(activeConnection
        ? {
            activeWalletConnection: {
              id: activeConnection.id,
              label: activeConnection.label,
              supportsPayInvoice: activeConnection.capabilities.length === 0 || activeConnection.capabilities.includes('pay_invoice'),
            },
          }
        : {}),
      requiresConfirmation: true,
      supportsComments: true,
      supportsEventZap: true,
      supportsProfileZap: true,
      supportsAddressableZap: true,
    },
  };
}

export async function handleNip57ZapHistoryList(): Promise<HandlerResult<Nip57ZapHistoryEntry[]>> {
  const vaultData = await requireUnlockedVaultData();
  return { success: true, data: listNip57ZapHistory(vaultData) };
}

export async function handleNip57SendZap(payload: {
  request: SendZapRequest;
  origin: string;
  approved?: boolean;
}): Promise<HandlerResult<SendZapResult>> {
  if (!payload.approved) {
    return {
      success: true,
      data: {
        status: 'cancelled',
        amountMsat: 0,
        recipientPubkey: payload.request.target.recipientPubkey,
        error: 'Zap payment was not approved',
        code: 'USER_REJECTED',
      },
    };
  }

  const amountMsat = normalizeAmountMsat(payload.request);
  const vaultData = await requireUnlockedVaultData();
  const account = await getZapAccount(vaultData, payload.origin);
  if (!account) {
    throw new Error('No account is available for this site');
  }
  const connection = payload.request.walletConnectionId
    ? findNip47Connection(vaultData, payload.request.walletConnectionId)
    : listNip47Connections(vaultData).find((item) => item.isActive);
  if (!connection) {
    throw new Error('No active NIP-47 wallet connection');
  }
  if (connection.capabilities.length > 0 && !connection.capabilities.includes('pay_invoice')) {
    throw new Error('This wallet connection does not advertise pay_invoice support.');
  }

  const relays = pickReceiptRelays(payload.request);
  if (relays.length === 0) {
    throw new Error('At least one receipt relay is required');
  }

  let invoice = '';
  let zapRequestId = '';
  let lnurl = '';
  try {
    const lnurlTarget = await fetchLnurlPayTarget({
      ...(payload.request.lnurl ? { lnurl: payload.request.lnurl } : {}),
      ...(payload.request.lud16 ? { lud16: payload.request.lud16 } : {}),
    });
    lnurl = lnurlTarget.lnurl;
    assertLnurlAmount(amountMsat, lnurlTarget);
    const signedZapRequest = signZapRequest(
      {
        senderPubkey: account.id,
        recipientPubkey: payload.request.target.recipientPubkey,
        amountMsat,
        lnurl: lnurlTarget.lnurl,
        relays,
        ...(payload.request.comment ? { comment: payload.request.comment } : {}),
        target: payload.request.target,
      },
      account.account.privkey,
    );
    zapRequestId = signedZapRequest.id;
    const invoiceResponse = await requestZapInvoice({
      callback: lnurlTarget.callback,
      amountMsat,
      signedZapRequest,
      lnurl: lnurlTarget.lnurl,
    });
    invoice = invoiceResponse.invoice;
    const invoiceAmountMsat = parseBolt11AmountMsat(invoice);
    if (invoiceAmountMsat !== undefined && invoiceAmountMsat !== amountMsat) {
      throw new Error('Returned invoice amount does not match requested zap amount');
    }
    const payment = await nip47Client.payInvoice(connection, invoice);
    const latestVault = await requireUnlockedVaultData();
    await updateVaultData(appendNip57ZapHistory(latestVault, buildHistoryEntry({
      request: payload.request,
      origin: payload.origin,
      connectionId: connection.id,
      connectionLabel: connection.label,
      senderPubkey: account.id,
      amountMsat,
      lnurl,
      status: 'paid',
      invoice,
      ...(payment.paymentHash ? { paymentHash: payment.paymentHash } : {}),
      ...(payment.feesPaidMsat !== undefined ? { feesPaidMsat: payment.feesPaidMsat } : {}),
      zapRequestId,
    })));
    const target = buildTargetResult(payload.request);
    return {
      success: true,
      data: {
        status: 'paid',
        amountMsat,
        recipientPubkey: payload.request.target.recipientPubkey,
        zapRequestId,
        invoice,
        ...(payment.paymentHash ? { paymentHash: payment.paymentHash } : {}),
        ...(payment.feesPaidMsat !== undefined ? { feesPaidMsat: payment.feesPaidMsat } : {}),
        ...(target ? { target } : {}),
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const latestVault = await requireUnlockedVaultData();
    await updateVaultData(appendNip57ZapHistory(latestVault, buildHistoryEntry({
      request: payload.request,
      origin: payload.origin,
      connectionId: connection.id,
      connectionLabel: connection.label,
      senderPubkey: account.id,
      amountMsat,
      lnurl,
      status: 'failed',
      ...(invoice ? { invoice } : {}),
      ...(zapRequestId ? { zapRequestId } : {}),
      error: message,
    })));
    const target = buildTargetResult(payload.request);
    return {
      success: true,
      data: {
        status: 'failed',
        amountMsat,
        recipientPubkey: payload.request.target.recipientPubkey,
        ...(zapRequestId ? { zapRequestId } : {}),
        ...(invoice ? { invoice } : {}),
        ...(target ? { target } : {}),
        error: message,
        code: classifyError(error),
      },
    };
  }
}
