import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  enqueueRequest,
  getRequestContent,
  reconcileInterruptedRequests,
  submitDecision,
  __resetLiveCallbacksForTests,
} from '@/../src-bex/services/request-queue';
import { REQUEST_QUEUE_KEY } from '@/services/storage-service';
import type { ApprovalRequestRecord } from '@/../src-bex/types/background';

vi.mock('@/services/log-service', () => ({
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
  logService: { log: vi.fn() },
}));

const store = new Map<string, unknown>();

vi.mock('@/services/storage-service', async () => {
  const actual = await vi.importActual<typeof import('@/services/storage-service')>(
    '@/services/storage-service',
  );
  return {
    ...actual,
    storageService: {
      get: vi.fn((key: string) => Promise.resolve(store.get(key))),
      set: vi.fn((key: string, value: unknown) => {
        store.set(key, value);
        return Promise.resolve();
      }),
    },
  };
});

const input = {
  origin: 'https://example.com',
  requestType: 'sign_event',
  eventKind: 1,
  accountAlias: 'alice',
  accountPubkey: null,
};

const content = {
  contentDescription: 'a note',
  event: { kind: 1, content: 'secret note', tags: [], created_at: 1 },
  allowRemember: true,
};

/**
 * Reviewable content is what the panel shows and what must never be written down: event content,
 * plaintext, and invoices stay in worker memory only (ADR D6, SR-14).
 */
describe('request content', () => {
  beforeEach(() => {
    store.clear();
    __resetLiveCallbacksForTests();
    vi.clearAllMocks();
  });

  it('is readable while the request is live', async () => {
    const { record } = await enqueueRequest(input, content);
    expect(getRequestContent(record.id)?.event?.content).toBe('secret note');
  });

  it('never reaches durable storage', async () => {
    await enqueueRequest(input, content);
    const stored = JSON.stringify(store.get(REQUEST_QUEUE_KEY));
    // Values, not key substrings: "event" legitimately appears inside `sign_event` and
    // `eventKind`. Field-level coverage is the final test in this file.
    expect(stored).not.toContain('secret note');
    expect(stored).not.toContain('a note');
  });

  it('is dropped once the request is decided', async () => {
    const { record } = await enqueueRequest(input, content);
    await submitDecision(record.id, { approved: true, duration: 'once' });
    expect(getRequestContent(record.id)).toBeNull();
  });

  it('is dropped when a request is interrupted', async () => {
    const { record } = await enqueueRequest(input, content);
    __resetLiveCallbacksForTests();
    // Content is gone with the worker, exactly as the record becomes non-signable.
    await reconcileInterruptedRequests();
    expect(getRequestContent(record.id)).toBeNull();
  });

  it('returns null for an unknown id rather than throwing', () => {
    expect(getRequestContent('missing')).toBeNull();
  });

  it('keeps the durable record to its permitted fields', async () => {
    await enqueueRequest(input, content);
    const records = store.get(REQUEST_QUEUE_KEY) as ApprovalRequestRecord[];
    for (const record of records) {
      expect(Object.keys(record)).not.toContain('event');
      expect(Object.keys(record)).not.toContain('contentDescription');
    }
  });
});
