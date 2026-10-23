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

/**
 * Names the account a wallet action is for (#304).
 *
 * Wallet connections belong to one account. Every action that reads or changes them says which, and
 * the background checks it against the vault rather than trusting a connection id on its own.
 */
export interface Nip47AccountRequest {
  /** The account's hex public key. */
  accountPubkey: string;
}

export interface Nip47PaymentHistoryEntry {
  id: string;
  /** The account whose wallet made the payment (#304). */
  accountPubkey: string;
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
  /** The account this connection belongs to. Each account has at most one active connection (#304). */
  accountPubkey: string;
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
  /**
   * The encryption schemes the wallet's info event advertises (NIP-47 §Encryption), such as
   * `['nip44_v2', 'nip04']`. An empty list means the event had no `encryption` tag, so NIP-04.
   * Undefined until Porwr has read the info event (diogel-io/workspace#142).
   */
  encryption?: string[];
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

export interface ImportNip47ConnectionRequest extends Nip47AccountRequest {
  uri: string;
  label?: string;
}

/** An action on one of an account's connections. */
export interface Nip47ConnectionRequest extends Nip47AccountRequest {
  connectionId: string;
}

/** The public wallet service details a wallet posts back after the user approves Porwr (#110). */
export interface Nip47AuthorizedWalletService {
  walletServicePubkey: string;
  relays: string[];
  lud16?: string;
}

export interface BeginNip47AuthorizationRequest extends Nip47AccountRequest {
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

/**
 * Asks the background to open the wallet's approval popup itself and see the connection through
 * (workspace#85). Used in Firefox, where a popup a Porwr page opens loses its opener.
 */
export interface OpenNip47AuthorizationRequest extends BeginNip47AuthorizationRequest {
  /** The Wallet Connections request the outcome is posted back for (`wallet-connect-channel`). */
  requestId: string;
}

/** Abandons a background-owned authorization and closes its popup (workspace#85). */
export interface CancelNip47AuthorizationRequest {
  pendingId: string;
}

/** The authorization the background opened a popup for. The client secret stays in the background. */
export interface Nip47AuthorizationOpened {
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

export interface Nip47PayInvoiceRequest extends Nip47ConnectionRequest {
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
