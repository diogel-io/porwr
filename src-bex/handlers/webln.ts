import type { HandlerResult } from '../types/background';
import type { VaultData } from '@/types/bridge';
import type {
  WebLnEnableRequest,
  WebLnGetInfoRequest,
  WebLnGetInfoResponse,
  WebLnSendPaymentRequest,
  WebLnSendPaymentResponse,
} from '@/types/webln';
import { getVaultData, updateVaultData } from '../vault';
import { listNip47Connections } from '../services/nip47-connection-store';
import { handleNip47PayInvoice } from './nip47';
import { hasWebLnPermission, upsertWebLnPermission } from '../services/webln-permission-store';

async function requireUnlockedVaultData(): Promise<VaultData> {
  const result = await getVaultData();
  if (!result.success || !result.vaultData) {
    throw new Error('Vault is locked. Unlock Porwr before using WebLN.');
  }
  return result.vaultData as VaultData;
}

function getActiveWebLnConnection(vaultData: VaultData) {
  return listNip47Connections(vaultData).find((connection) => connection.isActive);
}

function assertPayInvoiceSupport(connection: { capabilities: string[] }): void {
  if (connection.capabilities.length > 0 && !connection.capabilities.includes('pay_invoice')) {
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
  const vaultData = await requireUnlockedVaultData();
  const connection = getActiveWebLnConnection(vaultData);
  if (!connection) {
    throw new Error('No active NIP-47 wallet connection is configured.');
  }
  assertPayInvoiceSupport(connection);

  const updatedVault = upsertWebLnPermission(vaultData, {
    origin: payload.origin,
    connectionId: connection.id,
    methods: ['enable', 'getInfo'],
    createdAt: new Date().toISOString(),
  });
  const result = await updateVaultData(updatedVault);
  if (!result.success) {
    throw new Error(result.error || 'Failed to save WebLN permission.');
  }
  return { success: true, data: true };
}

export async function handleWebLnGetInfo(payload: WebLnGetInfoRequest): Promise<HandlerResult<WebLnGetInfoResponse>> {
  const vaultData = await requireUnlockedVaultData();
  const connection = getActiveWebLnConnection(vaultData);
  if (!connection) {
    throw new Error('No active NIP-47 wallet connection is configured.');
  }
  if (!hasWebLnPermission(vaultData, { origin: payload.origin, connectionId: connection.id, method: 'getInfo' })) {
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
  const vaultData = await requireUnlockedVaultData();
  const connection = getActiveWebLnConnection(vaultData);
  if (!connection) {
    throw new Error('No active NIP-47 wallet connection is configured.');
  }
  assertPayInvoiceSupport(connection);
  if (!hasWebLnPermission(vaultData, { origin: payload.origin, connectionId: connection.id, method: 'enable' })) {
    throw new Error('WebLN access has not been enabled for this site.');
  }

  const result = await handleNip47PayInvoice({ connectionId: connection.id, invoice });
  if (!result.success) {
    throw new Error(result.error);
  }
  return { success: true, data: { preimage: result.data.preimage } };
}
