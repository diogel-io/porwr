import { getVaultData, sendBexMessage, updateVaultData } from './vault-service';
import type {
  ImportNip47ConnectionRequest,
  Nip47BalanceResponse,
  Nip47Connection,
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

function summarizeConnection(connection: Nip47Connection): Nip47ConnectionSummary {
  const { clientSecret: _clientSecret, ...safeConnection } = connection;
  void _clientSecret;
  return {
    ...safeConnection,
    hasClientSecret: connection.clientSecret.length > 0,
  };
}

async function setActiveNip47ConnectionViaVault(connectionId: string): Promise<Nip47ConnectionSummary> {
  const vaultResult = await getVaultData();
  if (!vaultResult.success || !vaultResult.vaultData) {
    throw new Error(vaultResult.error || 'Failed to load vault data');
  }

  const connections = vaultResult.vaultData.nip47Connections ?? [];
  const hasConnection = connections.some((connection) => connection.id === connectionId);
  if (!hasConnection) {
    throw new Error('NIP-47 connection not found');
  }

  const now = new Date().toISOString();
  const updatedConnections = connections.map((connection) => ({
    ...connection,
    isActive: connection.id === connectionId,
    updatedAt: connection.id === connectionId ? now : connection.updatedAt,
  }));
  const activeConnection = updatedConnections.find((connection) => connection.id === connectionId);
  if (!activeConnection) {
    throw new Error('NIP-47 connection not found');
  }

  const updateResult = await updateVaultData({
    ...vaultResult.vaultData,
    nip47Connections: updatedConnections,
  });
  if (!updateResult.success) {
    throw new Error(updateResult.error || 'Failed to update active wallet connection');
  }

  return summarizeConnection(activeConnection);
}

export async function setActiveNip47Connection(connectionId: string): Promise<Nip47ConnectionSummary> {
  try {
    const response = await sendBexMessage('nip47.connections.setActive', { connectionId });
    throwIfError(response);
    if (!response || typeof response !== 'object' || !('id' in response)) {
      throw new Error('Invalid NIP-47 active connection response');
    }
    return response;
  } catch {
    return await setActiveNip47ConnectionViaVault(connectionId);
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
