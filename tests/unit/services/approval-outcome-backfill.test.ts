import { describe, it, expect } from 'vitest';

import { backfillApprovalOutcome } from '@/services/database';
import type { ApprovalLog } from '@/services/database';

/**
 * Approval logging moved from request time to the terminal decision, so the approvals table
 * gained an outcome. Rows written before that recorded only that a site asked, and cannot be
 * told apart from approvals after the fact.
 */
describe('approval outcome backfill', () => {
  const row = (overrides: Partial<ApprovalLog> = {}): ApprovalLog => ({
    dateTime: '2026-01-01T00:00:00.000Z',
    eventKind: 1,
    hostname: 'example.com',
    account: 'alice',
    ...overrides,
  });

  it('marks a pre-migration row as unknown rather than as an approval', () => {
    const approval = row();
    backfillApprovalOutcome(approval);
    expect(approval.outcome).toBe('unknown');
  });

  it('leaves an existing outcome untouched', () => {
    for (const outcome of ['approved', 'rejected', 'expired', 'interrupted'] as const) {
      const approval = row({ outcome });
      backfillApprovalOutcome(approval);
      expect(approval.outcome).toBe(outcome);
    }
  });

  it('does not alter any other field', () => {
    const approval = row();
    const before = { ...approval };
    backfillApprovalOutcome(approval);

    expect(approval.dateTime).toBe(before.dateTime);
    expect(approval.eventKind).toBe(before.eventKind);
    expect(approval.hostname).toBe(before.hostname);
    expect(approval.account).toBe(before.account);
  });
});
