/**
 * Background-owned approval request queue (ADR D1, D5, D6, D7, D8).
 *
 * The background is the single source of truth for request state. Extension UI observes this
 * queue and submits decisions against a request id; it never holds the authoritative record and
 * never resolves a provider promise.
 *
 * Expiry is evaluated rather than timed. A `setTimeout` does not survive service-worker
 * suspension, and `chrome.alarms` would add a permission the approved non-functional
 * requirements forbid, so every read and every decision re-evaluates expiry first.
 */

import { REQUEST_QUEUE_KEY, storageService } from '@/services/storage-service';
import { clampRequestExpiryMinutes } from '@/services/request-expiry';
import { REQUEST_EXPIRY_MINUTES } from '@/services/storage-service';
import { LogLevel, logService } from '@/services/log-service';
import {
  TERMINAL_REQUEST_STATES,
  type ApprovalRequestContent,
  type ApprovalDecision,
  type ApprovalRequestRecord,
  type ApprovalRequestState,
  type DecisionResult,
} from '../types/background';

export interface EnqueueRequestInput {
  origin: string;
  requestType: string;
  eventKind: number;
  accountAlias: string | null;
  accountPubkey: string | null;
  /** Absent for a request that acts for no account, such as one refused before it could bind. */
  activeAccountAlias?: string | null;
  activeAccountPubkey?: string | null;
}

interface PendingCallback {
  settle: (decision: ApprovalDecision) => void;
  fail: (error: Error) => void;
}

/**
 * Live provider callbacks, keyed by request id.
 *
 * Deliberately memory-only. A callback cannot survive a service-worker restart, and a request
 * whose callback is gone must never be signable (D7).
 */
const liveCallbacks = new Map<string, PendingCallback>();

/**
 * Reviewable content, keyed by request id.
 *
 * Deliberately memory-only and dropped as soon as a request reaches a terminal state. Event
 * content, plaintext, ciphertext, and invoices must never reach durable storage (D6, SR-14), so
 * the panel reads them from the live worker or not at all.
 */
const requestContent = new Map<string, ApprovalRequestContent>();

const forgetRequest = (id: string): void => {
  liveCallbacks.delete(id);
  requestContent.delete(id);
};

/** Reviewable detail for a request, or null once it has been resolved or the worker restarted. */
export const getRequestContent = (id: string): ApprovalRequestContent | null =>
  requestContent.get(id) ?? null;

const isTerminal = (state: ApprovalRequestState): boolean =>
  TERMINAL_REQUEST_STATES.includes(state);

const readRecords = async (): Promise<ApprovalRequestRecord[]> => {
  const stored = await storageService.get<ApprovalRequestRecord[]>(REQUEST_QUEUE_KEY, 'session');
  return Array.isArray(stored) ? stored : [];
};

type QueueChangeListener = () => void;

const queueChangeListeners = new Set<QueueChangeListener>();

/**
 * Notified after every write to the queue.
 *
 * Expiry is evaluated lazily on read rather than timed, so a request can leave the queue without
 * any caller having asked for it. Anything mirroring the queue outward — the toolbar badge (D4) —
 * has to learn about that from the write itself, not from a poll.
 */
export const onQueueChange = (listener: QueueChangeListener): (() => void) => {
  queueChangeListeners.add(listener);
  return () => queueChangeListeners.delete(listener);
};

const writeRecords = async (records: ApprovalRequestRecord[]): Promise<void> => {
  await storageService.set(REQUEST_QUEUE_KEY, records, 'session');
  for (const listener of queueChangeListeners) listener();
};

/**
 * Only the fields listed in D6 are permitted in durable storage. Anything a caller adds beyond
 * them is dropped here rather than trusted, so a future field addition cannot quietly persist
 * request content.
 */
const toDurableRecord = (record: ApprovalRequestRecord): ApprovalRequestRecord => ({
  id: record.id,
  origin: record.origin,
  requestType: record.requestType,
  eventKind: record.eventKind,
  accountAlias: record.accountAlias,
  accountPubkey: record.accountPubkey,
  // Records written before these fields existed read back without them.
  activeAccountAlias: record.activeAccountAlias ?? null,
  activeAccountPubkey: record.activeAccountPubkey ?? null,
  createdAt: record.createdAt,
  expiresAt: record.expiresAt,
  state: record.state,
});

const applyExpiry = (
  records: ApprovalRequestRecord[],
  now: number,
): { records: ApprovalRequestRecord[]; expired: ApprovalRequestRecord[] } => {
  const expired: ApprovalRequestRecord[] = [];
  const next = records.map((record) => {
    if (isTerminal(record.state) || record.expiresAt > now) return record;
    const updated: ApprovalRequestRecord = { ...record, state: 'expired' };
    expired.push(updated);
    return updated;
  });

  return { records: next, expired };
};

/** Read the queue with expiry applied, persisting any transition it caused. */
const loadQueue = async (now: number = Date.now()): Promise<ApprovalRequestRecord[]> => {
  const stored = await readRecords();
  const { records, expired } = applyExpiry(stored, now);

  if (expired.length > 0) {
    await writeRecords(records.map(toDurableRecord));
    for (const record of expired) {
      const callback = liveCallbacks.get(record.id);
      forgetRequest(record.id);
      callback?.settle({ approved: false, duration: 'once' });
    }
  }

  return records;
};

const resolveExpiryMinutes = async (): Promise<number> => {
  const stored = await storageService.get<number>(REQUEST_EXPIRY_MINUTES);
  // The stored value is a preference, not an authority (D8).
  return clampRequestExpiryMinutes(stored);
};

const newRequestId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/** Requests are presented oldest first, with the id as a deterministic tie-break. */
const byQueueOrder = (a: ApprovalRequestRecord, b: ApprovalRequestRecord): number =>
  a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt - b.createdAt;

export const listPendingRequests = async (
  now: number = Date.now(),
): Promise<ApprovalRequestRecord[]> => {
  const records = await loadQueue(now);
  return records.filter((record) => !isTerminal(record.state)).sort(byQueueOrder);
};

export const getPendingCount = async (now: number = Date.now()): Promise<number> =>
  (await listPendingRequests(now)).length;

export const getCurrentRequest = async (
  now: number = Date.now(),
): Promise<ApprovalRequestRecord | null> => {
  const pending = await listPendingRequests(now);
  return pending.find((record) => record.state === 'presented') ?? pending[0] ?? null;
};

export const markPresented = async (
  id: string,
  now: number = Date.now(),
): Promise<ApprovalRequestRecord | null> => {
  const records = await loadQueue(now);
  const target = records.find((record) => record.id === id);
  if (!target || isTerminal(target.state)) return null;

  const next = records.map(
    (record): ApprovalRequestRecord =>
      record.id === id ? { ...record, state: 'presented' } : record,
  );
  await writeRecords(next.map(toDurableRecord));
  return next.find((record) => record.id === id) ?? null;
};

/**
 * Return a presented request to the queue without deciding it.
 *
 * Used when the panel disconnects: closing the panel is never a decision (#113).
 */
export const requeuePresented = async (now: number = Date.now()): Promise<void> => {
  const records = await loadQueue(now);
  const next = records.map(
    (record): ApprovalRequestRecord =>
      record.state === 'presented' ? { ...record, state: 'queued' } : record,
  );
  await writeRecords(next.map(toDurableRecord));
};

/**
 * Enqueue a request and wait for its terminal outcome.
 *
 * The returned promise settles exactly once: on a user decision, on expiry, or on interruption.
 */
export const enqueueRequest = async (
  input: EnqueueRequestInput,
  content: ApprovalRequestContent = { allowRemember: true },
  now: number = Date.now(),
): Promise<{ record: ApprovalRequestRecord; decision: Promise<ApprovalDecision> }> => {
  const expiryMinutes = await resolveExpiryMinutes();
  const record: ApprovalRequestRecord = {
    id: newRequestId(),
    origin: input.origin,
    requestType: input.requestType,
    eventKind: input.eventKind,
    accountAlias: input.accountAlias,
    accountPubkey: input.accountPubkey,
    activeAccountAlias: input.activeAccountAlias ?? null,
    activeAccountPubkey: input.activeAccountPubkey ?? null,
    createdAt: now,
    // Stamped at creation: a later settings change must not move an existing request (D8).
    expiresAt: now + expiryMinutes * 60 * 1000,
    state: 'queued',
  };

  const records = await loadQueue(now);
  await writeRecords([...records, record].map(toDurableRecord));

  requestContent.set(record.id, content);

  const decision = new Promise<ApprovalDecision>((resolve, reject) => {
    liveCallbacks.set(record.id, {
      settle: resolve,
      fail: reject,
    });
  });

  return { record, decision };
};

/**
 * Apply a user decision to one request.
 *
 * Refuses unknown, already-terminal, and expired ids rather than applying them, so a stale panel
 * cannot act on a request that has already moved on (D5).
 */
export const submitDecision = async (
  id: string,
  decision: ApprovalDecision,
  now: number = Date.now(),
): Promise<DecisionResult> => {
  const records = await loadQueue(now);
  const target = records.find((record) => record.id === id);

  if (!target) {
    logService.log(LogLevel.WARN, '[Queue] Refused decision for unknown request', { id });
    return { applied: false, reason: 'unknown-request' };
  }

  if (target.state === 'expired') {
    logService.log(LogLevel.WARN, '[Queue] Refused decision for expired request', { id });
    return { applied: false, reason: 'expired' };
  }

  if (isTerminal(target.state)) {
    logService.log(LogLevel.WARN, '[Queue] Refused duplicate decision', {
      id,
      state: target.state,
    });
    return { applied: false, reason: 'already-resolved' };
  }

  const nextState: ApprovalRequestState = decision.approved ? 'approved' : 'rejected';
  const updated: ApprovalRequestRecord = { ...target, state: nextState };
  await writeRecords(
    records.map((record) => (record.id === id ? updated : record)).map(toDurableRecord),
  );

  const callback = liveCallbacks.get(id);
  forgetRequest(id);
  callback?.settle(decision);

  return { applied: true, record: updated };
};

/**
 * Reconcile persisted state after a service-worker restart.
 *
 * Every non-terminal persisted request has lost its live callback, so it becomes `interrupted`
 * and can never be approved (D7).
 */
export const reconcileInterruptedRequests = async (
  now: number = Date.now(),
): Promise<ApprovalRequestRecord[]> => {
  const records = await loadQueue(now);
  const interrupted: ApprovalRequestRecord[] = [];

  const next = records.map((record) => {
    if (isTerminal(record.state) || liveCallbacks.has(record.id)) return record;
    const updated: ApprovalRequestRecord = { ...record, state: 'interrupted' };
    forgetRequest(record.id);
    interrupted.push(updated);
    return updated;
  });

  if (interrupted.length > 0) {
    await writeRecords(next.map(toDurableRecord));
    logService.log(LogLevel.WARN, '[Queue] Marked requests interrupted after restart', {
      count: interrupted.length,
    });
  }

  return interrupted;
};

/** Drop terminal records so the session store does not grow without bound. */
export const pruneResolvedRequests = async (now: number = Date.now()): Promise<void> => {
  const records = await loadQueue(now);
  const next = records.filter((record) => !isTerminal(record.state));
  if (next.length !== records.length) {
    await writeRecords(next.map(toDurableRecord));
  }
};

/**
 * Interrupt every live request for an origin whose page has gone.
 *
 * Called when the last tab holding an origin disappears, which the browser reports through the
 * content script's port. The provider promise those requests would resolve no longer has a page
 * listening to it, so they must become non-signable rather than sit in the queue looking
 * actionable (D7).
 *
 * Scoped to the origin, not to a tab: a request record carries the requesting origin and no tab
 * id, so two tabs on the same origin are indistinguishable here. Interrupting only once *no* tab
 * holds the origin is the conservative reading — it never interrupts a request another live tab
 * might still be waiting on.
 */
export const interruptRequestsForOrigin = async (
  origin: string,
  now: number = Date.now(),
): Promise<ApprovalRequestRecord[]> => {
  const records = await loadQueue(now);
  const interrupted: ApprovalRequestRecord[] = [];

  const next = records.map((record) => {
    if (record.origin !== origin || isTerminal(record.state)) return record;
    const updated: ApprovalRequestRecord = { ...record, state: 'interrupted' };
    interrupted.push(updated);
    return updated;
  });

  if (interrupted.length === 0) return [];

  await writeRecords(next.map(toDurableRecord));
  for (const record of interrupted) {
    const callback = liveCallbacks.get(record.id);
    forgetRequest(record.id);
    // Fail closed: the page is gone, so the request is refused rather than left hanging.
    callback?.settle({ approved: false, duration: 'once' });
  }

  logService.log(LogLevel.WARN, '[Queue] Marked requests interrupted after the page went away', {
    origin,
    count: interrupted.length,
  });

  return interrupted;
};

/** Test seam: clear in-memory callbacks. Not used by production code. */
export const __resetLiveCallbacksForTests = (): void => {
  liveCallbacks.clear();
  requestContent.clear();
  queueChangeListeners.clear();
};
