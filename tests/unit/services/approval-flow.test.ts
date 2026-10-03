import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkPermission: vi.fn(),
  grantPermission: vi.fn(),
  enqueueRequest: vi.fn(),
  resolveSigningAccount: vi.fn(),
  getActiveAccount: vi.fn(),
  log: vi.fn(),
  logApproval: vi.fn(),
}));

vi.mock('app/src-bex/handlers/permission-handler', () => ({
  checkPermission: mocks.checkPermission,
  grantPermission: mocks.grantPermission,
}));
vi.mock('app/src-bex/services/request-queue', () => ({ enqueueRequest: mocks.enqueueRequest }));
vi.mock('app/src-bex/services/signing-account', () => ({
  resolveSigningAccount: mocks.resolveSigningAccount,
  getActiveAccount: mocks.getActiveAccount,
}));
vi.mock('src/services/log-service', () => ({
  LogLevel: { ERROR: 'error' },
  logService: { log: mocks.log, logApproval: mocks.logApproval },
}));

import {
  requestApproval,
  toPermissionKind,
  trimApprovalContentDescription,
} from 'app/src-bex/services/approval-flow';

const ALICE = { id: 'a'.repeat(64), alias: 'alice', account: { privkey: '11'.repeat(32) } };
const BOB = { id: 'b'.repeat(64), alias: 'bob', account: { privkey: '22'.repeat(32) } };
const ORIGIN = 'https://example.com';

/** Enqueue returns the stored record plus a promise that settles on the user's decision. */
const enqueueResolving = (
  outcome: { approved: boolean; duration: 'once' | '8h' | 'always' },
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
      mocks.resolveSigningAccount.mockResolvedValue({ error: 'Vault is locked', code: 'VLT_LOCKED' });

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

      await requestApproval(ORIGIN, 1, { requestType: 'send_zap', allowRemember: false });

      // Payments are one-time whatever else is true (D11).
      expect(mocks.grantPermission).not.toHaveBeenCalled();
    });

    it('writes nothing when the permission check was skipped', async () => {
      enqueueResolving({ approved: true, duration: 'always' });

      await requestApproval(ORIGIN, 1, { requestType: 'sign_event', skipPermissionCheck: true });

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
