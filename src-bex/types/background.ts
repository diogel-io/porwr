/**
 * Background script specific types
 * Uses simple string-based errors (backward-compatible with existing code)
 */

// Result type for all handler operations
export type HandlerResult<T> =
  | { success: true; data: T; metadata?: Record<string, unknown> }
  | { success: false; error: string; code?: string; metadata?: Record<string, unknown> };

// NIP-07 interface (what we expose to content script)
export interface NostrWindow {
  getPublicKey(): Promise<string>;
  signEvent(event: UnsignedEvent): Promise<SignedEvent>;
  getRelays(): Promise<Record<string, { read: boolean; write: boolean }>>;
  nip04: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
  nip44: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

// Event types
export interface UnsignedEvent {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
  pubkey?: string;
}

export interface SignedEvent extends UnsignedEvent {
  id: string;
  pubkey: string;
  sig: string;
}

// Permission types
/**
 * What an event-kind scope means on a grant.
 *
 * `-1` used to carry two meanings at once: the approval call sites passed it for "this request has
 * no event kind", while the checker read it as "any event kind". A request type with no kind could
 * therefore write a grant the checker later honoured as a signing wildcard (#136). These are now
 * separate values in separate key spaces.
 */
export type PermissionEventKind =
  /** A specific Nostr event kind. Only ever set by a signing request. */
  | number
  /**
   * Every event kind for this origin.
   *
   * Deliberately not producible by `grantPermission`: the approved contract says a wildcard must be
   * asked for in those words on a signing request, and nothing offers that yet. The value exists so
   * the checker and any future explicit path agree on how it is represented.
   */
  | 'any'
  /** The request carries no event kind at all, such as `get_public_key`. */
  | null;

export interface PermissionGrant {
  origin: string;
  /**
   * The account the grant was given to, as a public key.
   *
   * Part of the key. A grant belongs to the identity the user was looking at when they gave it, so
   * it cannot be inherited by another account on the same site (#116).
   *
   * Keyed by public key, never alias: aliases are user-editable, and a rename must not orphan a
   * grant or silently transfer it to a different identity.
   */
  accountPubkey: string;
  /**
   * The request type the grant was created from.
   *
   * Part of the key: a grant written by `get_public_key` lives in a different space from one
   * written by `sign_event` and can never satisfy it.
   */
  requestType: string;
  eventKind: PermissionEventKind;
  granted: boolean;
  timestamp: number;
  expiry?: number;
}

// Approval request queue types (ADR D5, D6)

/**
 * Request lifecycle states. `approved`, `rejected`, `expired`, and `interrupted` are terminal:
 * a request in any of them can never be approved.
 */
export type ApprovalRequestState =
  | 'queued'
  | 'presented'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'interrupted';

export const TERMINAL_REQUEST_STATES: readonly ApprovalRequestState[] = [
  'approved',
  'rejected',
  'expired',
  'interrupted',
];

/**
 * The durable shape of a queued request.
 *
 * This is the complete list of fields permitted in session storage (ADR D6). Event content,
 * event bodies, plaintext, ciphertext, invoices, preimages, and key material are transient and
 * must never appear here.
 */
export interface ApprovalRequestRecord {
  id: string;
  origin: string;
  requestType: string;
  eventKind: number;
  accountAlias: string | null;
  accountPubkey: string | null;
  /**
   * The account active in Porwr when the site asked. It differs from `accountPubkey` when the site
   * is connected as another account, which the prompt has to say (diogel-io/workspace#23).
   */
  activeAccountAlias: string | null;
  activeAccountPubkey: string | null;
  createdAt: number;
  expiresAt: number;
  state: ApprovalRequestState;
}

/**
 * Reviewable detail for a queued request.
 *
 * Memory-only, never persisted: event content, plaintext, ciphertext, and invoices are excluded
 * from durable storage by D6, and the panel reads them from the live service worker instead.
 */
export interface ApprovalRequestContent {
  /** Short human-readable summary shown before the user expands anything. */
  contentDescription?: string;
  /** The complete unsigned event, for `sign_event` requests only. */
  event?: UnsignedEvent;
  /** Counterparty for encryption and decryption requests. Never the plaintext itself. */
  counterpartyPubkey?: string;
  /** Whether durations beyond `once` may be offered at all (payments never may). */
  allowRemember: boolean;
}

/** Approval durations the user can choose. */
export type ApprovalDuration = 'once' | '8h' | 'always';

export interface ApprovalDecision {
  approved: boolean;
  duration: ApprovalDuration;
}

/** Why a decision was refused, when it was not applied. */
export type DecisionRefusal = 'unknown-request' | 'already-resolved' | 'expired';

export type DecisionResult =
  | { applied: true; record: ApprovalRequestRecord }
  | { applied: false; reason: DecisionRefusal };

// Handler function type
export type HandlerFn<T, R> = (payload: T, origin: string) => Promise<HandlerResult<R>>;
