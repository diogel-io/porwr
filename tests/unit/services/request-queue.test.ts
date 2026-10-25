import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  assignAccountsToWaitingRequests,
  clearNoticeWhenNoPanel,
  dismissNotice,
  enqueueRequest,
  getCurrentRequest,
  getPendingCount,
  getRequestRecord,
  listPendingRequests,
  markPresented,
  pruneResolvedRequests,
  reconcileInterruptedRequests,
  requeuePresented,
  submitDecision,
  interruptRequest,
  interruptRequestsForAccount,
  interruptRequestsForOrigin,
  onQueueChange,
  __resetLiveCallbacksForTests,
} from '@/../src-bex/services/request-queue';
import {
  MAX_PENDING_PER_ORIGIN,
  MAX_PENDING_TOTAL,
  QUEUE_FULL_MESSAGE,
  RequestQueueFullError,
} from '@/../src-bex/services/request-limits';
import { storageService } from '@/services/storage-service';
import {
  REQUEST_EXPIRY_MINUTES,
  REQUEST_NOTICE_KEY,
  REQUEST_QUEUE_KEY,
} from '@/services/storage-service';
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
      remove: vi.fn((key: string) => {
        store.delete(key);
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
      await enqueueRequest(
        { ...baseInput, origin: 'https://a.example' },
        { allowRemember: true },
        now,
      );
      await enqueueRequest(
        { ...baseInput, origin: 'https://b.example' },
        { allowRemember: true },
        now + 10,
      );

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

  // The panel offers only the durations a request's risk class allows. The background enforces it
  // too, since the panel is untrusted for lifecycle purposes (D1, D11, D12, #139).
  describe('durations the risk class does not allow', () => {
    const decide = async (
      input: Partial<typeof baseInput>,
      duration: 'once' | '8h' | 'always',
      allowRemember = true,
    ) => {
      const { record, decision } = await enqueueRequest(
        { ...baseInput, ...input },
        { allowRemember },
      );
      const result = await submitDecision(record.id, { approved: true, duration });
      return { record, decision, result };
    };

    it.each([
      ['an elevated kind', { eventKind: 9734 }, 'always'],
      ['an unknown kind', { eventKind: 31_999 }, '8h'],
      ['a payment', { requestType: 'webln_send_payment', eventKind: -1 }, '8h'],
      ['a decrypt request', { requestType: 'nip44_decrypt', eventKind: -1 }, 'always'],
    ] as const)('refuses %s granted %s', async (_label, input, duration) => {
      const { record, result } = await decide(input, duration);

      expect(result).toEqual({ applied: false, reason: 'duration-not-allowed' });
      expect((await getRequestRecord(record.id))?.state).toBe('queued');
    });

    it('refuses any remembered duration when the request may not be remembered', async () => {
      const { result } = await decide({}, 'always', false);

      expect(result).toEqual({ applied: false, reason: 'duration-not-allowed' });
    });

    it('leaves the request open, so the user can still decide it properly', async () => {
      const { record, decision } = await decide({ eventKind: 9734 }, 'always');

      const retry = await submitDecision(record.id, { approved: true, duration: '8h' });

      expect(retry.applied).toBe(true);
      await expect(decision).resolves.toEqual({ approved: true, duration: '8h' });
    });

    it('accepts every duration a standard kind allows', async () => {
      const { result } = await decide({ eventKind: 1 }, 'always');

      expect(result.applied).toBe(true);
    });

    it('lets a rejection through whatever duration it names', async () => {
      const { record } = await enqueueRequest({ ...baseInput, eventKind: 9734 });

      const result = await submitDecision(record.id, { approved: false, duration: 'always' });

      expect(result.applied).toBe(true);
    });
  });

  describe('interrupting the requests of a removed account (#139)', () => {
    it('interrupts only requests that act for that account', async () => {
      const alice = await enqueueRequest({ ...baseInput, accountPubkey: 'a'.repeat(64) });
      const bob = await enqueueRequest({ ...baseInput, accountPubkey: 'b'.repeat(64) });

      await interruptRequestsForAccount('a'.repeat(64));

      expect((await getRequestRecord(alice.record.id))?.state).toBe('interrupted');
      expect((await getRequestRecord(bob.record.id))?.state).toBe('queued');
    });
  });

  describe('interrupting one request (#139)', () => {
    it('interrupts only the named request, leaving another from the same origin live', async () => {
      const first = await enqueueRequest(baseInput);
      const second = await enqueueRequest(baseInput);

      await interruptRequest(first.record.id);

      await expect(first.decision).resolves.toEqual(
        expect.objectContaining({ approved: false, ending: 'interrupted' }),
      );
      expect((await getRequestRecord(first.record.id))?.state).toBe('interrupted');
      expect((await getRequestRecord(second.record.id))?.state).toBe('queued');
      await expect(
        submitDecision(first.record.id, { approved: true, duration: 'once' }),
      ).resolves.toEqual({ applied: false, reason: 'already-resolved' });
    });
  });

  // Two panels deciding at once both used to pass the terminal-state check before either wrote
  // (#139). Only the first may apply, and the stored state must match the outcome.
  describe('concurrent decisions', () => {
    it('applies exactly one of two opposite decisions started together', async () => {
      const { record, decision } = await enqueueRequest(baseInput);

      const [approve, reject] = await Promise.all([
        submitDecision(record.id, { approved: true, duration: 'once' }),
        submitDecision(record.id, { approved: false, duration: 'once' }),
      ]);

      expect([approve.applied, reject.applied]).toEqual([true, false]);
      expect(reject).toEqual({ applied: false, reason: 'already-resolved' });
      await expect(decision).resolves.toEqual(expect.objectContaining({ approved: true }));
      expect((await getRequestRecord(record.id))?.state).toBe('approved');
    });

    it('frees the request once a refused decision returns', async () => {
      const { record } = await enqueueRequest({ ...baseInput, eventKind: 9734 });

      await submitDecision(record.id, { approved: true, duration: 'always' });
      const next = await submitDecision(record.id, { approved: false, duration: 'once' });

      expect(next.applied).toBe(true);
    });
  });

  describe('expiry', () => {
    it('settles a waiting request it expires as expired, not as a rejection (workspace#37)', async () => {
      const now = 1_000_000;
      const { decision } = await enqueueRequest(baseInput, { allowRemember: true }, now);

      await listPendingRequests(now + 11 * 60 * 1000);

      await expect(decision).resolves.toEqual({
        approved: false,
        duration: 'once',
        ending: 'expired',
      });
    });

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

  describe('choosing another request (porwr#334)', () => {
    const now = 1_000_000;

    const enqueueTwo = async () => {
      const { record: first } = await enqueueRequest(baseInput, { allowRemember: true }, now);
      const { record: second } = await enqueueRequest(
        { ...baseInput, origin: 'https://other.example' },
        { allowRemember: true },
        now + 60_000,
      );
      return { first, second };
    };

    it('makes the chosen request current and returns the other to the queue', async () => {
      const { first, second } = await enqueueTwo();
      await markPresented(first.id, now + 60_000);

      await markPresented(second.id, now + 60_000);

      expect(readStored().find((item) => item.id === first.id)?.state).toBe('queued');
      expect(readStored().find((item) => item.id === second.id)?.state).toBe('presented');
      expect(await getCurrentRequest(now + 60_000)).toMatchObject({ id: second.id });
    });

    it('moves neither expiry', async () => {
      const { first, second } = await enqueueTwo();
      await markPresented(first.id, now + 60_000);
      await markPresented(second.id, now + 60_000);

      expect(readStored().find((item) => item.id === first.id)?.expiresAt).toBe(first.expiresAt);
      expect(readStored().find((item) => item.id === second.id)?.expiresAt).toBe(second.expiresAt);
    });

    it('raises no notice for the request moved away from when it expires', async () => {
      const { first, second } = await enqueueTwo();
      await markPresented(first.id, now + 60_000);
      await markPresented(second.id, now + 60_000);

      // The first has expired; the second, created a minute later, has not.
      const current = await getCurrentRequest(first.expiresAt + 1);

      expect(current).toMatchObject({ id: second.id, state: 'presented' });
    });

    it('still refuses a terminal request and leaves the presented one alone', async () => {
      const { first, second } = await enqueueTwo();
      await markPresented(first.id, now + 60_000);
      await submitDecision(second.id, { approved: false, duration: 'once' }, now + 60_000);

      expect(await markPresented(second.id, now + 60_000)).toBeNull();
      expect(readStored().find((item) => item.id === first.id)?.state).toBe('presented');
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

      // Fail closed: the page is gone, so the request is refused, not approved. The ending says why,
      // so the approval log does not record it as the user's rejection (workspace#37).
      await expect(decision).resolves.toEqual({
        approved: false,
        duration: 'once',
        ending: 'interrupted',
      });
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

  describe('expired and interrupted notice (S13, S14)', () => {
    const now = 1_000_000;
    const later = now + 11 * 60 * 1000;

    it('holds an expired presented request as the current one, ahead of anything waiting', async () => {
      const { record } = await enqueueRequest(baseInput, { allowRemember: true }, now);
      await markPresented(record.id, now);
      // Created after the first, so it is still waiting when the first expires.
      const { record: next } = await enqueueRequest(baseInput, { allowRemember: true }, later - 1);

      const current = await getCurrentRequest(later);

      expect(current).toMatchObject({ id: record.id, state: 'expired' });
      // Nothing behind the notice is presented until it is dismissed.
      expect(readStored().find((item) => item.id === next.id)?.state).toBe('queued');
    });

    it('never counts the notice as pending, so the badge drops at once', async () => {
      const { record } = await enqueueRequest(baseInput, { allowRemember: true }, now);
      await markPresented(record.id, now);

      expect(await getPendingCount(later)).toBe(0);
      expect(await listPendingRequests(later)).toHaveLength(0);
      expect(await getCurrentRequest(later)).toMatchObject({ id: record.id });
    });

    it('raises no notice for a request that expired while only queued', async () => {
      await enqueueRequest(baseInput, { allowRemember: true }, now);

      expect(await getCurrentRequest(later)).toBeNull();
    });

    it('holds an interrupted presented request when its page goes', async () => {
      const { record } = await enqueueRequest(baseInput);
      await markPresented(record.id);

      await interruptRequestsForOrigin('https://example.com');

      expect(await getCurrentRequest()).toMatchObject({ id: record.id, state: 'interrupted' });
    });

    it('holds the presented request a worker restart interrupted, through the startup prune', async () => {
      const { record } = await enqueueRequest(baseInput);
      await markPresented(record.id);
      __resetLiveCallbacksForTests();

      // The order the background runs them in at startup.
      await reconcileInterruptedRequests();
      await pruneResolvedRequests();

      expect(await getCurrentRequest()).toMatchObject({ id: record.id, state: 'interrupted' });
    });

    it('is still refused if a stale panel tries to approve it', async () => {
      const { record } = await enqueueRequest(baseInput, { allowRemember: true }, now);
      await markPresented(record.id, now);
      await getCurrentRequest(later);

      const result = await submitDecision(record.id, { approved: true, duration: 'once' }, later);
      expect(result).toEqual({ applied: false, reason: 'expired' });
    });

    it('moves on to the next request once dismissed', async () => {
      const { record } = await enqueueRequest(baseInput, { allowRemember: true }, now);
      await markPresented(record.id, now);
      const { record: next } = await enqueueRequest(baseInput, { allowRemember: true }, later - 1);
      await getCurrentRequest(later);

      expect(await dismissNotice(record.id, later)).toBe(true);

      expect(await getCurrentRequest(later)).toMatchObject({ id: next.id });
      expect(readStored().some((item) => item.id === record.id)).toBe(false);
    });

    it('notifies the panels when dismissed, so every window clears it (S9)', async () => {
      const { record } = await enqueueRequest(baseInput);
      await markPresented(record.id);
      await interruptRequestsForOrigin('https://example.com');
      const listener = vi.fn();
      onQueueChange(listener);

      await dismissNotice(record.id);

      expect(listener).toHaveBeenCalled();
    });

    it('refuses to dismiss any other id', async () => {
      const { record } = await enqueueRequest(baseInput);
      await markPresented(record.id);
      await interruptRequestsForOrigin('https://example.com');

      expect(await dismissNotice('not-the-notice')).toBe(false);
      expect(await getCurrentRequest()).toMatchObject({ id: record.id });
    });

    it('clears the notice when no panel is left to show it (S11)', async () => {
      const { record } = await enqueueRequest(baseInput);
      await markPresented(record.id);
      await interruptRequestsForOrigin('https://example.com');

      await clearNoticeWhenNoPanel();

      expect(await getCurrentRequest()).toBeNull();
    });

    it('stores the notice as an id, never as request content (D6)', async () => {
      const { record } = await enqueueRequest(baseInput, {
        allowRemember: true,
        ...({ plaintext: 'do not store me' } as object),
      });
      await markPresented(record.id);
      await interruptRequestsForOrigin('https://example.com');

      expect(store.get(REQUEST_NOTICE_KEY)).toBe(record.id);
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

  describe('naming the account after unlock (porwr#320)', () => {
    const locked = { ...baseInput, accountAlias: null, accountPubkey: null };
    const ALICE = {
      accountAlias: 'alice',
      accountPubkey: 'a'.repeat(64),
      activeAccountAlias: 'alice',
      activeAccountPubkey: 'a'.repeat(64),
    };

    it('names the account on a request queued without one', async () => {
      const { record } = await enqueueRequest(locked);

      const named = await assignAccountsToWaitingRequests(() => Promise.resolve(ALICE));

      expect(named.map((item) => item.id)).toEqual([record.id]);
      expect(await getRequestRecord(record.id)).toEqual(expect.objectContaining(ALICE));
      expect(readStored()[0]).toEqual(expect.objectContaining(ALICE));
    });

    it('leaves a request that already names an account alone', async () => {
      const bound = { ...baseInput, accountAlias: 'bob', accountPubkey: 'b'.repeat(64) };
      const { record } = await enqueueRequest(bound);
      const resolve = vi.fn(() => Promise.resolve(ALICE));

      await assignAccountsToWaitingRequests(resolve);

      expect(resolve).not.toHaveBeenCalled();
      expect((await getRequestRecord(record.id))?.accountAlias).toBe('bob');
    });

    it('leaves a decided request alone', async () => {
      const { record } = await enqueueRequest(locked);
      await submitDecision(record.id, { approved: false, duration: 'once' });

      await assignAccountsToWaitingRequests(() => Promise.resolve(ALICE));

      expect((await getRequestRecord(record.id))?.accountPubkey).toBeNull();
    });

    it('leaves the request without an account when none can be resolved', async () => {
      const { record } = await enqueueRequest(locked);

      const named = await assignAccountsToWaitingRequests(() => Promise.resolve(null));

      expect(named).toEqual([]);
      expect((await getRequestRecord(record.id))?.accountPubkey).toBeNull();
    });

    it('resolves each origin once', async () => {
      await enqueueRequest(locked);
      await enqueueRequest(locked);
      const resolve = vi.fn(() => Promise.resolve(ALICE));

      const named = await assignAccountsToWaitingRequests(resolve);

      expect(resolve).toHaveBeenCalledTimes(1);
      expect(named).toHaveLength(2);
    });

    it('keeps a request enqueued while the account was being resolved', async () => {
      await enqueueRequest(locked);
      let arrived: string | undefined;

      await assignAccountsToWaitingRequests(async () => {
        arrived = (await enqueueRequest({ ...locked, origin: 'https://late.example' })).record.id;
        return ALICE;
      });

      expect(readStored().map((item) => item.id)).toContain(arrived);
    });

    it('tells the panel to re-read', async () => {
      await enqueueRequest(locked);
      const listener = vi.fn();
      const stop = onQueueChange(listener);

      await assignAccountsToWaitingRequests(() => Promise.resolve(ALICE));
      stop();

      expect(listener).toHaveBeenCalled();
    });

    // Unlocking only fills in who the site acts as. The request still needs an explicit decision
    // (D14, threat model T8, #144).
    it('never approves or settles the request it names', async () => {
      const { record, decision } = await enqueueRequest(locked);
      let settled = false;
      void decision.then(() => {
        settled = true;
      });

      await assignAccountsToWaitingRequests(() => Promise.resolve(ALICE));
      await Promise.resolve();

      expect(settled).toBe(false);
      expect((await getRequestRecord(record.id))?.state).toBe(record.state);
      expect(await getPendingCount()).toBe(1);

      await submitDecision(record.id, { approved: false, duration: 'once' });
      await expect(decision).resolves.toEqual(expect.objectContaining({ approved: false }));
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

  describe('queue caps (D18, #372)', () => {
    const fill = (origin: string, count: number, now?: number) =>
      Promise.all(
        Array.from({ length: count }, () =>
          enqueueRequest({ ...baseInput, origin }, { allowRemember: true }, now),
        ),
      );

    it('refuses a request beyond the per-origin cap, and another origin still queues', async () => {
      await fill('https://flood.example', MAX_PENDING_PER_ORIGIN);

      const refused = enqueueRequest({ ...baseInput, origin: 'https://flood.example' });
      await expect(refused).rejects.toBeInstanceOf(RequestQueueFullError);
      await expect(refused).rejects.toMatchObject({ scope: 'origin', message: QUEUE_FULL_MESSAGE });

      await expect(
        enqueueRequest({ ...baseInput, origin: 'https://legit.example' }),
      ).resolves.toBeDefined();
      expect(await getPendingCount()).toBe(MAX_PENDING_PER_ORIGIN + 1);
    });

    it('refuses a request beyond the global cap with the same message', async () => {
      const origins = Math.ceil(MAX_PENDING_TOTAL / MAX_PENDING_PER_ORIGIN);
      for (let index = 0; index < origins; index += 1) {
        await fill(`https://site-${index}.example`, MAX_PENDING_PER_ORIGIN);
      }
      expect(await getPendingCount()).toBe(MAX_PENDING_TOTAL);

      const refused = enqueueRequest({ ...baseInput, origin: 'https://new.example' });
      await expect(refused).rejects.toMatchObject({ scope: 'global', message: QUEUE_FULL_MESSAGE });
    });

    it('holds the cap against a parallel burst', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: MAX_PENDING_PER_ORIGIN * 4 }, () =>
          enqueueRequest({ ...baseInput, origin: 'https://flood.example' }),
        ),
      );

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(
        MAX_PENDING_PER_ORIGIN,
      );
      expect(readStored()).toHaveLength(MAX_PENDING_PER_ORIGIN);
    });

    it('stores nothing for a refused request', async () => {
      await fill('https://flood.example', MAX_PENDING_PER_ORIGIN);
      const before = JSON.stringify(readStored());

      await expect(
        enqueueRequest(
          { ...baseInput, origin: 'https://flood.example' },
          { allowRemember: true, contentDescription: 'refused secret' },
        ),
      ).rejects.toBeInstanceOf(RequestQueueFullError);

      expect(JSON.stringify(readStored())).toBe(before);
      expect(JSON.stringify(readStored())).not.toContain('refused secret');
    });

    it('frees a slot when a request is decided', async () => {
      const [first] = await fill('https://flood.example', MAX_PENDING_PER_ORIGIN);
      await submitDecision(first!.record.id, { approved: false, duration: 'once' });

      await expect(
        enqueueRequest({ ...baseInput, origin: 'https://flood.example' }),
      ).resolves.toBeDefined();
    });

    it('frees slots held by requests that have expired', async () => {
      const now = 1_000_000;
      await fill('https://flood.example', MAX_PENDING_PER_ORIGIN, now);

      const later = now + 60 * 60 * 1000;
      await expect(
        enqueueRequest({ ...baseInput, origin: 'https://flood.example' }, undefined, later),
      ).resolves.toBeDefined();
      expect(await getPendingCount(later)).toBe(1);
    });

    it('frees a slot when its page goes away', async () => {
      const [first] = await fill('https://flood.example', MAX_PENDING_PER_ORIGIN);
      await interruptRequest(first!.record.id);

      await expect(
        enqueueRequest({ ...baseInput, origin: 'https://flood.example' }),
      ).resolves.toBeDefined();
    });

    it('frees every slot for an origin whose last tab closed', async () => {
      await fill('https://flood.example', MAX_PENDING_PER_ORIGIN);
      await interruptRequestsForOrigin('https://flood.example');

      await expect(fill('https://flood.example', MAX_PENDING_PER_ORIGIN)).resolves.toHaveLength(
        MAX_PENDING_PER_ORIGIN,
      );
    });

    it('frees the slot of a request whose write failed', async () => {
      await fill('https://flood.example', MAX_PENDING_PER_ORIGIN - 1);
      vi.mocked(storageService.set).mockRejectedValueOnce(new Error('quota'));

      await expect(
        enqueueRequest({ ...baseInput, origin: 'https://flood.example' }),
      ).rejects.toThrow('quota');
      await expect(
        enqueueRequest({ ...baseInput, origin: 'https://flood.example' }),
      ).resolves.toBeDefined();
    });
  });
});
