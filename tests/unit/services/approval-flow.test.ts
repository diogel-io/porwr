import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkPermission: vi.fn(),
  grantPermission: vi.fn(),
  enqueueRequest: vi.fn(),
  getRequestRecord: vi.fn(),
  assignAccountsToWaitingRequests: vi.fn(),
  resolveSigningAccount: vi.fn(),
  getActiveAccount: vi.fn(),
  bindSiteToAccount: vi.fn(),
  log: vi.fn(),
  logApproval: vi.fn(),
}));

vi.mock('@/../src-bex/handlers/permission-handler', () => ({
  checkPermission: mocks.checkPermission,
  grantPermission: mocks.grantPermission,
}));
vi.mock('@/../src-bex/services/request-queue', () => ({
  enqueueRequest: mocks.enqueueRequest,
  getRequestRecord: mocks.getRequestRecord,
  assignAccountsToWaitingRequests: mocks.assignAccountsToWaitingRequests,
}));
vi.mock('@/../src-bex/services/signing-account', () => ({
  resolveSigningAccount: mocks.resolveSigningAccount,
  getActiveAccount: mocks.getActiveAccount,
  bindSiteToAccount: mocks.bindSiteToAccount,
}));
vi.mock('@/services/log-service', () => ({
  LogLevel: { ERROR: 'error' },
  logService: { log: mocks.log, logApproval: mocks.logApproval },
}));

import {
  identifyWaitingRequests,
  requestApproval,
  toPermissionKind,
  trimApprovalContentDescription,
} from '@/../src-bex/services/approval-flow';

const ALICE = { id: 'a'.repeat(64), alias: 'alice', account: { privkey: '11'.repeat(32) } };
const BOB = { id: 'b'.repeat(64), alias: 'bob', account: { privkey: '22'.repeat(32) } };
const ORIGIN = 'https://example.com';

/** Enqueue returns the stored record plus a promise that settles on the user's decision. */
const enqueueResolving = (
  outcome: {
    approved: boolean;
    duration: 'once' | '8h' | 'always';
    ending?: 'expired' | 'interrupted';
  },
  accountPubkey: string | null = ALICE.id,
): void => {
  mocks.enqueueRequest.mockResolvedValue({
    record: { id: 'req-1', accountAlias: 'alice', accountPubkey },
    decision: Promise.resolve(outcome),
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveSigningAccount.mockResolvedValue({ account: ALICE });
  mocks.getActiveAccount.mockResolvedValue(ALICE);
  mocks.checkPermission.mockResolvedValue({ granted: false });
  mocks.grantPermission.mockResolvedValue(undefined);
  enqueueResolving({ approved: true, duration: 'once' });
  // By default the record is unchanged between enqueueing and deciding.
  mocks.getRequestRecord.mockResolvedValue(null);
  mocks.assignAccountsToWaitingRequests.mockResolvedValue([]);
  mocks.bindSiteToAccount.mockResolvedValue(undefined);
});

describe('deciding a site request', () => {
  describe('an existing grant', () => {
    it('answers without asking the user', async () => {
      mocks.checkPermission.mockResolvedValue({ granted: true });

      await expect(requestApproval(ORIGIN, 1, { requestType: 'sign_event' })).resolves.toBe(true);
      expect(mocks.enqueueRequest).not.toHaveBeenCalled();
    });

    it('is checked against the account that will act, not whichever is active (#116)', async () => {
      mocks.checkPermission.mockResolvedValue({ granted: true });

      await requestApproval(ORIGIN, 1, { requestType: 'sign_event' });

      expect(mocks.checkPermission).toHaveBeenCalledWith(ORIGIN, ALICE.id, 'sign_event', 1);
    });

    it('is not consulted when the caller says to skip it', async () => {
      await requestApproval(ORIGIN, 1, { requestType: 'sign_event', skipPermissionCheck: true });

      expect(mocks.checkPermission).not.toHaveBeenCalled();
      expect(mocks.enqueueRequest).toHaveBeenCalled();
    });

    it('is not consulted when no account can act, so the user is always asked', async () => {
      mocks.resolveSigningAccount.mockResolvedValue({
        error: 'Vault is locked',
        code: 'VLT_LOCKED',
      });

      await requestApproval(ORIGIN, 1, { requestType: 'sign_event' });

      expect(mocks.checkPermission).not.toHaveBeenCalled();
      expect(mocks.enqueueRequest).toHaveBeenCalled();
    });
  });

  describe('the request it enqueues', () => {
    it('carries the acting account so the panel names the identity being decided for', async () => {
      await requestApproval(ORIGIN, 1, { requestType: 'sign_event' });

      expect(mocks.enqueueRequest).toHaveBeenCalledWith(
        expect.objectContaining({ accountAlias: 'alice', accountPubkey: ALICE.id }),
        expect.anything(),
      );
    });

    it('carries the active account too, so the prompt can say the site is connected as another (workspace#23)', async () => {
      mocks.getActiveAccount.mockResolvedValue(BOB);

      await requestApproval(ORIGIN, 1, { requestType: 'sign_event' });

      expect(mocks.enqueueRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          accountAlias: 'alice',
          accountPubkey: ALICE.id,
          activeAccountAlias: 'bob',
          activeAccountPubkey: BOB.id,
        }),
        expect.anything(),
      );
    });

    it('carries no account when none can act', async () => {
      mocks.resolveSigningAccount.mockResolvedValue({ error: 'No active account', code: 'X' });

      await requestApproval(ORIGIN, 1, { requestType: 'sign_event' });

      expect(mocks.enqueueRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          accountAlias: null,
          accountPubkey: null,
          activeAccountAlias: null,
          activeAccountPubkey: null,
        }),
        expect.anything(),
      );
    });

    it('omits reviewable detail that was not supplied, rather than sending undefined', async () => {
      await requestApproval(ORIGIN, 1, { requestType: 'sign_event' });

      const [, content] = mocks.enqueueRequest.mock.calls[0] as [unknown, Record<string, unknown>];
      expect(content).toEqual({ allowRemember: true });
    });

    it('passes the event through for a signing request (D6: memory only)', async () => {
      const event = { kind: 1, content: 'hi', tags: [], created_at: 1 };

      await requestApproval(ORIGIN, 1, { requestType: 'sign_event', event: event as never });

      const [, content] = mocks.enqueueRequest.mock.calls[0] as [unknown, Record<string, unknown>];
      expect(content.event).toBe(event);
    });
  });

  describe('writing the grant', () => {
    it('writes it against the acting account when a duration is remembered', async () => {
      enqueueResolving({ approved: true, duration: '8h' });

      await requestApproval(ORIGIN, 1, { requestType: 'sign_event' });

      expect(mocks.grantPermission).toHaveBeenCalledWith(ORIGIN, ALICE.id, 'sign_event', 1, '8h');
    });

    it('writes nothing for "once"', async () => {
      enqueueResolving({ approved: true, duration: 'once' });

      await requestApproval(ORIGIN, 1, { requestType: 'sign_event' });

      expect(mocks.grantPermission).not.toHaveBeenCalled();
    });

    it('writes nothing when the request was rejected', async () => {
      enqueueResolving({ approved: false, duration: 'always' });

      await expect(requestApproval(ORIGIN, 1, { requestType: 'sign_event' })).resolves.toBe(false);
      expect(mocks.grantPermission).not.toHaveBeenCalled();
    });

    it('writes nothing when the request type may not be remembered', async () => {
      enqueueResolving({ approved: true, duration: 'always' });

      await requestApproval(ORIGIN, 1, { requestType: 'webln_send_payment', allowRemember: false });

      // Payments are one-time whatever else is true (D11).
      expect(mocks.grantPermission).not.toHaveBeenCalled();
    });

    it('writes nothing when the permission check was skipped', async () => {
      enqueueResolving({ approved: true, duration: 'always' });

      await requestApproval(ORIGIN, 1, { requestType: 'sign_event', skipPermissionCheck: true });

      expect(mocks.grantPermission).not.toHaveBeenCalled();
    });

    it('writes it against the account named on unlock, for a request queued while locked (porwr#320)', async () => {
      enqueueResolving({ approved: true, duration: '8h' }, null);
      mocks.getRequestRecord.mockResolvedValue({
        id: 'req-1',
        accountAlias: 'alice',
        accountPubkey: ALICE.id,
      });

      await requestApproval(ORIGIN, 1, { requestType: 'sign_event' });

      expect(mocks.getRequestRecord).toHaveBeenCalledWith('req-1');
      expect(mocks.grantPermission).toHaveBeenCalledWith(ORIGIN, ALICE.id, 'sign_event', 1, '8h');
    });

    it('writes nothing when the request still names no account (porwr#320)', async () => {
      enqueueResolving({ approved: true, duration: 'always' }, null);

      // Before #320 this wrote a grant against an empty pubkey.
      await expect(requestApproval(ORIGIN, 1, { requestType: 'sign_event' })).resolves.toBe(true);
      expect(mocks.grantPermission).not.toHaveBeenCalled();
    });

    it('still approves when the grant cannot be written', async () => {
      enqueueResolving({ approved: true, duration: 'always' });
      mocks.grantPermission.mockRejectedValue(new Error('storage gone'));

      // The user approved this request; failing to remember it must not retract that.
      await expect(requestApproval(ORIGIN, 1, { requestType: 'sign_event' })).resolves.toBe(true);
      expect(mocks.log).toHaveBeenCalled();
    });
  });

  describe('the approvals log', () => {
    it('records the outcome, not the asking', async () => {
      enqueueResolving({ approved: false, duration: 'once' });

      await requestApproval(ORIGIN, 1, { requestType: 'sign_event' });

      expect(mocks.logApproval).toHaveBeenCalledWith(1, 'example.com', 'alice', 'rejected');
    });

    it('writes exactly one row for a prompted request', async () => {
      await requestApproval(ORIGIN, 1, { requestType: 'sign_event' });

      expect(mocks.logApproval).toHaveBeenCalledTimes(1);
      expect(mocks.logApproval).toHaveBeenCalledWith(1, 'example.com', 'alice', 'approved');
    });

    it.each(['expired', 'interrupted'] as const)(
      'records a request that %s as that, not as a rejection (workspace#37)',
      async (ending) => {
        enqueueResolving({ approved: false, duration: 'once', ending });

        await requestApproval(ORIGIN, 1, { requestType: 'sign_event' });

        expect(mocks.logApproval).toHaveBeenCalledTimes(1);
        expect(mocks.logApproval).toHaveBeenCalledWith(1, 'example.com', 'alice', ending);
      },
    );

    it('records a request an existing grant answered as approved (workspace#37)', async () => {
      mocks.checkPermission.mockResolvedValue({ granted: true });

      await requestApproval(ORIGIN, -1, { requestType: 'get_public_key' });

      expect(mocks.logApproval).toHaveBeenCalledTimes(1);
      expect(mocks.logApproval).toHaveBeenCalledWith(
        'get_public_key',
        'example.com',
        'alice',
        'approved',
      );
    });

    it('names the account given on unlock, not the empty one it queued with (porwr#320)', async () => {
      enqueueResolving({ approved: true, duration: 'once' }, null);
      mocks.getRequestRecord.mockResolvedValue({
        id: 'req-1',
        accountAlias: 'bob',
        accountPubkey: BOB.id,
      });

      await requestApproval(ORIGIN, 1, { requestType: 'sign_event' });

      expect(mocks.logApproval).toHaveBeenCalledWith(1, 'example.com', 'bob', 'approved');
    });

    it('names the request type when there is no event kind', async () => {
      await requestApproval(ORIGIN, -1, { requestType: 'get_public_key' });

      expect(mocks.logApproval).toHaveBeenCalledWith(
        'get_public_key',
        'example.com',
        'alice',
        'approved',
      );
    });
  });
});

describe('naming the account on requests that waited out a locked vault (porwr#320)', () => {
  const resolverPassed = async (): Promise<(origin: string) => Promise<unknown>> => {
    await identifyWaitingRequests();
    return mocks.assignAccountsToWaitingRequests.mock.calls[0]![0];
  };

  it('resolves the account the site acts as, with the active account beside it', async () => {
    mocks.resolveSigningAccount.mockResolvedValue({ account: ALICE });
    mocks.getActiveAccount.mockResolvedValue(BOB);

    const resolve = await resolverPassed();

    await expect(resolve(ORIGIN)).resolves.toEqual({
      accountAlias: 'alice',
      accountPubkey: ALICE.id,
      activeAccountAlias: 'bob',
      activeAccountPubkey: BOB.id,
    });
    expect(mocks.resolveSigningAccount).toHaveBeenCalledWith(ORIGIN);
  });

  it('names nothing when no account can act', async () => {
    mocks.resolveSigningAccount.mockResolvedValue({ error: 'No active account', code: 'X' });

    const resolve = await resolverPassed();

    await expect(resolve(ORIGIN)).resolves.toBeNull();
  });
});

describe('helpers', () => {
  describe('toPermissionKind', () => {
    it('maps "no event kind" to null rather than a wildcard (#136)', () => {
      expect(toPermissionKind(-1)).toBeNull();
      expect(toPermissionKind(0)).toBe(0);
      expect(toPermissionKind(30023)).toBe(30023);
    });
  });

  describe('trimApprovalContentDescription', () => {
    it('collapses whitespace', () => {
      expect(trimApprovalContentDescription('  a\n\n b  ')).toBe('a b');
    });

    it('drops content that is only whitespace', () => {
      expect(trimApprovalContentDescription('   ')).toBeUndefined();
      expect(trimApprovalContentDescription(undefined)).toBeUndefined();
    });

    it('truncates visibly rather than silently', () => {
      const trimmed = trimApprovalContentDescription('x'.repeat(400));

      expect(trimmed).toHaveLength(240);
      expect(trimmed?.endsWith('...')).toBe(true);
    });
  });
});

// Asking is not consent: a site is bound to an account only once the user approves one of its
// requests, or a grant they gave earlier answers it (#139).
describe('binding the site to an account', () => {
  it.each([
    ['rejected', { approved: false, duration: 'once' as const }],
    ['expired', { approved: false, duration: 'once' as const, ending: 'expired' as const }],
    ['interrupted', { approved: false, duration: 'once' as const, ending: 'interrupted' as const }],
  ])('binds nothing for a request that was %s', async (_label, outcome) => {
    enqueueResolving(outcome);

    await requestApproval(ORIGIN, 1, { requestType: 'sign_event' });

    expect(mocks.bindSiteToAccount).not.toHaveBeenCalled();
  });

  it('binds the account the user approved, as recorded on the request', async () => {
    enqueueResolving({ approved: true, duration: 'once' });
    // The request was named for bob after it was enqueued (the locked-vault path, porwr#320).
    mocks.getRequestRecord.mockResolvedValue({
      id: 'req-1',
      accountAlias: 'bob',
      accountPubkey: BOB.id,
    });

    await requestApproval(ORIGIN, 1, { requestType: 'sign_event' });

    expect(mocks.bindSiteToAccount).toHaveBeenCalledWith(ORIGIN, BOB.id);
  });

  it('binds the acting account when an earlier grant answers', async () => {
    mocks.checkPermission.mockResolvedValue({ granted: true });

    await requestApproval(ORIGIN, 1, { requestType: 'sign_event' });

    expect(mocks.bindSiteToAccount).toHaveBeenCalledWith(ORIGIN, ALICE.id);
    expect(mocks.enqueueRequest).not.toHaveBeenCalled();
  });

  it('binds nothing for an approval that names no account', async () => {
    enqueueResolving({ approved: true, duration: 'once' }, null);

    await requestApproval(ORIGIN, 1, { requestType: 'sign_event' });

    expect(mocks.bindSiteToAccount).not.toHaveBeenCalled();
  });
});
