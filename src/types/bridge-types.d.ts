import type { StoredKey } from './index.d';
import type {
  ApprovalDuration,
  ApprovalRequestContent,
  ApprovalRequestRecord,
  DecisionResult,
} from '@/../src-bex/types/background';
import type { RelayCatalogEntry, RelayDiscoveryState } from './relay';
import type { ConnectedSite } from '@/../src-bex/services/connected-sites';
import type { SiteAccount, SwitchSiteAccountResult } from '@/../src-bex/services/site-account';
import type {
  ImportNip47ConnectionRequest,
  Nip47BalanceResponse,
  Nip47Connection,
  Nip47ConnectionSummary,
  Nip47InfoResponse,
  Nip47PayInvoiceRequest,
  Nip47PayInvoiceResponse,
  Nip47PaymentHistoryEntry,
} from './nip47';
import type {
  Nip57ZapHistoryEntry,
  SendZapRequest,
  SendZapResult,
  ZapCapabilities,
} from './nip57';
import type {
  WebLnEnableRequest,
  WebLnGetInfoRequest,
  WebLnGetInfoResponse,
  WebLnPermissionGrant,
  WebLnSendPaymentRequest,
  WebLnSendPaymentResponse,
} from './webln';

/**
 * Common types shared between UI and Background/Content Script
 */

export interface UnsignedNostrEvent {
  kind: number;
  content: string;
  pubkey: string;
  created_at: number;
  tags: string[][];
}

export interface GetPublicKeyRequest {
  origin: string;
}

export interface SignEventRequest {
  event: UnsignedNostrEvent;
  origin: string;
}

export type GetPublicKeyResponse = string;

export interface SignEventResponse {
  id: string;
  pubkey: string;
  sig: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

export type BridgeErrorCode = 'VAULT_LOCKED' | 'PERMISSION_DENIED' | 'SIGNING_FAILED' | 'NOT_FOUND';

export interface BridgeError {
  id?: string;
  code?: string;
  message: string;
  action?: string;
  metadata?: Record<string, unknown>;
}

export interface VaultData {
  accounts: StoredKey[];
  mnemonic?: string;
  passphrase?: string;
  createdAt?: string;
  nip47Connections?: Nip47Connection[];
  nip47PaymentHistory?: Nip47PaymentHistoryEntry[];
  nip57ZapHistory?: Nip57ZapHistoryEntry[];
  webLnPermissions?: WebLnPermissionGrant[];
}

// Bridge action types
export type BridgeAction =
  | 'nostr.getPublicKey'
  | 'nostr.signEvent'
  | 'nostr.getRelays'
  | 'nostr.nip04.encrypt'
  | 'nostr.nip04.decrypt'
  | 'nostr.nip44.encrypt'
  | 'nostr.nip44.decrypt'
  | 'vault.unlock'
  | 'vault.lock'
  | 'vault.isUnlocked'
  | 'permission.check'
  | 'permission.grant'
  | 'blossom.upload'
  | 'ping'
  | 'vault.getData'
  | 'vault.setData'
  | 'vault.updateData'
  | 'vault.create'
  | 'vault.export'
  | 'vault.import'
  | 'activity.mark'
  | 'nostr.requests.list'
  | 'nostr.requests.current'
  | 'nostr.requests.count'
  | 'nostr.requests.present'
  | 'nostr.requests.respond'
  | 'nostr.requests.content'
  | 'nostr.requests.requeuePresented'
  | 'pages.originForTab'
  | 'sites.list'
  | 'sites.revoke'
  | 'sites.binding'
  | 'sites.useActiveAccount'
  | 'sites.countForAccount'
  | 'relay.browser.list'
  | 'relay.browser.getStatus'
  | 'relay.browser.refresh'
  | 'nip47.connections.list'
  | 'nip47.connections.import'
  | 'nip47.connections.remove'
  | 'nip47.connections.setActive'
  | 'nip47.getInfo'
  | 'nip47.getBalance'
  | 'nip47.payInvoice'
  | 'nip47.payments.list'
  | 'nip57.getCapabilities'
  | 'nip57.sendZap'
  | 'nip57.zaps.list'
  | 'webln.enable'
  | 'webln.getInfo'
  | 'webln.sendPayment';

// Request/Response mapping
export interface BridgeRequestMap {
  'nostr.getPublicKey': {
    id: string;
    action: 'nostr.getPublicKey';
    origin: string;
  };
  'nostr.signEvent': {
    id: string;
    action: 'nostr.signEvent';
    origin: string;
    event: {
      kind: number;
      content: string;
      tags: string[][];
      created_at: number;
      pubkey?: string;
    };
  };
  'nostr.getRelays': {
    id: string;
    action: 'nostr.getRelays';
    origin: string;
  };
  'nostr.nip04.encrypt': {
    id: string;
    action: 'nostr.nip04.encrypt';
    origin: string;
    pubkey: string;
    plaintext: string;
  };
  'nostr.nip04.decrypt': {
    id: string;
    action: 'nostr.nip04.decrypt';
    origin: string;
    pubkey: string;
    ciphertext: string;
  };
  'nostr.nip44.encrypt': {
    id: string;
    action: 'nostr.nip44.encrypt';
    origin: string;
    pubkey: string;
    plaintext: string;
  };
  'nostr.nip44.decrypt': {
    id: string;
    action: 'nostr.nip44.decrypt';
    origin: string;
    pubkey: string;
    ciphertext: string;
  };
  'vault.unlock': {
    id: string;
    action: 'vault.unlock';
    password: string;
  };
  'vault.lock': {
    id: string;
    action: 'vault.lock';
  };
  'vault.isUnlocked': {
    id: string;
    action: 'vault.isUnlocked';
  };
  'permission.check': {
    id: string;
    action: 'permission.check';
    origin: string;
    eventKind: number;
  };
  'permission.grant': {
    id: string;
    action: 'permission.grant';
    origin: string;
    eventKind: number;
    duration: '8h' | 'always';
  };
  'blossom.upload': {
    id: string;
    action: 'blossom.upload';
    base64Data?: string;
    fileType?: string;
    blossomServer?: string;
    uploadId?: string;
    file?: File;
  };
  'ping': {
    id: string;
    action: 'ping';
  };
  'vault.getData': {
    id: string;
    action: 'vault.getData';
  };
  'vault.setData': {
    id: string;
    action: 'vault.setData';
    vaultData: VaultData;
  };
  'vault.updateData': {
    id: string;
    action: 'vault.updateData';
    vaultData: VaultData;
  };
  'vault.create': {
    id: string;
    action: 'vault.create';
    password: string;
    vaultData: VaultData;
  };
  'vault.export': {
    id: string;
    action: 'vault.export';
  };
  'vault.import': {
    id: string;
    action: 'vault.import';
    payload?: { encryptedData: string };
    encryptedData?: string;
  };
  'activity.mark': {
    id: string;
    action: 'activity.mark';
  };
  'nostr.requests.list': {
    id: string;
    action: 'nostr.requests.list';
  };
  'nostr.requests.current': {
    id: string;
    action: 'nostr.requests.current';
  };
  'nostr.requests.count': {
    id: string;
    action: 'nostr.requests.count';
  };
  'nostr.requests.present': {
    id: string;
    action: 'nostr.requests.present';
    requestId: string;
  };
  'nostr.requests.respond': {
    id: string;
    action: 'nostr.requests.respond';
    requestId: string;
    approved: boolean;
    duration: ApprovalDuration;
  };
  'nostr.requests.content': {
    id: string;
    action: 'nostr.requests.content';
    requestId: string;
  };
  'pages.originForTab': {
    id: string;
    action: 'pages.originForTab';
    tabId: number;
  };
  'sites.list': {
    id: string;
    action: 'sites.list';
  };
  'sites.revoke': {
    id: string;
    action: 'sites.revoke';
    origin: string;
  };
  'sites.binding': {
    id: string;
    action: 'sites.binding';
    origin: string;
  };
  'sites.useActiveAccount': {
    id: string;
    action: 'sites.useActiveAccount';
    origin: string;
  };
  'sites.countForAccount': {
    id: string;
    action: 'sites.countForAccount';
    accountPubkey: string;
  };
  'nostr.requests.requeuePresented': {
    id: string;
    action: 'nostr.requests.requeuePresented';
  };
  'relay.browser.list': {
    id: string;
    action: 'relay.browser.list';
  };
  'relay.browser.getStatus': {
    id: string;
    action: 'relay.browser.getStatus';
  };
  'relay.browser.refresh': {
    id: string;
    action: 'relay.browser.refresh';
    force?: boolean;
  };
  'nip47.connections.list': {
    id: string;
    action: 'nip47.connections.list';
  };
  'nip47.connections.import': {
    id: string;
    action: 'nip47.connections.import';
  } & ImportNip47ConnectionRequest;
  'nip47.connections.remove': {
    id: string;
    action: 'nip47.connections.remove';
    connectionId: string;
  };
  'nip47.connections.setActive': {
    id: string;
    action: 'nip47.connections.setActive';
    connectionId: string;
  };
  'nip47.getInfo': {
    id: string;
    action: 'nip47.getInfo';
    connectionId: string;
  };
  'nip47.getBalance': {
    id: string;
    action: 'nip47.getBalance';
    connectionId: string;
  };
  'nip47.payInvoice': {
    id: string;
    action: 'nip47.payInvoice';
  } & Nip47PayInvoiceRequest;
  'nip47.payments.list': {
    id: string;
    action: 'nip47.payments.list';
  };
  'nip57.getCapabilities': {
    id: string;
    action: 'nip57.getCapabilities';
    origin: string;
  };
  'nip57.sendZap': {
    id: string;
    action: 'nip57.sendZap';
    origin: string;
    request: SendZapRequest;
    approved?: boolean;
  };
  'nip57.zaps.list': {
    id: string;
    action: 'nip57.zaps.list';
  };
  'webln.enable': {
    id: string;
    action: 'webln.enable';
  } & WebLnEnableRequest;
  'webln.getInfo': {
    id: string;
    action: 'webln.getInfo';
  } & WebLnGetInfoRequest;
  'webln.sendPayment': {
    id: string;
    action: 'webln.sendPayment';
  } & WebLnSendPaymentRequest;
}

export interface BridgeResponseMap {
  'nostr.getPublicKey': string;
  'nostr.signEvent': SignEventResponse;
  'nostr.getRelays': Record<string, { read: boolean; write: boolean }>;
  'nostr.nip04.encrypt': string;
  'nostr.nip04.decrypt': string;
  'nostr.nip44.encrypt': string;
  'nostr.nip44.decrypt': string;
  'vault.unlock': { success: boolean; vaultData?: VaultData | null; error?: string };
  'vault.lock': { success: boolean };
  'vault.isUnlocked': boolean;
  'permission.check': boolean;
  'permission.grant': boolean;
  'blossom.upload': { success: true; url: string; sha256?: string } | { success: false; error: string };
  'ping': string;
  'vault.getData': { success: boolean; vaultData?: VaultData | null; error?: string };
  'vault.setData': { success: boolean; error?: string };
  'vault.updateData': { success: boolean; error?: string };
  'vault.create': { success: boolean; encryptedVault?: string; error?: string };
  'vault.export': { success: boolean; encryptedData?: string; error?: string };
  'vault.import': { success: boolean; error?: string };
  'activity.mark': boolean | void;
  'nostr.requests.list': ApprovalRequestRecord[];
  'nostr.requests.current': ApprovalRequestRecord | null;
  'nostr.requests.count': number;
  'pages.originForTab': string | null;
  'sites.list': ConnectedSite[];
  'sites.revoke': boolean;
  'sites.binding': SiteAccount | null;
  'sites.useActiveAccount': SwitchSiteAccountResult;
  'sites.countForAccount': number;
  'nostr.requests.present': ApprovalRequestRecord | null;
  'nostr.requests.respond': DecisionResult;
  'nostr.requests.content': ApprovalRequestContent | null;
  'nostr.requests.requeuePresented': void;
  'relay.browser.list': RelayCatalogEntry[];
  'relay.browser.getStatus': RelayDiscoveryState | null;
  'relay.browser.refresh': boolean | { success: false; error: string };
  'nip47.connections.list': Nip47ConnectionSummary[];
  'nip47.connections.import': Nip47ConnectionSummary | { success: false; error: string };
  'nip47.connections.remove': boolean | { success: false; error: string };
  'nip47.connections.setActive': Nip47ConnectionSummary | { success: false; error: string };
  'nip47.getInfo': Nip47InfoResponse | { success: false; error: string };
  'nip47.getBalance': Nip47BalanceResponse | { success: false; error: string };
  'nip47.payInvoice': Nip47PayInvoiceResponse | { success: false; error: string };
  'nip47.payments.list': Nip47PaymentHistoryEntry[] | { success: false; error: string };
  'nip57.getCapabilities': ZapCapabilities | { success: false; error: string };
  'nip57.sendZap': SendZapResult | { success: false; error: string };
  'nip57.zaps.list': Nip57ZapHistoryEntry[] | { success: false; error: string };
  'webln.enable': true | { success: false; error: string; code?: string };
  'webln.getInfo': WebLnGetInfoResponse | { success: false; error: string; code?: string };
  'webln.sendPayment': WebLnSendPaymentResponse | { success: false; error: string; code?: string };
}

export type BridgeRequest<K extends BridgeAction> = BridgeRequestMap[K];
export type BridgeResponsePayload<K extends BridgeAction> = BridgeResponseMap[K];

export interface BridgeResponse<K extends BridgeAction> {
  id: string;
  action: K;
  data?: BridgeResponsePayload<K>;
  error?: string;
}
