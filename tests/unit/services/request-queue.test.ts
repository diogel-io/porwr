import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  enqueueRequest,
  getCurrentRequest,
  getPendingCount,
  listPendingRequests,
  markPresented,
  pruneResolvedRequests,
  reconcileInterruptedRequests,
  requeuePresented,
  submitDecision,
  interruptRequestsForOrigin,
  onQueueChange,
  __resetLiveCallbacksForTests,
} from 'app/src-bex/services/request-queue';
import { REQUEST_EXPIRY_MINUTES, REQUEST_QUEUE_KEY } from 'src/services/storage-service';
import type { ApprovalRequestRecord } from 'app/src-bex/types/background';

vi.mock('src/services/log-service', () => ({
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
  logService: { log: vi.fn() },
}));

const store = new Map<string, unknown>();

vi.mock('src/services/storage-service', async () => {
  const actual = await vi.importActual<typeof import('src/services/storage-service')>(
    'src/services/storage-service',
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

const baseInput = {
  origin: 'https://example.com',
  requestType: 'sign_event',
  eventKind: 1,
  accountAlias: 'alice',
  accountPubkey: null,
};

const readStored = (): ApprovalRequestRecord[] =>
  (store.get(REQUEST_QUEUE_KEY) as ApprovalRequestRecord[] | undefined) ?? [];

describe('request queue', () => {
  beforeEach(() => {
    store.clear();
    __resetLiveCallbacksForTests();
    vi.clearAllMocks();
  });

  describe('concurrency', () => {
    it('queues concurrent requests instead of rejecting the second', async () => {
      const first = await enqueueRequest(baseInput);
      const second = await enqueueRequest({ ...baseInput, origin: 'https://other.example' });

      const pending = await listPendingRequests();
      expect(pending).toHaveLength(2);
      expect(first.record.id).not.toBe(second.record.id);
      expect(await getPendingCount()).toBe(2);
    });

    it('presents requests in deterministic order', async () => {
      const now = 1_000_000;
      await enqueueRequest({ ...baseInput, origin: 'https://a.example' }, { allowRemember: true }, now);
      await enqueueRequest({ ...baseInput, origin: 'https://b.example' }, { allowRemember: true }, now + 10);

      const current = await getCurrentRequest(now + 20);
      expect(current?.origin).toBe('https://a.example');
    });

    it('resolves each request exactly once', async () => {
      const first = await enqueueRequest(baseInput);
      const second = await enqueueRequest(baseInput);

      const settled: string[] = [];
      void first.decision.then(() => settled.push('first'));
      void second.decision.then(() => settled.push('second'));

      await submitDecision(first.record.id, { approved: true, duration: 'once' });
      await submitDecision(second.record.id, { approved: false, duration: 'once' });
      await Promise.all([first.decision, second.decision]);

      expect(settled).toEqual(['first', 'second']);
    });
  });

  describe('decision integrity', () => {
    it('refuses a decision for an unknown id', async () => {
      const result = await submitDecision('nope', { approved: true, duration: 'once' });
      expect(result).toEqual({ applied: false, reason: 'unknown-request' });
    });

    it('refuses a duplicate decision', async () => {
      const { record } = await enqueueRequest(baseInput);
      await submitDecision(record.id, { approved: true, duration: 'once' });

      const second = await submitDecision(record.id, { approved: true, duration: 'once' });
      expect(second).toEqual({ applied: false, reason: 'already-resolved' });
    });

    it('refuses a decision on an expired request', async () => {
      const now = 1_000_000;
      const { record } = await enqueueRequest(baseInput, { allowRemember: true }, now);

      const result = await submitDecision(
        record.id,
        { approved: true, duration: 'once' },
        now + 11 * 60 * 1000,
      );
      expect(result).toEqual({ applied: false, reason: 'expired' });
    });
  });

  describe('expiry', () => {
    it('expires from creation, not from presentation', async () => {
      const now = 1_000_000;
      const { record } = await enqueueRequest(baseInput, { allowRemember: true }, now);
      await markPresented(record.id, now + 60_000);

      const pending = await listPendingRequests(now + 6 * 60 * 1000);
      expect(pending).toHaveLength(0);
      expect(readStored()[0]?.state).toBe('expired');
    });

    it('stamps the expiry at creation so a later settings change cannot move it', async () => {
      const now = 1_000_000;
      store.set(REQUEST_EXPIRY_MINUTES, 1);
      const { record } = await enqueueRequest(baseInput, { allowRemember: true }, now);
      expect(record.expiresAt).toBe(now + 60_000);

      store.set(REQUEST_EXPIRY_MINUTES, 10);
      const stored = readStored().find((item) => item.id === record.id);
      expect(stored?.expiresAt).toBe(now + 60_000);
    });

    it('clamps an out-of-range stored expiry preference', async () => {
      const now = 1_000_000;
      store.set(REQUEST_EXPIRY_MINUTES, 0);
      const zero = await enqueueRequest(baseInput, { allowRemember: true }, now);
      expect(zero.record.expiresAt).toBe(now + 60_000);

      store.set(REQUEST_EXPIRY_MINUTES, 9999);
      const huge = await enqueueRequest(baseInput, { allowRemember: true }, now);
      expect(huge.record.expiresAt).toBe(now + 10 * 60 * 1000);
    });
  });

  describe('interruption', () => {
    it('marks requests interrupted when their callback is gone', async () => {
      await enqueueRequest(baseInput);
      // Simulates a service-worker restart: records survive in session storage, callbacks do not.
      __resetLiveCallbacksForTests();

      const interrupted = await reconcileInterruptedRequests();
      expect(interrupted).toHaveLength(1);
      expect(readStored()[0]?.state).toBe('interrupted');
    });

    it('cannot approve an interrupted request', async () => {
      const { record } = await enqueueRequest(baseInput);
      __resetLiveCallbacksForTests();
      await reconcileInterruptedRequests();

      const result = await submitDecision(record.id, { approved: true, duration: 'once' });
      expect(result).toEqual({ applied: false, reason: 'already-resolved' });
    });

    it('leaves requests with a live callback alone', async () => {
      await enqueueRequest(baseInput);
      const interrupted = await reconcileInterruptedRequests();
      expect(interrupted).toHaveLength(0);
    });
  });

  describe('panel lifecycle', () => {
    it('requeues a presented request without deciding it', async () => {
      const { record } = await enqueueRequest(baseInput);
      await markPresented(record.id);
      await requeuePresented();

      const stored = readStored().find((item) => item.id === record.id);
      expect(stored?.state).toBe('queued');
    });

    it('keeps the original expiry across requeue', async () => {
      const now = 1_000_000;
      const { record } = await enqueueRequest(baseInput, { allowRemember: true }, now);
      await markPresented(record.id, now + 1000);
      await requeuePresented(now + 2000);

      const stored = readStored().find((item) => item.id === record.id);
      expect(stored?.expiresAt).toBe(record.expiresAt);
    });
  });

  describe('page gone (#113)', () => {
    it('interrupts every live request for the origin', async () => {
      const { record } = await enqueueRequest(baseInput);

      const interrupted = await interruptRequestsForOrigin('https://example.com');

      expect(interrupted).toHaveLength(1);
      expect(readStored().find((item) => item.id === record.id)?.state).toBe('interrupted');
    });

    it('settles the waiting provider promise rather than leaving the page hanging', async () => {
      const { decision } = await enqueueRequest(baseInput);

      await interruptRequestsForOrigin('https://example.com');

      // Fail closed: the page is gone, so the request is refused, not approved.
      await expect(decision).resolves.toEqual({ approved: false, duration: 'once' });
    });

    it('cannot approve a request whose page has gone', async () => {
      const { record } = await enqueueRequest(baseInput);
      await interruptRequestsForOrigin('https://example.com');

      const result = await submitDecision(record.id, { approved: true, duration: 'once' });
      expect(result).toEqual({ applied: false, reason: 'already-resolved' });
    });

    it('leaves other origins alone', async () => {
      const { record } = await enqueueRequest(baseInput);

      const interrupted = await interruptRequestsForOrigin('https://other.example');

      expect(interrupted).toHaveLength(0);
      expect(readStored().find((item) => item.id === record.id)?.state).not.toBe('interrupted');
    });

    it('does not disturb a request that already reached a terminal state', async () => {
      const { record } = await enqueueRequest(baseInput);
      await submitDecision(record.id, { approved: true, duration: 'once' });

      const interrupted = await interruptRequestsForOrigin('https://example.com');

      expect(interrupted).toHaveLength(0);
      expect(readStored().find((item) => item.id === record.id)?.state).toBe('approved');
    });
  });

  describe('change notification', () => {
    it('reports a write so the toolbar can mirror the queue', async () => {
      const listener = vi.fn();
      onQueueChange(listener);

      await enqueueRequest(baseInput);

      expect(listener).toHaveBeenCalled();
    });

    it('reports an expiry, which no caller asked for', async () => {
      const now = 1_000_000;
      const { record } = await enqueueRequest(baseInput, { allowRemember: true }, now);

      const listener = vi.fn();
      onQueueChange(listener);

      // Expiry is evaluated on read, so this write happens with no decision and no caller.
      await listPendingRequests(record.expiresAt + 1);

      // Assert the expiry actually happened, so the notification is not credited to some other write.
      expect(readStored().find((item) => item.id === record.id)?.state).toBe('expired');
      expect(listener).toHaveBeenCalled();
    });
  });

  describe('persistence boundary', () => {
    it('persists only the fields permitted by D6', async () => {
      await enqueueRequest(baseInput);

      const permitted = [
        'id',
        'origin',
        'requestType',
        'eventKind',
        'accountAlias',
        'accountPubkey',
        'activeAccountAlias',
        'activeAccountPubkey',
        'createdAt',
        'expiresAt',
        'state',
      ];
      for (const record of readStored()) {
        expect(Object.keys(record).sort()).toEqual([...permitted].sort());
      }
    });

    it('never persists request content, even when a caller supplies it', async () => {
      const forbidden = ['content', 'event', 'plaintext', 'ciphertext', 'invoice', 'privkey'];
      await enqueueRequest({
        ...baseInput,
        // A future caller adding a field must not be able to leak it into storage.
        ...({ content: 'secret note', plaintext: 'do not store me' } as unknown as object),
      });

      for (const record of readStored()) {
        for (const field of forbidden) {
          expect(Object.keys(record)).not.toContain(field);
        }
      }
      // The values must not survive either, whatever key they arrived under.
      const serialized = JSON.stringify(readStored());
      expect(serialized).not.toContain('secret note');
      expect(serialized).not.toContain('do not store me');
    });

    it('drops resolved records so the session store does not grow without bound', async () => {
      const { record } = await enqueueRequest(baseInput);
      await submitDecision(record.id, { approved: true, duration: 'once' });
      await pruneResolvedRequests();

      expect(readStored()).toHaveLength(0);
    });
  });
});
