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
  interruptRequest: vi.fn(),
  log: vi.fn(),
  logApproval: vi.fn(),
  isVaultUnlocked: vi.fn(),
}));

vi.mock('@/../src-bex/handlers/permission-handler', () => ({
  checkPermission: mocks.checkPermission,
  grantPermission: mocks.grantPermission,
}));
vi.mock('@/../src-bex/services/request-queue', () => ({
  enqueueRequest: mocks.enqueueRequest,
  getRequestRecord: mocks.getRequestRecord,
  assignAccountsToWaitingRequests: mocks.assignAccountsToWaitingRequests,
  interruptRequest: mocks.interruptRequest,
}));
vi.mock('@/../src-bex/services/signing-account', () => ({
  resolveSigningAccount: mocks.resolveSigningAccount,
  getActiveAccount: mocks.getActiveAccount,
  bindSiteToAccount: mocks.bindSiteToAccount,
}));
vi.mock('@/../src-bex/vault', () => ({ isVaultUnlocked: mocks.isVaultUnlocked }));
vi.mock('@/services/log-service', () => ({
  LogLevel: { ERROR: 'error' },
  logService: { log: mocks.log, logApproval: mocks.logApproval },
}));

import { RequestQueueFullError } from '@/../src-bex/services/request-limits';
import {
  identifyWaitingRequests,
  nameWaitingRequests,
  requestApprovalDecision,
  toPermissionKind,
  trimApprovalContentDescription,
} from '@/../src-bex/services/approval-flow';

const ALICE = { id: 'a'.repeat(64), alias: 'alice', account: { privkey: '11'.repeat(32) } };
const BOB = { id: 'b'.repeat(64), alias: 'bob', account: { privkey: '22'.repeat(32) } };
const ORIGIN = 'https://example.com';

/** Whether the request was approved, for the many tests that ask only that. */
const requestApproval = async (
  ...args: Parameters<typeof requestApprovalDecision>
): Promise<boolean> => (await requestApprovalDecision(...args)).approved;

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
  mocks.isVaultUnlocked.mockReturnValue(true);
  mocks.getActiveAccount.mockResolvedValue(ALICE);
  mocks.checkPermission.mockResolvedValue({ granted: false });
  mocks.grantPermission.mockResolvedValue(undefined);
  enqueueResolving({ approved: true, duration: 'once' });
  // By default the record is unchanged between enqueueing and deciding.
  mocks.getRequestRecord.mockResolvedValue(null);
  mocks.assignAccountsToWaitingRequests.mockResolvedValue([]);
  // The site ends up bound to the account it was bound for, unless a test says otherwise.
  mocks.bindSiteToAccount.mockImplementation((_origin: string, pubkey: string) =>
    Promise.resolve(pubkey),
  );
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

      // Before #320 this wrote a grant against an empty pubkey. It is now no approval at all: there
      // is no account to carry it out as (diogel-io/workspace#227).
      await expect(requestApproval(ORIGIN, 1, { requestType: 'sign_event' })).resolves.toBe(false);
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

// A request is interrupted when the page that sent it goes, even while another tab holds the same
// origin (#139).
describe('the requesting page going away', () => {
  it('interrupts the request when the page signal aborts while it waits', async () => {
    const page = new AbortController();
    let settle: (outcome: unknown) => void = () => undefined;
    mocks.enqueueRequest.mockResolvedValue({
      record: { id: 'req-1', accountAlias: 'alice', accountPubkey: ALICE.id },
      decision: new Promise((resolve) => (settle = resolve)),
    });
    mocks.interruptRequest.mockImplementation(() => {
      settle({ approved: false, duration: 'once', ending: 'interrupted' });
      return Promise.resolve([]);
    });

    const pending = requestApproval(ORIGIN, 1, { requestType: 'sign_event', signal: page.signal });
    await vi.waitFor(() => expect(mocks.enqueueRequest).toHaveBeenCalled());
    page.abort();

    await expect(pending).resolves.toBe(false);
    expect(mocks.interruptRequest).toHaveBeenCalledWith('req-1');
    expect(mocks.bindSiteToAccount).not.toHaveBeenCalled();
  });

  it('interrupts at once a request whose page had already gone', async () => {
    const page = new AbortController();
    page.abort();

    await requestApproval(ORIGIN, 1, { requestType: 'sign_event', signal: page.signal });

    expect(mocks.interruptRequest).toHaveBeenCalledWith('req-1');
  });

  it('leaves a decided request alone when its page goes afterwards', async () => {
    const page = new AbortController();

    await requestApproval(ORIGIN, 1, { requestType: 'sign_event', signal: page.signal });
    page.abort();

    expect(mocks.interruptRequest).not.toHaveBeenCalled();
  });
});

// Two requests from an unbound site, queued around an account switch: the first approval binds the
// site, and the second, approved for the other account, must not act as the bound one (#139).
describe('an approval for an account the site is no longer bound to', () => {
  it('is refused, and writes no grant', async () => {
    enqueueResolving({ approved: true, duration: 'always' }, BOB.id);
    mocks.getRequestRecord.mockResolvedValue({
      id: 'req-1',
      accountAlias: 'bob',
      accountPubkey: BOB.id,
    });
    mocks.bindSiteToAccount.mockResolvedValue(ALICE.id);

    await expect(requestApproval(ORIGIN, 1, { requestType: 'sign_event' })).resolves.toBe(false);
    expect(mocks.grantPermission).not.toHaveBeenCalled();
    expect(mocks.logApproval).toHaveBeenCalledWith(1, 'example.com', 'bob', 'rejected');
  });

  it('does not let a grant for another account answer', async () => {
    mocks.checkPermission.mockResolvedValue({ granted: true });
    mocks.bindSiteToAccount.mockResolvedValue(BOB.id);

    await expect(requestApproval(ORIGIN, 1, { requestType: 'sign_event' })).resolves.toBe(false);
  });
});

describe('a full queue (D18, #372)', () => {
  it('refuses the request with nothing granted, bound, or logged as an approval', async () => {
    mocks.enqueueRequest.mockRejectedValue(new RequestQueueFullError('origin'));

    await expect(requestApproval(ORIGIN, 1, { requestType: 'sign_event' })).rejects.toBeInstanceOf(
      RequestQueueFullError,
    );

    expect(mocks.grantPermission).not.toHaveBeenCalled();
    expect(mocks.bindSiteToAccount).not.toHaveBeenCalled();
    expect(mocks.logApproval).not.toHaveBeenCalled();
  });
});

describe('the decision with its duration (porwr#369)', () => {
  it('reports the duration the user chose', async () => {
    enqueueResolving({ approved: true, duration: '8h' });

    await expect(
      requestApprovalDecision(ORIGIN, -1, {
        requestType: 'webln_enable',
        skipPermissionCheck: true,
      }),
    ).resolves.toEqual({ approved: true, duration: '8h', accountPubkey: ALICE.id });
  });

  it('reports "once" for a refusal, whatever was selected', async () => {
    enqueueResolving({ approved: false, duration: 'always' });

    await expect(
      requestApprovalDecision(ORIGIN, -1, {
        requestType: 'webln_enable',
        skipPermissionCheck: true,
      }),
    ).resolves.toEqual({ approved: false, duration: 'once', accountPubkey: null });
  });

  it('reports "once" for a request an earlier grant answered, since nobody was asked', async () => {
    mocks.checkPermission.mockResolvedValue({ granted: true });

    await expect(
      requestApprovalDecision(ORIGIN, 1, { requestType: 'sign_event' }),
    ).resolves.toEqual({ approved: true, duration: 'once', accountPubkey: ALICE.id });
  });
});

describe('the account an approval is carried out as (diogel-io/workspace#227)', () => {
  it('is the account named on the decided request', async () => {
    enqueueResolving({ approved: true, duration: 'once' });

    const outcome = await requestApprovalDecision(ORIGIN, 1, { requestType: 'sign_event' });

    expect(outcome).toEqual({ approved: true, duration: 'once', accountPubkey: ALICE.id });
  });

  it('is the account a request named on unlock was given, not the one it was queued with', async () => {
    mocks.resolveSigningAccount.mockResolvedValueOnce({ error: 'Vault is locked', code: 'x' });
    mocks.isVaultUnlocked.mockReturnValue(false);
    enqueueResolving({ approved: true, duration: 'once' }, null);
    mocks.getRequestRecord.mockResolvedValue({
      id: 'req-1',
      accountAlias: 'bob',
      accountPubkey: BOB.id,
    });

    const outcome = await requestApprovalDecision(ORIGIN, 1, { requestType: 'sign_event' });

    expect(outcome.accountPubkey).toBe(BOB.id);
    expect(mocks.bindSiteToAccount).toHaveBeenCalledWith(ORIGIN, BOB.id);
  });

  it('is the account an earlier grant belongs to', async () => {
    mocks.checkPermission.mockResolvedValue({ granted: true });

    const outcome = await requestApprovalDecision(ORIGIN, 1, { requestType: 'sign_event' });

    expect(outcome).toEqual({ approved: true, duration: 'once', accountPubkey: ALICE.id });
    expect(mocks.enqueueRequest).not.toHaveBeenCalled();
  });

  // An unbound site whose active account changes between the approval and the handler running:
  // the outcome still names the account the user approved.
  it('does not follow the active account after the decision', async () => {
    mocks.resolveSigningAccount.mockResolvedValueOnce({ account: ALICE });
    mocks.resolveSigningAccount.mockResolvedValue({ account: BOB });
    mocks.getActiveAccount.mockResolvedValue(BOB);

    const outcome = await requestApprovalDecision(ORIGIN, 1, { requestType: 'sign_event' });

    expect(outcome.accountPubkey).toBe(ALICE.id);
  });

  it('is null for every refusal', async () => {
    enqueueResolving({ approved: false, duration: 'once' });

    const outcome = await requestApprovalDecision(ORIGIN, 1, { requestType: 'sign_event' });

    expect(outcome.accountPubkey).toBeNull();
  });

  it('refuses an approval for a request that names no account, and binds nothing', async () => {
    mocks.resolveSigningAccount.mockResolvedValue({ error: 'No active account', code: 'x' });
    enqueueResolving({ approved: true, duration: '8h' }, null);

    const outcome = await requestApprovalDecision(ORIGIN, 1, { requestType: 'sign_event' });

    expect(outcome).toEqual({ approved: false, duration: 'once', accountPubkey: null });
    expect(mocks.bindSiteToAccount).not.toHaveBeenCalled();
    expect(mocks.grantPermission).not.toHaveBeenCalled();
    expect(mocks.logApproval).toHaveBeenCalledWith(1, 'example.com', 'alice', 'rejected');
  });
});

describe('naming a request that reached the queue after unlock (diogel-io/workspace#227)', () => {
  it('names the queue straight after a request is queued without an account', async () => {
    mocks.resolveSigningAccount.mockResolvedValueOnce({ error: 'Vault is locked', code: 'x' });
    enqueueResolving({ approved: false, duration: 'once' }, null);

    await requestApprovalDecision(ORIGIN, 1, { requestType: 'sign_event' });

    expect(mocks.assignAccountsToWaitingRequests).toHaveBeenCalledTimes(1);
  });

  it('leaves the queue alone for a request queued with its account', async () => {
    enqueueResolving({ approved: false, duration: 'once' });

    await requestApprovalDecision(ORIGIN, 1, { requestType: 'sign_event' });

    expect(mocks.assignAccountsToWaitingRequests).not.toHaveBeenCalled();
  });

  it('names nothing while the vault is locked', async () => {
    mocks.isVaultUnlocked.mockReturnValue(false);

    await nameWaitingRequests();

    expect(mocks.assignAccountsToWaitingRequests).not.toHaveBeenCalled();
  });

  it('names waiting requests once the vault is unlocked', async () => {
    await nameWaitingRequests();

    expect(mocks.assignAccountsToWaitingRequests).toHaveBeenCalledTimes(1);
  });
});

describe('a decrypt of the account own data (diogel-io/workspace#226)', () => {
  const DECRYPTS = ['nip04_decrypt', 'nip44_decrypt'] as const;

  describe.each(DECRYPTS)('%s', (requestType) => {
    it('is answered by an existing grant when the counterparty is another pubkey', async () => {
      mocks.checkPermission.mockResolvedValue({ granted: true });

      await expect(
        requestApproval(ORIGIN, -1, { requestType, counterpartyPubkey: BOB.id }),
      ).resolves.toBe(true);

      expect(mocks.checkPermission).toHaveBeenCalledWith(ORIGIN, ALICE.id, requestType, null);
      expect(mocks.enqueueRequest).not.toHaveBeenCalled();
    });

    it('is never answered by a grant when the counterparty is the acting account', async () => {
      mocks.checkPermission.mockResolvedValue({ granted: true });

      await requestApproval(ORIGIN, -1, { requestType, counterpartyPubkey: ALICE.id });

      expect(mocks.checkPermission).not.toHaveBeenCalled();
      expect(mocks.enqueueRequest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ counterpartyPubkey: ALICE.id, allowRemember: false }),
      );
    });

    it('writes no grant, even if a remembered duration comes back', async () => {
      enqueueResolving({ approved: true, duration: '8h' });

      await expect(
        requestApproval(ORIGIN, -1, { requestType, counterpartyPubkey: ALICE.id }),
      ).resolves.toBe(true);

      expect(mocks.grantPermission).not.toHaveBeenCalled();
    });

    it('asks again the next time', async () => {
      mocks.checkPermission.mockResolvedValue({ granted: true });

      await requestApproval(ORIGIN, -1, { requestType, counterpartyPubkey: ALICE.id });
      await requestApproval(ORIGIN, -1, { requestType, counterpartyPubkey: ALICE.id });

      expect(mocks.enqueueRequest).toHaveBeenCalledTimes(2);
    });

    it('is logged as its own request type', async () => {
      await requestApproval(ORIGIN, -1, { requestType, counterpartyPubkey: ALICE.id });

      expect(mocks.logApproval).toHaveBeenCalledWith(
        `${requestType}_self`,
        'example.com',
        'alice',
        'approved',
      );
    });

    it('keeps the ordinary request type in the log for another counterparty', async () => {
      await requestApproval(ORIGIN, -1, { requestType, counterpartyPubkey: BOB.id });

      expect(mocks.logApproval).toHaveBeenCalledWith(
        requestType,
        'example.com',
        'alice',
        'approved',
      );
    });

    it('writes no grant for a request named only on unlock (porwr#320)', async () => {
      mocks.resolveSigningAccount.mockResolvedValue({
        error: 'Vault is locked',
        code: 'VLT_LOCKED',
      });
      enqueueResolving({ approved: true, duration: '8h' }, null);
      mocks.getRequestRecord.mockResolvedValue({
        id: 'req-1',
        accountAlias: 'alice',
        accountPubkey: ALICE.id,
      });

      await requestApproval(ORIGIN, -1, { requestType, counterpartyPubkey: ALICE.id });

      expect(mocks.grantPermission).not.toHaveBeenCalled();
      expect(mocks.logApproval).toHaveBeenCalledWith(
        `${requestType}_self`,
        'example.com',
        'alice',
        'approved',
      );
    });
  });

  it('still remembers a grant for another counterparty', async () => {
    enqueueResolving({ approved: true, duration: '8h' });

    await requestApproval(ORIGIN, -1, { requestType: 'nip44_decrypt', counterpartyPubkey: BOB.id });

    expect(mocks.grantPermission).toHaveBeenCalledWith(
      ORIGIN,
      ALICE.id,
      'nip44_decrypt',
      null,
      '8h',
    );
  });

  it('leaves encrypt to self unchanged', async () => {
    mocks.checkPermission.mockResolvedValue({ granted: true });

    await requestApproval(ORIGIN, -1, {
      requestType: 'nip44_encrypt',
      counterpartyPubkey: ALICE.id,
    });

    expect(mocks.enqueueRequest).not.toHaveBeenCalled();
  });
});
