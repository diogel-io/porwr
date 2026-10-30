/**
 * Approval presentation rules.
 *
 * Owns the labels, the event-kind risk classification, and the grant options each class may be
 * offered (ADR D11, D12). Kept out of the components so the panel and any remaining approval
 * surface describe a request identically, and so the rules are testable on their own.
 */

import { nip19 } from 'nostr-tools';
import { DM_RELAY_LIST_KIND } from '@/types/messaging';
import type { ApprovalDuration, ApprovalRequestRecord } from '@/../src-bex/types/background';

/**
 * An expired or interrupted request, shown as a notice until it is dismissed (S13, S14).
 *
 * It can never be approved, so nothing that offers a decision should be handed one.
 */
export const isNotice = (record: ApprovalRequestRecord | null | undefined): boolean =>
  record?.state === 'expired' || record?.state === 'interrupted';

export type RequestRiskClass = 'standard' | 'elevated' | 'unknown' | 'payment';

export interface UnsignedEventPreview {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
  pubkey?: string;
}

export const REQUEST_TYPE_LABELS: Readonly<Record<string, string>> = {
  get_public_key: 'Public key request',
  get_relays: 'Relay list request',
  sign_event: 'Sign event request',
  nip04_encrypt: 'NIP-04 encryption request',
  nip04_decrypt: 'NIP-04 decryption request',
  nip44_encrypt: 'NIP-44 encryption request',
  nip44_decrypt: 'NIP-44 decryption request',
  webln_enable: 'WebLN wallet access request',
  webln_send_payment: 'WebLN payment request',
};

export const NOSTR_KIND_LABELS: Readonly<Record<number, string>> = {
  0: 'Profile metadata',
  1: 'Text note',
  3: 'Contact list',
  4: 'Encrypted direct message',
  5: 'Event deletion',
  6: 'Repost',
  7: 'Reaction',
  16: 'Generic repost',
  40: 'Channel creation',
  41: 'Channel metadata',
  42: 'Channel message',
  44: 'Channel mute user',
  1063: 'File metadata',
  1984: 'Reporting',
  9734: 'Zap request',
  9735: 'Zap receipt',
  10002: 'Relay list metadata',
  [DM_RELAY_LIST_KIND]: 'DM relay list',
  10063: 'Blossom server list',
  22242: 'Client authentication',
  27235: 'HTTP authentication',
  30023: 'Long-form content',
};

/**
 * Kinds that change identity-visible state or grant session access (D12).
 *
 * These are not the kinds users see most often; they are the ones where a standing grant does
 * the most damage.
 */
export const ELEVATED_EVENT_KINDS: readonly number[] = [
  3,
  // A NIP-04 direct message speaks for you, and its content is ciphertext the user cannot review
  // when granting, so a site never sends them unprompted for good (#374).
  4,
  5,
  9734,
  10002,
  DM_RELAY_LIST_KIND,
  // Names the servers the account's media is uploaded to and fetched from (porwr#417).
  10063,
  22242,
  27235,
];

const PAYMENT_REQUEST_TYPES: readonly string[] = ['webln_send_payment'];

/**
 * Request types without an event kind that are elevated anyway (#139). A standing decrypt grant
 * lets a site read every message sent to the account from anyone, so it is never `always`.
 */
const ELEVATED_REQUEST_TYPES: readonly string[] = ['nip04_decrypt', 'nip44_decrypt'];

/** Effects named in the warning, so the user is told what the kind actually does. */
const ELEVATED_KIND_EFFECTS: Readonly<Record<number, string>> = {
  3: 'replace the list of accounts you follow',
  4: 'send encrypted direct messages as you',
  5: 'request deletion of events you previously published',
  // Signing a zap request attributes the zap to you; paying it is a separate WebLN approval (#270).
  9734: 'attach your identity to a Lightning zap',
  10002: 'replace the list of relays your identity advertises',
  [DM_RELAY_LIST_KIND]: 'replace the relays others deliver your private messages to',
  10063: 'replace the media servers your identity advertises',
  22242: 'prove your identity to this site for a session',
  // NIP-98 (#215): Bancwr signs its users in with one, bound to its login URL.
  27235: "prove your identity to this site's server",
};

export const isKnownEventKind = (kind: number): boolean =>
  Object.prototype.hasOwnProperty.call(NOSTR_KIND_LABELS, kind);

export const getRequestTypeLabel = (requestType: string): string =>
  REQUEST_TYPE_LABELS[requestType] ?? 'Signer request';

export const getEventKindLabel = (kind: number): string => {
  if (!Number.isInteger(kind) || kind < 0) return 'No Nostr event kind';
  const label = NOSTR_KIND_LABELS[kind];
  return label ? `${label} (${kind})` : `Unrecognised event kind (${kind})`;
};

export const classifyRequest = (requestType: string, eventKind: number): RequestRiskClass => {
  if (PAYMENT_REQUEST_TYPES.includes(requestType)) return 'payment';
  if (ELEVATED_REQUEST_TYPES.includes(requestType)) return 'elevated';
  // -1 means the request carries no event kind, not "any kind".
  if (eventKind < 0) return 'standard';
  if (ELEVATED_EVENT_KINDS.includes(eventKind)) return 'elevated';
  if (!isKnownEventKind(eventKind)) return 'unknown';
  return 'standard';
};

export const getRiskWarning = (
  riskClass: RequestRiskClass,
  eventKind: number,
): string | undefined => {
  if (riskClass === 'elevated') {
    if (eventKind < 0) return 'Approving this lets the site read private messages sent to you.';
    const effect = ELEVATED_KIND_EFFECTS[eventKind];
    return effect
      ? `Approving this lets the site ${effect}.`
      : 'This request has a lasting effect on your identity.';
  }
  if (riskClass === 'unknown') {
    return 'Porwr does not recognise this event kind. Read the full event before approving.';
  }
  return undefined;
};

/**
 * Grant options a request may be offered.
 *
 * Payments are one-time whatever else is true (D11). Unknown kinds may only be approved once, and
 * elevated kinds may never be granted `always` (D12). Options that are not available are omitted
 * rather than shown disabled.
 */
export const getAllowedDurations = (
  riskClass: RequestRiskClass,
  allowRemember: boolean,
): ApprovalDuration[] => {
  if (!allowRemember || riskClass === 'payment' || riskClass === 'unknown') return ['once'];
  if (riskClass === 'elevated') return ['once', '8h'];
  return ['once', '8h', 'always'];
};

/** Whether the full event should be open by default rather than the formatted summary (D12). */
export const shouldDefaultToFullEvent = (riskClass: RequestRiskClass): boolean =>
  riskClass === 'unknown';

export interface FormattedEventField {
  label: string;
  value: string;
}

/** Human-readable view of the meaningful fields, for the formatted preview mode. */
export const formatEventFields = (event: UnsignedEventPreview): FormattedEventField[] => {
  const fields: FormattedEventField[] = [
    { label: 'Kind', value: getEventKindLabel(event.kind) },
    { label: 'Created', value: new Date(event.created_at * 1000).toLocaleString() },
  ];

  // The URL and method are what bind an HTTP authentication event to one request (NIP-98), so
  // they come first, and a missing one is said rather than left out (#215).
  if (event.kind === HTTP_AUTH_KIND) {
    const missing = 'Missing (not a valid HTTP authentication event)';
    fields.push({ label: 'URL', value: tagValue(event, 'u') ?? missing });
    fields.push({ label: 'Method', value: tagValue(event, 'method')?.toUpperCase() ?? missing });
  }

  // A zap request is built by the client and only signed here, so the panel says what the
  // signature attaches your identity to: who is zapped, how much, and for what (#270, NIP-57).
  if (event.kind === ZAP_REQUEST_KIND) fields.push(...zapRequestFields(event));

  // A repost's content is the reposted note as JSON, which the rows below summarise (#323, NIP-18).
  if (isRepostKind(event.kind)) fields.push(...repostFields(event));

  const mentions = event.tags.filter((tag) => tag[0] === 'p').length;
  if (mentions > 0) fields.push({ label: 'Mentions', value: String(mentions) });

  const references = event.tags.filter((tag) => tag[0] === 'e').length;
  if (references > 0) fields.push({ label: 'References events', value: String(references) });

  if (event.tags.length > 0) fields.push({ label: 'Tags', value: String(event.tags.length) });

  return fields;
};

export const MAX_PREVIEW_CHARACTERS = 600;

export interface TruncatedContent {
  text: string;
  truncated: boolean;
  fullLength: number;
}

/** Truncation is always visible to the user; nothing is silently shortened (specification §6). */
export const truncateForPreview = (
  content: string,
  limit: number = MAX_PREVIEW_CHARACTERS,
): TruncatedContent => {
  const normalized = content ?? '';
  if (normalized.length <= limit) {
    return { text: normalized, truncated: false, fullLength: normalized.length };
  }
  return { text: normalized.slice(0, limit), truncated: true, fullLength: normalized.length };
};

/** NIP-57 zap request. */
export const ZAP_REQUEST_KIND = 9734;

/** A millisat amount as the user reads it: whole sats where it divides, millisats otherwise. */
const formatMillisats = (value: string): string | undefined => {
  if (!/^\d+$/.test(value)) return undefined;
  const msat = BigInt(value);
  if (msat === 0n) return undefined;
  return msat % 1000n === 0n
    ? `${(msat / 1000n).toLocaleString()} sats`
    : `${msat.toLocaleString()} millisats`;
};

const formatPubkey = (hex: string): string => {
  try {
    return nip19.npubEncode(hex);
  } catch {
    return hex;
  }
};

const zapRequestFields = (event: UnsignedEventPreview): FormattedEventField[] => {
  const fields: FormattedEventField[] = [];
  const amount = tagValue(event, 'amount');
  fields.push({
    label: 'Zap amount',
    value: amount ? (formatMillisats(amount) ?? `Invalid (${amount})`) : 'Not stated',
  });
  const recipient = tagValue(event, 'p');
  fields.push({ label: 'Zap recipient', value: recipient ? formatPubkey(recipient) : 'Missing' });
  const zappedEvent = tagValue(event, 'e');
  const zappedAddress = tagValue(event, 'a');
  if (zappedEvent) fields.push({ label: 'Zapped event', value: zappedEvent });
  else if (zappedAddress) fields.push({ label: 'Zapped event', value: zappedAddress });
  else if (recipient) fields.push({ label: 'Zapped event', value: 'None (profile zap)' });
  if (event.content.trim()) fields.push({ label: 'Zap comment', value: event.content.trim() });
  return fields;
};

/** NIP-18 repost of a text note. */
export const REPOST_KIND = 6;

/** NIP-18 generic repost: any kind of event other than a text note. */
export const GENERIC_REPOST_KIND = 16;

const isRepostKind = (kind: number): boolean =>
  kind === REPOST_KIND || kind === GENERIC_REPOST_KIND;

/** Long enough to recognise the note, short enough to keep Approve and Reject on screen. */
export const REPOST_SNIPPET_CHARACTERS = 140;

/** Kind 4 content is ciphertext, which says nothing to the reader. */
const ENCRYPTED_DIRECT_MESSAGE_KIND = 4;

interface EmbeddedNote {
  readonly id?: string | undefined;
  readonly pubkey?: string | undefined;
  readonly kind?: number | undefined;
  readonly content?: string | undefined;
}

const parseEmbeddedNote = (content: string): EmbeddedNote | undefined => {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    const { id, pubkey, kind, content: text } = parsed as Record<string, unknown>;
    return {
      id: typeof id === 'string' ? id : undefined,
      pubkey: typeof pubkey === 'string' ? pubkey : undefined,
      kind: typeof kind === 'number' ? kind : undefined,
      content: typeof text === 'string' ? text : undefined,
    };
  } catch {
    return undefined;
  }
};

/** The author named by an `a` coordinate (`kind:pubkey:d-tag`), when it names one. */
const coordinateAuthor = (coordinate: string | undefined): string | undefined => {
  const pubkey = coordinate?.split(':')[1];
  return pubkey && /^[0-9a-f]{64}$/i.test(pubkey) ? pubkey : undefined;
};

/** The kind a generic repost says it carries (`k` tag), as a number, or why it cannot be read. */
const repostedKind = (event: UnsignedEventPreview): number | 'missing' | 'invalid' => {
  const value = tagValue(event, 'k');
  if (value === undefined) return 'missing';
  return /^\d+$/.test(value) ? Number(value) : 'invalid';
};

/**
 * What a repost signature commits to. The note is named by the `e` tag (or, for a generic repost
 * of a replaceable event, the `a` coordinate) and its kind by the `k` tag; the embedded JSON is
 * whatever the site sent and cannot be checked here, so a mismatch is called out, not trusted.
 */
const repostFields = (event: UnsignedEventPreview): FormattedEventField[] => {
  const generic = event.kind === GENERIC_REPOST_KIND;
  const fields: FormattedEventField[] = [];
  const noteId = tagValue(event, 'e');
  const coordinate = generic ? tagValue(event, 'a') : undefined;
  fields.push({ label: 'Reposted note', value: noteId ?? coordinate ?? 'Missing' });

  const kind = generic ? repostedKind(event) : undefined;
  if (kind !== undefined) {
    fields.push({
      label: 'Reposted kind',
      value:
        kind === 'missing'
          ? 'Not stated'
          : kind === 'invalid'
            ? `Invalid (${tagValue(event, 'k')})`
            : getEventKindLabel(kind),
    });
  }

  const body = event.content.trim();
  const note = body ? parseEmbeddedNote(body) : undefined;

  const author = tagValue(event, 'p') ?? note?.pubkey ?? coordinateAuthor(coordinate);
  fields.push({ label: 'Reposted author', value: author ? formatPubkey(author) : 'Not stated' });

  if (note?.content && kind !== ENCRYPTED_DIRECT_MESSAGE_KIND) {
    const text = note.content.replace(/\s+/g, ' ').trim();
    fields.push({
      label: 'Reposted text',
      value:
        text.length > REPOST_SNIPPET_CHARACTERS
          ? `${text.slice(0, REPOST_SNIPPET_CHARACTERS)}…`
          : text,
    });
  }

  if (body && !note) fields.push({ label: 'Embedded note', value: 'Not valid JSON' });
  else if (note?.id && noteId && note.id !== noteId) {
    fields.push({ label: 'Embedded note', value: 'Does not match the reposted note' });
  } else if (typeof kind === 'number' && note?.kind !== undefined && note.kind !== kind) {
    fields.push({ label: 'Embedded note', value: 'Kind does not match the k tag' });
  }
  return fields;
};

/** The content the formatted view prints; a repost's is summarised by its rows instead. */
export const formattedContent = (event: UnsignedEventPreview): string =>
  isRepostKind(event.kind) ? '' : event.content;

/** NIP-98 HTTP Auth. */
export const HTTP_AUTH_KIND = 27235;

/** The first value of the first tag with this name, if it has a non-empty one. */
const tagValue = (event: UnsignedEventPreview, name: string): string | undefined => {
  const value = event.tags.find((tag) => tag[0] === name)?.[1]?.trim();
  return value ? value : undefined;
};

export type HttpAuthTarget =
  | { readonly valid: true; readonly url: string; readonly method: string; readonly origin: string }
  | { readonly valid: false; readonly reason: 'missing-url' | 'missing-method' | 'invalid-url' };

/**
 * What a NIP-98 HTTP authentication event authorises: the request URL (`u`), its method, and the
 * URL's origin, which the panel compares with the site asking (#215).
 */
export const httpAuthTarget = (event: UnsignedEventPreview): HttpAuthTarget => {
  const url = tagValue(event, 'u');
  if (!url) return { valid: false, reason: 'missing-url' };
  const method = tagValue(event, 'method');
  if (!method) return { valid: false, reason: 'missing-method' };
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return { valid: false, reason: 'invalid-url' };
  }
  if (origin === 'null') return { valid: false, reason: 'invalid-url' };
  return { valid: true, url, method: method.toUpperCase(), origin };
};

/**
 * The origin an HTTP authentication event authorises, when it is not the site asking for it:
 * a site asking you to prove your identity to someone else's server (#215). Undefined when the
 * event is not HTTP authentication, is malformed, or targets the asking site.
 */
export const httpAuthOtherOrigin = (
  event: UnsignedEventPreview | null | undefined,
  requestOrigin: string,
): string | undefined => {
  if (!event || event.kind !== HTTP_AUTH_KIND) return undefined;
  const target = httpAuthTarget(event);
  if (!target.valid) return undefined;
  let site: string;
  try {
    site = new URL(requestOrigin).origin;
  } catch {
    return target.origin;
  }
  return target.origin === site ? undefined : target.origin;
};
