import { sendBexMessage } from './vault-service';
import type {
  ImportNip47ConnectionRequest,
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

export async function listNip47Connections(): Promise<Nip47ConnectionSummary[]> {
  const response = await sendBexMessage('nip47.connections.list');
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

export async function removeNip47Connection(connectionId: string): Promise<void> {
  const response = await sendBexMessage('nip47.connections.remove', { connectionId });
  throwIfError(response);
}

export async function setActiveNip47Connection(connectionId: string): Promise<Nip47ConnectionSummary> {
  try {
    const response = await sendBexMessage('nip47.connections.setActive', { connectionId });
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

export async function getNip47Info(connectionId: string): Promise<Nip47InfoResponse> {
  const response = await sendBexMessage('nip47.getInfo', { connectionId });
  throwIfError(response);
  if (!response || typeof response !== 'object' || !('capabilities' in response)) {
    throw new Error('Invalid NIP-47 info response');
  }
  return response;
}

export async function getNip47Balance(connectionId: string): Promise<Nip47BalanceResponse> {
  const response = await sendBexMessage('nip47.getBalance', { connectionId });
  throwIfError(response);
  if (!response || typeof response !== 'object' || !('balanceMsat' in response)) {
    throw new Error('Invalid NIP-47 balance response');
  }
  return response;
}

export async function payNip47Invoice(
  connectionId: string,
  invoice: string,
): Promise<Nip47PayInvoiceResponse> {
  const response = await sendBexMessage('nip47.payInvoice', { connectionId, invoice });
  throwIfError(response);
  if (!response || typeof response !== 'object' || !('preimage' in response)) {
    throw new Error('Invalid NIP-47 pay_invoice response');
  }
  return response;
}

export async function listNip47PaymentHistory(): Promise<Nip47PaymentHistoryEntry[]> {
  const response = await sendBexMessage('nip47.payments.list');
  throwIfError(response);
  return Array.isArray(response) ? response : [];
}
