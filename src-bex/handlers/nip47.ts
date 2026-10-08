import { getPublicKey } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';
import type { HandlerResult } from '../types/background';
import type {
  ImportNip47ConnectionRequest,
  Nip47BalanceResponse,
  Nip47Connection,
  Nip47ConnectionSummary,
  Nip47InfoResponse,
  Nip47PayInvoiceRequest,
  Nip47PayInvoiceResponse,
  Nip47PaymentHistoryEntry,
} from '@/types/nip47';
import type { VaultData } from '@/types/bridge';
import { parseNwcUri, buildNip47ConnectionId } from '@/services/nip47-uri';
import { getVaultData, updateVaultData } from '../vault';
import {
  findNip47Connection,
  listNip47Connections,
  removeNip47Connection,
  setActiveNip47Connection,
  summarizeNip47Connection,
  upsertNip47Connection,
} from '../services/nip47-connection-store';
import { nip47Client } from '../services/nip47-client';
import {
  appendNip47PaymentHistory,
  listNip47PaymentHistory,
} from '../services/nip47-payment-history-store';
import { parseBolt11AmountMsat, previewInvoice } from '@/services/nip47-invoice';

async function requireUnlockedVaultData(): Promise<VaultData> {
  const result = await getVaultData();
  if (!result.success || !result.vaultData) {
    throw new Error(result.error || 'Vault is locked. Unlock Porwr before managing wallet connections.');
  }
  return result.vaultData as VaultData;
}

async function saveVaultData(vaultData: VaultData): Promise<void> {
  const result = await updateVaultData(vaultData);
  if (!result.success) {
    throw new Error(result.error || 'Failed to update vault data');
  }
}

let nip47VaultMutationQueue: Promise<void> = Promise.resolve();

async function waitForNip47VaultMutations(): Promise<void> {
  await nip47VaultMutationQueue;
}

async function mutateNip47Vault<T>(
  mutator: (vaultData: VaultData) => { vaultData: VaultData; data: T } | Promise<{ vaultData: VaultData; data: T }>,
): Promise<T> {
  const runMutation = async (): Promise<T> => {
    const vaultData = await requireUnlockedVaultData();
    const result = await mutator(vaultData);
    await saveVaultData(result.vaultData);
    return result.data;
  };

  const mutation = nip47VaultMutationQueue.then(runMutation, runMutation);
  nip47VaultMutationQueue = mutation.then(
    () => undefined,
    () => undefined,
  );
  return mutation;
}

function buildPaymentHistoryEntry(params: {
  connection: Nip47Connection;
  invoice: string;
  status: Nip47PaymentHistoryEntry['status'];
  paymentHash?: string;
  feesPaidMsat?: number;
  error?: string;
}): Nip47PaymentHistoryEntry {
  const amountMsat = parseBolt11AmountMsat(params.invoice);
  return {
    id: crypto.randomUUID(),
    connectionId: params.connection.id,
    connectionLabel: params.connection.label,
    invoicePreview: previewInvoice(params.invoice),
    status: params.status,
    createdAt: new Date().toISOString(),
    ...(amountMsat !== undefined ? { amountMsat } : {}),
    ...(params.paymentHash ? { paymentHash: params.paymentHash } : {}),
    ...(params.feesPaidMsat !== undefined ? { feesPaidMsat: params.feesPaidMsat } : {}),
    ...(params.error ? { error: params.error } : {}),
  };
}

export async function handleNip47ConnectionsList(): Promise<HandlerResult<Nip47ConnectionSummary[]>> {
  await waitForNip47VaultMutations();
  const vaultData = await requireUnlockedVaultData();
  return {
    success: true,
    data: listNip47Connections(vaultData).map(summarizeNip47Connection),
  };
}

export async function handleNip47ConnectionImport(
  payload: ImportNip47ConnectionRequest,
): Promise<HandlerResult<Nip47ConnectionSummary>> {
  const parsed = parseNwcUri(payload.uri);
  const clientPubkey = getPublicKey(hexToBytes(parsed.clientSecret));
  const id = buildNip47ConnectionId(parsed.walletServicePubkey, clientPubkey);

  const connection = await mutateNip47Vault((vaultData) => {
    const now = new Date().toISOString();
    const existing = findNip47Connection(vaultData, id);
    const nextConnection: Nip47Connection = {
      id,
      label: payload.label?.trim() || existing?.label || parsed.lud16 || 'Nostr Wallet Connect',
      walletServicePubkey: parsed.walletServicePubkey,
      clientSecret: parsed.clientSecret,
      clientPubkey,
      relays: parsed.relays,
      ...(parsed.lud16 ? { lud16: parsed.lud16 } : existing?.lud16 ? { lud16: existing.lud16 } : {}),
      capabilities: existing?.capabilities ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      isActive: existing?.isActive ?? true,
    };

    return {
      vaultData: upsertNip47Connection(vaultData, nextConnection),
      data: nextConnection,
    };
  });

  return { success: true, data: summarizeNip47Connection(connection) };
}

export async function handleNip47ConnectionRemove(
  payload: { connectionId: string },
): Promise<HandlerResult<boolean>> {
  await mutateNip47Vault((vaultData) => ({
    vaultData: removeNip47Connection(vaultData, payload.connectionId),
    data: true,
  }));
  return { success: true, data: true };
}

export async function handleNip47ConnectionSetActive(
  payload: { connectionId: string },
): Promise<HandlerResult<Nip47ConnectionSummary>> {
  const activeConnection = await mutateNip47Vault((vaultData) => {
    const updatedVaultData = setActiveNip47Connection(vaultData, payload.connectionId);
    const connection = findNip47Connection(updatedVaultData, payload.connectionId);
    if (!connection) {
      throw new Error('NIP-47 connection not found');
    }

    return {
      vaultData: updatedVaultData,
      data: connection,
    };
  });

  return { success: true, data: summarizeNip47Connection(activeConnection) };
}

export async function handleNip47GetInfo(payload: { connectionId: string }): Promise<HandlerResult<Nip47InfoResponse>> {
  const vaultData = await requireUnlockedVaultData();
  const connection = findNip47Connection(vaultData, payload.connectionId);
  if (!connection) {
    throw new Error('NIP-47 connection not found');
  }

  const info = await nip47Client.getInfo(connection);

  await mutateNip47Vault((latestVaultData) => {
    const latestConnection = findNip47Connection(latestVaultData, payload.connectionId) ?? connection;
    const updatedConnection: Nip47Connection = {
      ...latestConnection,
      capabilities: info.capabilities,
      lastInfoCheckedAt: info.checkedAt,
      updatedAt: new Date().toISOString(),
    };

    return {
      vaultData: upsertNip47Connection(latestVaultData, updatedConnection),
      data: true,
    };
  });
  return { success: true, data: info };
}

export async function handleNip47GetBalance(payload: { connectionId: string }): Promise<HandlerResult<Nip47BalanceResponse>> {
  await waitForNip47VaultMutations();
  const vaultData = await requireUnlockedVaultData();
  const connection = findNip47Connection(vaultData, payload.connectionId);
  if (!connection) {
    throw new Error('NIP-47 connection not found');
  }

  const balance = await nip47Client.getBalance(connection);
  return { success: true, data: balance };
}

export async function handleNip47PayInvoice(
  payload: Nip47PayInvoiceRequest,
): Promise<HandlerResult<Nip47PayInvoiceResponse>> {
  const vaultData = await requireUnlockedVaultData();
  const connection = findNip47Connection(vaultData, payload.connectionId);
  if (!connection) {
    throw new Error('NIP-47 connection not found');
  }

  // Defense-in-depth: the UI only offers payment when the wallet has advertised
  // pay_invoice support, but enforce it here too in case this handler is ever
  // invoked directly.
  if (connection.capabilities.length > 0 && !connection.capabilities.includes('pay_invoice')) {
    throw new Error('This wallet connection does not advertise pay_invoice support.');
  }

  const invoice = payload.invoice.trim();
  if (!invoice) {
    throw new Error('Lightning invoice is required');
  }

  try {
    const payment = await nip47Client.payInvoice(connection, invoice);
    await mutateNip47Vault((latestVaultData) => ({
      vaultData: appendNip47PaymentHistory(
        latestVaultData,
        buildPaymentHistoryEntry({
          connection,
          invoice,
          status: 'succeeded',
          ...(payment.paymentHash ? { paymentHash: payment.paymentHash } : {}),
          ...(payment.feesPaidMsat !== undefined ? { feesPaidMsat: payment.feesPaidMsat } : {}),
        }),
      ),
      data: true,
    }));
    return { success: true, data: payment };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await mutateNip47Vault((latestVaultData) => ({
      vaultData: appendNip47PaymentHistory(
        latestVaultData,
        buildPaymentHistoryEntry({
          connection,
          invoice,
          status: 'failed',
          error: message,
        }),
      ),
      data: true,
    }));
    throw error;
  }
}

export async function handleNip47PaymentHistoryList(): Promise<HandlerResult<Nip47PaymentHistoryEntry[]>> {
  await waitForNip47VaultMutations();
  const vaultData = await requireUnlockedVaultData();
  return {
    success: true,
    data: listNip47PaymentHistory(vaultData),
  };
}
