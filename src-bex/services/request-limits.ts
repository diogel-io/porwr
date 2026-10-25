/**
 * Bounds on what a website can make the background hold (ADR D18, #372).
 *
 * Without them a site could queue requests without limit, each carrying a multi-megabyte payload:
 * the panel presents oldest first, so a real approval was buried behind the flood, and the worker
 * held every payload in memory meanwhile (D6 keeps request content memory-only).
 */

import type { PageAction } from '../page-actions';

/** Live requests one site may hold. A full origin is refused, never evicted. */
export const MAX_PENDING_PER_ORIGIN = 5;

/** Live requests the queue may hold across every site. */
export const MAX_PENDING_TOTAL = 20;

/**
 * Payload ceilings, in string length (UTF-16 code units) rather than UTF-8 bytes, so checking a
 * flooded request allocates nothing beyond the serialisation of the whole payload.
 */
const KIB = 1024;
export const MAX_PAGE_PAYLOAD_LENGTH = 512 * KIB;
export const MAX_EVENT_CONTENT_LENGTH = 256 * KIB;
export const MAX_EVENT_TAGS_LENGTH = 256 * KIB;
export const MAX_PLAINTEXT_LENGTH = 256 * KIB;
export const MAX_CIPHERTEXT_LENGTH = 256 * KIB;
export const MAX_PAYMENT_REQUEST_LENGTH = 8 * KIB;

/**
 * The message a site gets back when the queue is full.
 *
 * The same for the per-origin and the global cap, so a site cannot learn that other sites have
 * requests waiting.
 */
export const QUEUE_FULL_MESSAGE =
  'Too many pending requests. Answer the ones waiting in Porwr, then try again.';

export const PAYLOAD_TOO_LARGE_MESSAGE = 'Request is too large for Porwr to review.';

export const PAYLOAD_INVALID_MESSAGE = 'Request is malformed.';

/** Thrown by the queue when a request would exceed a cap. The page sees only the message. */
export class RequestQueueFullError extends Error {
  readonly scope: 'origin' | 'global';

  constructor(scope: 'origin' | 'global') {
    super(QUEUE_FULL_MESSAGE);
    this.name = 'RequestQueueFullError';
    this.scope = scope;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A required string field, within its ceiling. */
const checkString = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return PAYLOAD_INVALID_MESSAGE;
  return value.length > max ? PAYLOAD_TOO_LARGE_MESSAGE : null;
};

/** Serialised length, or null for a value that cannot be serialised (a cycle, a BigInt). */
const serialisedLength = (value: unknown): number | null => {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return null;
  }
};

const checkSignEvent = (payload: Record<string, unknown>): string | null => {
  const { event } = payload;
  if (!isRecord(event)) return PAYLOAD_INVALID_MESSAGE;
  // An event with no content or tags is the signer's to refuse; only what is present is measured.
  if (event.content !== undefined) {
    const content = checkString(event.content, MAX_EVENT_CONTENT_LENGTH);
    if (content) return content;
  }
  if (event.tags !== undefined) {
    if (!Array.isArray(event.tags)) return PAYLOAD_INVALID_MESSAGE;
    const length = serialisedLength(event.tags);
    if (length === null) return PAYLOAD_INVALID_MESSAGE;
    if (length > MAX_EVENT_TAGS_LENGTH) return PAYLOAD_TOO_LARGE_MESSAGE;
  }
  return null;
};

const fieldChecks: Partial<
  Record<PageAction, (payload: Record<string, unknown>) => string | null>
> = {
  'nostr.signEvent': checkSignEvent,
  'nostr.nip04.encrypt': (payload) => checkString(payload.plaintext, MAX_PLAINTEXT_LENGTH),
  'nostr.nip44.encrypt': (payload) => checkString(payload.plaintext, MAX_PLAINTEXT_LENGTH),
  'nostr.nip04.decrypt': (payload) => checkString(payload.ciphertext, MAX_CIPHERTEXT_LENGTH),
  'nostr.nip44.decrypt': (payload) => checkString(payload.ciphertext, MAX_CIPHERTEXT_LENGTH),
  'webln.sendPayment': (payload) => checkString(payload.paymentRequest, MAX_PAYMENT_REQUEST_LENGTH),
};

/**
 * Why a page payload is refused, or null when it may reach its handler.
 *
 * Runs on the page channel before any handler, so an oversized request is never queued. The whole
 * payload is bounded first, which also covers keys no handler reads.
 */
export const checkPagePayload = (
  action: PageAction,
  payload: Record<string, unknown>,
): string | null => {
  const length = serialisedLength(payload);
  if (length === null) return PAYLOAD_INVALID_MESSAGE;
  if (length > MAX_PAGE_PAYLOAD_LENGTH) return PAYLOAD_TOO_LARGE_MESSAGE;
  return fieldChecks[action]?.(payload) ?? null;
};
