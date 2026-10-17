import { sendBexMessage } from './vault-service';
import type {
  BeginNip47AuthorizationRequest,
  CompleteNip47AuthorizationRequest,
  ImportNip47ConnectionRequest,
  Nip47AuthorizationStart,
  Nip47BalanceResponse,
  Nip47ConnectionSummary,
  Nip47InfoResponse,
  Nip47PayInvoiceResponse,
  Nip47PaymentHistoryEntry,
} from '@/types/nip47';

function isErrorResponse(value: unknown): value is { success: false; error: string } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'success' in value &&
    (value as { success?: unknown }).success === false &&
    'error' in value &&
    typeof (value as { error?: unknown }).error === 'string',
  );
}

function throwIfError(value: unknown): void {
  if (isErrorResponse(value)) {
    throw new Error(value.error);
  }
}

/**
 * Wallet connections belong to one account, so every call here names it (#304). The background
 * checks the account against the vault and finds no connection of any other account's.
 */

export async function listNip47Connections(
  accountPubkey: string,
): Promise<Nip47ConnectionSummary[]> {
  const response = await sendBexMessage('nip47.connections.list', { accountPubkey });
  throwIfError(response);
  return Array.isArray(response) ? response : [];
}

export async function importNip47Connection(
  request: ImportNip47ConnectionRequest,
): Promise<Nip47ConnectionSummary> {
  const response = await sendBexMessage('nip47.connections.import', request);
  throwIfError(response);
  if (!response || typeof response !== 'object' || !('id' in response)) {
    throw new Error('Invalid NIP-47 import response');
  }
  return response;
}

export async function removeNip47Connection(
  accountPubkey: string,
  connectionId: string,
): Promise<void> {
  const response = await sendBexMessage('nip47.connections.remove', {
    accountPubkey,
    connectionId,
  });
  throwIfError(response);
}

export async function setActiveNip47Connection(
  accountPubkey: string,
  connectionId: string,
): Promise<Nip47ConnectionSummary> {
  try {
    const response = await sendBexMessage('nip47.connections.setActive', {
      accountPubkey,
      connectionId,
    });
    throwIfError(response);
    if (!response || typeof response !== 'object' || !('id' in response)) {
      throw new Error('Invalid NIP-47 active connection response');
    }
    return response;
  } catch (error: unknown) {
    // No fallback that edits the vault from the page: that needed the whole decrypted vault, wallet
    // secrets included (#240). The background action is the only way to change the active wallet.
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function getNip47Info(
  accountPubkey: string,
  connectionId: string,
): Promise<Nip47InfoResponse> {
  const response = await sendBexMessage('nip47.getInfo', { accountPubkey, connectionId });
  throwIfError(response);
  if (!response || typeof response !== 'object' || !('capabilities' in response)) {
    throw new Error('Invalid NIP-47 info response');
  }
  return response;
}

export async function getNip47Balance(
  accountPubkey: string,
  connectionId: string,
): Promise<Nip47BalanceResponse> {
  const response = await sendBexMessage('nip47.getBalance', { accountPubkey, connectionId });
  throwIfError(response);
  if (!response || typeof response !== 'object' || !('balanceMsat' in response)) {
    throw new Error('Invalid NIP-47 balance response');
  }
  return response;
}

export async function payNip47Invoice(
  accountPubkey: string,
  connectionId: string,
  invoice: string,
): Promise<Nip47PayInvoiceResponse> {
  const response = await sendBexMessage('nip47.payInvoice', {
    accountPubkey,
    connectionId,
    invoice,
  });
  throwIfError(response);
  if (!response || typeof response !== 'object' || !('preimage' in response)) {
    throw new Error('Invalid NIP-47 pay_invoice response');
  }
  return response;
}

export async function listNip47PaymentHistory(
  accountPubkey: string,
): Promise<Nip47PaymentHistoryEntry[]> {
  const response = await sendBexMessage('nip47.payments.list', { accountPubkey });
  throwIfError(response);
  return Array.isArray(response) ? response : [];
}

export async function beginNip47Authorization(
  request: BeginNip47AuthorizationRequest,
): Promise<Nip47AuthorizationStart> {
  const response = await sendBexMessage('nip47.authorization.begin', request);
  throwIfError(response);
  if (!response || typeof response !== 'object' || !('authorizationUrl' in response)) {
    throw new Error('Invalid wallet authorization response');
  }
  return response;
}

export async function completeNip47Authorization(
  request: CompleteNip47AuthorizationRequest,
): Promise<Nip47ConnectionSummary> {
  const response = await sendBexMessage('nip47.authorization.complete', request);
  throwIfError(response);
  if (!response || typeof response !== 'object' || !('id' in response)) {
    throw new Error('Invalid wallet authorization response');
  }
  return response;
}

/** @returns The saved connection, or `null` when the wallet did not approve Porwr. */
export async function probeNip47Authorization(
  pendingId: string,
): Promise<Nip47ConnectionSummary | null> {
  const response = await sendBexMessage('nip47.authorization.probe', { pendingId });
  throwIfError(response);
  return response && typeof response === 'object' && 'id' in response ? response : null;
}
