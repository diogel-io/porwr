import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import type { HandlerResult } from '../types/background';
import type {
  BeginNip47AuthorizationRequest,
  CompleteNip47AuthorizationRequest,
  ImportNip47ConnectionRequest,
  Nip47AuthorizationStart,
  Nip47AuthorizedWalletService,
  Nip47Command,
  Nip47BalanceResponse,
  Nip47Connection,
  Nip47ConnectionSummary,
  Nip47InfoResponse,
  Nip47PayInvoiceRequest,
  Nip47PayInvoiceResponse,
  Nip47PaymentHistoryEntry,
  ProbeNip47AuthorizationRequest,
} from '@/types/nip47';
import type { VaultData } from '@/types/bridge';
import { parseNwcUri, buildNip47ConnectionId } from '@/services/nip47-uri';
import { buildAuthorizationUrl, validateAuthorizedWalletService } from '@/services/nip47-authorization';
import {
  WALLET_PROVIDERS,
  createWalletProviderId,
  resolveWalletProviderOrigin,
} from '@/types/wallet-provider';
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
import {
  savePendingNip47Authorization,
  takePendingNip47Authorization,
  type PendingNip47Authorization,
} from '../services/nip47-pending-authorization-store';

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

/** The app name a wallet shows the user on its approval page. */
const AUTHORIZATION_APP_NAME = 'Porwr';

/**
 * Starts connecting a wallet without a pasted connection string (#110).
 *
 * Generates the client secret here and keeps it in the background; the page gets only the public
 * key and the wallet page to open.
 */
export async function handleNip47AuthorizationBegin(
  payload: BeginNip47AuthorizationRequest,
): Promise<HandlerResult<Nip47AuthorizationStart>> {
  await requireUnlockedVaultData();

  const providerId = createWalletProviderId(payload.provider);
  if (!providerId) {
    throw new Error('Unsupported wallet provider');
  }
  const provider = WALLET_PROVIDERS[providerId];
  const origin = resolveWalletProviderOrigin(provider, payload.customOrigin);
  if (!origin) {
    throw new Error(`Enter the https:// address of your ${provider.name}`);
  }

  const clientSecret = bytesToHex(generateSecretKey());
  const clientPubkey = getPublicKey(hexToBytes(clientSecret));
  const pending = await savePendingNip47Authorization({
    pendingId: crypto.randomUUID(),
    providerId,
    origin,
    clientSecret,
    clientPubkey,
  });

  return {
    success: true,
    data: {
      pendingId: pending.pendingId,
      clientPubkey,
      origin,
      authorizationUrl: buildAuthorizationUrl(provider, origin, clientPubkey, {
        name: AUTHORIZATION_APP_NAME,
      }),
    },
  };
}

async function requirePendingAuthorization(pendingId: string): Promise<PendingNip47Authorization> {
  const pending = await takePendingNip47Authorization(pendingId);
  if (!pending) {
    throw new Error('This wallet connection request has expired. Start again.');
  }
  return pending;
}

function buildAuthorizedConnection(
  pending: PendingNip47Authorization,
  service: Nip47AuthorizedWalletService,
): Nip47Connection {
  const now = new Date().toISOString();
  return {
    id: buildNip47ConnectionId(service.walletServicePubkey, pending.clientPubkey),
    label: WALLET_PROVIDERS[pending.providerId].name,
    walletServicePubkey: service.walletServicePubkey,
    clientSecret: pending.clientSecret,
    clientPubkey: pending.clientPubkey,
    relays: service.relays,
    ...(service.lud16 ? { lud16: service.lud16 } : {}),
    capabilities: [],
    createdAt: now,
    updatedAt: now,
    isActive: true,
  };
}

async function saveAuthorizedConnection(
  connection: Nip47Connection,
  capabilities: Nip47Command[],
  checkedAt: string,
): Promise<Nip47ConnectionSummary> {
  const saved = await mutateNip47Vault((vaultData) => {
    const nextConnection: Nip47Connection = { ...connection, capabilities, lastInfoCheckedAt: checkedAt };
    return { vaultData: upsertNip47Connection(vaultData, nextConnection), data: nextConnection };
  });
  return summarizeNip47Connection(saved);
}

/**
 * Finishes a connection from the wallet service details the wallet posted back to the page.
 *
 * The connection is saved only once the wallet service answers on the relays it named; otherwise
 * nothing is stored and the pending secret is gone either way.
 */
export async function handleNip47AuthorizationComplete(
  payload: CompleteNip47AuthorizationRequest,
): Promise<HandlerResult<Nip47ConnectionSummary>> {
  await requireUnlockedVaultData();
  const pending = await requirePendingAuthorization(payload.pendingId);

  const service = validateAuthorizedWalletService(payload);
  if (!service) {
    throw new Error('The wallet sent connection details Porwr could not use');
  }

  const connection = buildAuthorizedConnection(pending, service);
  const info = await nip47Client.getInfo(connection);
  return {
    success: true,
    data: await saveAuthorizedConnection(connection, info.capabilities, info.checkedAt),
  };
}

function parseMethods(value: unknown): Nip47Command[] {
  return Array.isArray(value)
    ? value.filter((item): item is Nip47Command => typeof item === 'string' && item.length > 0)
    : [];
}

/**
 * Checks whether the user approved Porwr when the wallet's popup closed without a message.
 *
 * Only possible for a provider whose wallet service pubkey and relay are fixed (Coinos): Porwr asks
 * that service for `get_info` with the pending key. Any answer other than `UNAUTHORIZED` means the
 * wallet recognised the key, so the connection is saved. No answer, or `UNAUTHORIZED`, saves nothing.
 *
 * @returns The saved connection, or `null` when the wallet did not approve it.
 */
export async function handleNip47AuthorizationProbe(
  payload: ProbeNip47AuthorizationRequest,
): Promise<HandlerResult<Nip47ConnectionSummary | null>> {
  await requireUnlockedVaultData();
  const pending = await requirePendingAuthorization(payload.pendingId);

  const known = WALLET_PROVIDERS[pending.providerId].knownWalletService;
  if (!known) {
    return { success: true, data: null };
  }

  const connection = buildAuthorizedConnection(pending, {
    walletServicePubkey: known.walletServicePubkey,
    relays: [known.relay],
  });

  let methods: Nip47Command[];
  try {
    const response = await nip47Client.sendRequest(connection, { method: 'get_info', params: {} });
    if (response.error?.code === 'UNAUTHORIZED') {
      return { success: true, data: null };
    }
    methods = parseMethods(response.result?.methods);
  } catch {
    return { success: true, data: null };
  }

  return {
    success: true,
    data: await saveAuthorizedConnection(connection, methods, new Date().toISOString()),
  };
}
