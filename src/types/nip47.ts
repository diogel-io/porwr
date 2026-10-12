export const NIP47_WALLET_INFO_KIND = 13194 as const;
export const NIP47_REQUEST_KIND = 23194 as const;
export const NIP47_RESPONSE_KIND = 23195 as const;
export const NIP47_NOTIFICATION_KIND = 23197 as const;

export type Nip47Command =
  | 'pay_invoice'
  | 'pay_keysend'
  | 'make_invoice'
  | 'lookup_invoice'
  | 'list_transactions'
  | 'get_balance'
  | 'get_info'
  | 'make_hold_invoice'
  | 'cancel_hold_invoice'
  | 'settle_hold_invoice'
  | 'notifications';

export interface Nip47PaymentHistoryEntry {
  id: string;
  connectionId: string;
  connectionLabel: string;
  paymentHash?: string;
  invoicePreview: string;
  amountMsat?: number;
  feesPaidMsat?: number;
  status: 'succeeded' | 'failed';
  error?: string;
  createdAt: string;
}

export interface Nip47Connection {
  id: string;
  label: string;
  walletServicePubkey: string;
  clientSecret: string;
  clientPubkey: string;
  relays: string[];
  lud16?: string;
  capabilities: Nip47Command[];
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
  lastInfoCheckedAt?: string;
  lastError?: string;
}

export type Nip47ConnectionSummary = Omit<Nip47Connection, 'clientSecret'> & {
  hasClientSecret: boolean;
};

export interface ParsedNwcUri {
  walletServicePubkey: string;
  clientSecret: string;
  relays: string[];
  lud16?: string;
}

export interface ImportNip47ConnectionRequest {
  uri: string;
  label?: string;
  identityId?: string;
}

/** The public wallet service details a wallet posts back after the user approves Porwr (#110). */
export interface Nip47AuthorizedWalletService {
  walletServicePubkey: string;
  relays: string[];
  lud16?: string;
}

export interface BeginNip47AuthorizationRequest {
  provider: string;
  customOrigin?: string;
}

/** What the page needs to open the wallet's approval popup. The client secret stays in the background. */
export interface Nip47AuthorizationStart {
  pendingId: string;
  clientPubkey: string;
  authorizationUrl: string;
  origin: string;
}

export interface CompleteNip47AuthorizationRequest extends Nip47AuthorizedWalletService {
  pendingId: string;
}

export interface ProbeNip47AuthorizationRequest {
  pendingId: string;
}

export interface Nip47InfoResponse {
  pubkey: string;
  capabilities: Nip47Command[];
  relays: string[];
  encryption: string[];
  notifications: string[];
  rawContent: string;
  checkedAt: string;
}

export interface Nip47BalanceResponse {
  balanceMsat: number;
  raw: Record<string, unknown>;
}

export interface Nip47PayInvoiceRequest {
  connectionId: string;
  invoice: string;
}

export interface Nip47PayInvoiceResponse {
  preimage: string;
  feesPaidMsat?: number;
  paymentHash?: string;
  raw: Record<string, unknown>;
}

export interface Nip47RpcRequest {
  method: Nip47Command;
  params: Record<string, unknown>;
}

export interface Nip47RpcError {
  code: string;
  message: string;
}

export interface Nip47RpcResponse {
  result_type?: Nip47Command;
  result?: Record<string, unknown>;
  error?: Nip47RpcError;
}

export interface Nip47CommandResult {
  connection: Nip47ConnectionSummary;
  response: Nip47RpcResponse;
}
