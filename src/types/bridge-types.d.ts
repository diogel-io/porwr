import type { StoredKey } from './index.d';
import type {
  ApprovalDuration,
  ApprovalRequestContent,
  ApprovalRequestRecord,
  DecisionResult,
} from '@/../src-bex/types/background';
import type { RelayCatalogEntry, RelayDiscoveryState } from './relay';
import type {
  DmRelayCheckRequest,
  DmRelayCheckResult,
  DmRelayList,
  DmRelayPublishRequest,
  DmRelayPublishResult,
  FetchMessagesRequest,
  FetchMessagesResult,
  MarkReadRequest,
  MessagingReadState,
  MessagingSavedPeers,
  SavedPeerRequest,
  SendMessageRequest,
  SendMessageResult,
} from './messaging';
import type { AccountSignRequest } from './account-signing';
import type { ContactRefreshRequest, ContactRefreshResult } from './contact-list';
import type {
  AccountRequest,
  AccountSummary,
  AddAccountRequest,
  RenameAccountRequest,
  RevealedSecret,
  VaultView,
} from './accounts';
import type { Event as SignedNostrEvent } from 'nostr-tools';
import type { ConnectedSite } from '@/../src-bex/services/connected-sites';
import type { SiteAccount, SwitchSiteAccountResult } from '@/../src-bex/services/site-account';
import type {
  BeginNip47AuthorizationRequest,
  CompleteNip47AuthorizationRequest,
  ImportNip47ConnectionRequest,
  Nip47AccountRequest,
  Nip47AuthorizationStart,
  Nip47BalanceResponse,
  Nip47Connection,
  Nip47ConnectionRequest,
  Nip47ConnectionSummary,
  Nip47InfoResponse,
  Nip47PayInvoiceRequest,
  Nip47PayInvoiceResponse,
  Nip47PaymentHistoryEntry,
  ProbeNip47AuthorizationRequest,
} from './nip47';
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
  /**
   * @deprecated A placeholder (`'Generating...'`) that vaults created before #244 carry. Never read;
   * dropped the next time the vault is written.
   */
  mnemonic?: string;
  /** @deprecated Always empty in vaults created before #244. Never read; dropped on the next write. */
  passphrase?: string;
  createdAt?: string;
  nip47Connections?: Nip47Connection[];
  nip47PaymentHistory?: Nip47PaymentHistoryEntry[];
  webLnPermissions?: WebLnPermissionGrant[];
  /** NIP-17 read state: account pubkey -> peer pubkey -> newest read message `created_at`. */
  messagingReadState?: Record<string, MessagingReadState>;
  /** Contacts added to Chats through search: account pubkey -> peer pubkeys, oldest first (#258). */
  messagingSavedPeers?: Record<string, MessagingSavedPeers>;
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
  | 'vault.getView'
  | 'accounts.add'
  | 'accounts.rename'
  | 'accounts.remove'
  | 'accounts.revealSecret'
  | 'vault.setData'
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
  | 'nip47.authorization.begin'
  | 'nip47.authorization.complete'
  | 'nip47.authorization.probe'
  | 'messaging.dmRelays.get'
  | 'messaging.dmRelays.publish'
  | 'messaging.dmRelays.check'
  | 'messaging.send'
  | 'messaging.fetch'
  | 'messaging.readState'
  | 'messaging.markRead'
  | 'messaging.savedPeers.get'
  | 'messaging.savedPeers.add'
  | 'messaging.savedPeers.remove'
  | 'contacts.refresh'
  | 'account.signEvent'
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
  ping: {
    id: string;
    action: 'ping';
  };
  'vault.getView': {
    id: string;
    action: 'vault.getView';
  };
  'accounts.add': {
    id: string;
    action: 'accounts.add';
  } & AddAccountRequest;
  'accounts.rename': {
    id: string;
    action: 'accounts.rename';
  } & RenameAccountRequest;
  'accounts.remove': {
    id: string;
    action: 'accounts.remove';
  } & AccountRequest;
  'accounts.revealSecret': {
    id: string;
    action: 'accounts.revealSecret';
  } & AccountRequest;
  'vault.setData': {
    id: string;
    action: 'vault.setData';
    vaultData: VaultData;
  };
  'vault.create': {
    id: string;
    action: 'vault.create';
    /** Only the password: the background builds the new, empty vault itself (#244). */
    password: string;
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
    /** The account whose sites to list (#309). */
    accountPubkey: string;
  };
  'sites.revoke': {
    id: string;
    action: 'sites.revoke';
    origin: string;
    /** The account to disconnect the site for; other accounts' grants stay (#309). */
    accountPubkey: string;
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
  } & Nip47AccountRequest;
  'nip47.connections.import': {
    id: string;
    action: 'nip47.connections.import';
  } & ImportNip47ConnectionRequest;
  'nip47.connections.remove': {
    id: string;
    action: 'nip47.connections.remove';
  } & Nip47ConnectionRequest;
  'nip47.connections.setActive': {
    id: string;
    action: 'nip47.connections.setActive';
  } & Nip47ConnectionRequest;
  'nip47.getInfo': {
    id: string;
    action: 'nip47.getInfo';
  } & Nip47ConnectionRequest;
  'nip47.getBalance': {
    id: string;
    action: 'nip47.getBalance';
  } & Nip47ConnectionRequest;
  'nip47.payInvoice': {
    id: string;
    action: 'nip47.payInvoice';
  } & Nip47PayInvoiceRequest;
  'nip47.payments.list': {
    id: string;
    action: 'nip47.payments.list';
  } & Nip47AccountRequest;
  'nip47.authorization.begin': {
    id: string;
    action: 'nip47.authorization.begin';
  } & BeginNip47AuthorizationRequest;
  'nip47.authorization.complete': {
    id: string;
    action: 'nip47.authorization.complete';
  } & CompleteNip47AuthorizationRequest;
  'nip47.authorization.probe': {
    id: string;
    action: 'nip47.authorization.probe';
  } & ProbeNip47AuthorizationRequest;
  'messaging.dmRelays.get': {
    id: string;
    action: 'messaging.dmRelays.get';
  };
  'messaging.dmRelays.publish': {
    id: string;
    action: 'messaging.dmRelays.publish';
  } & DmRelayPublishRequest;
  'messaging.dmRelays.check': {
    id: string;
    action: 'messaging.dmRelays.check';
  } & DmRelayCheckRequest;
  'messaging.send': {
    id: string;
    action: 'messaging.send';
  } & SendMessageRequest;
  'messaging.fetch': {
    id: string;
    action: 'messaging.fetch';
  } & FetchMessagesRequest;
  'messaging.readState': {
    id: string;
    action: 'messaging.readState';
  };
  'messaging.markRead': {
    id: string;
    action: 'messaging.markRead';
  } & MarkReadRequest;
  'messaging.savedPeers.get': {
    id: string;
    action: 'messaging.savedPeers.get';
  };
  'messaging.savedPeers.add': {
    id: string;
    action: 'messaging.savedPeers.add';
  } & SavedPeerRequest;
  'messaging.savedPeers.remove': {
    id: string;
    action: 'messaging.savedPeers.remove';
  } & SavedPeerRequest;
  'contacts.refresh': {
    id: string;
    action: 'contacts.refresh';
  } & ContactRefreshRequest;
  'account.signEvent': {
    id: string;
    action: 'account.signEvent';
  } & AccountSignRequest;
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
  'vault.unlock': { success: boolean; error?: string };
  'vault.lock': { success: boolean };
  'vault.isUnlocked': boolean;
  'permission.check': boolean;
  'permission.grant': boolean;
  'blossom.upload':
    | { success: true; url: string; sha256?: string }
    | { success: false; error: string };
  ping: string;
  'vault.getView': VaultView | { success: false; error: string };
  'accounts.add': AccountSummary | { success: false; error: string };
  'accounts.rename': AccountSummary | { success: false; error: string };
  'accounts.remove': boolean | { success: false; error: string };
  'accounts.revealSecret': RevealedSecret | { success: false; error: string };
  'vault.setData': { success: boolean; error?: string };
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
  'nip47.connections.list': Nip47ConnectionSummary[] | { success: false; error: string };
  'nip47.connections.import': Nip47ConnectionSummary | { success: false; error: string };
  'nip47.connections.remove': boolean | { success: false; error: string };
  'nip47.connections.setActive': Nip47ConnectionSummary | { success: false; error: string };
  'nip47.getInfo': Nip47InfoResponse | { success: false; error: string };
  'nip47.getBalance': Nip47BalanceResponse | { success: false; error: string };
  'nip47.payInvoice': Nip47PayInvoiceResponse | { success: false; error: string };
  'nip47.payments.list': Nip47PaymentHistoryEntry[] | { success: false; error: string };
  'nip47.authorization.begin': Nip47AuthorizationStart | { success: false; error: string };
  'nip47.authorization.complete': Nip47ConnectionSummary | { success: false; error: string };
  'nip47.authorization.probe': Nip47ConnectionSummary | null | { success: false; error: string };
  'messaging.dmRelays.get': DmRelayList | { success: false; error: string };
  'messaging.dmRelays.publish': DmRelayPublishResult | { success: false; error: string };
  'messaging.dmRelays.check': DmRelayCheckResult | { success: false; error: string };
  'messaging.send': SendMessageResult | { success: false; error: string };
  'messaging.fetch': FetchMessagesResult | { success: false; error: string };
  'messaging.readState': MessagingReadState | { success: false; error: string };
  'messaging.markRead': MessagingReadState | { success: false; error: string };
  'messaging.savedPeers.get': MessagingSavedPeers | { success: false; error: string };
  'messaging.savedPeers.add': MessagingSavedPeers | { success: false; error: string };
  'messaging.savedPeers.remove': MessagingSavedPeers | { success: false; error: string };
  'contacts.refresh': ContactRefreshResult | { success: false; error: string };
  'account.signEvent': SignedNostrEvent | { success: false; error: string };
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
