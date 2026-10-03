/**
 * The approval decision for a site-initiated request.
 *
 * Extracted from `background.ts` unchanged (#173). It was the security logic in a file nothing could
 * import — the module registers listeners and calls `initialize()` at load — so none of it was
 * reachable from a test, and the coverage report skipped the file entirely rather than reporting it
 * as uncovered.
 *
 * What it decides, in order:
 *
 * 1. which account acts for the origin, because that is the account a grant belongs to (#116)
 * 2. whether an existing grant already answers, short-circuiting without asking the user
 * 3. otherwise, enqueue for the panel and wait for a terminal outcome
 * 4. on approval with a remembered duration, write the grant against the acting account
 * 5. log the outcome on the terminal transition, so a rejection is never recorded as an approval
 */

import { LogLevel, logService } from 'src/services/log-service';
import { checkPermission, grantPermission } from '../handlers/permission-handler';
import { enqueueRequest } from './request-queue';
import { originHostname } from './origin';
import { getActiveAccount, resolveSigningAccount } from './signing-account';
import type { ApprovalDuration, UnsignedEvent } from '../types/background';

export interface ApprovalRequestDetails {
  requestType: string;
  contentDescription?: string;
  allowRemember?: boolean;
  skipPermissionCheck?: boolean;
  /** Full unsigned event, for `sign_event`. Held in memory only, never persisted (D6). */
  event?: UnsignedEvent;
  /** Counterparty for encryption and decryption requests. Never the plaintext. */
  counterpartyPubkey?: string;
}

export const trimApprovalContentDescription = (content?: string): string | undefined => {
  const normalized = content?.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
};

/**
 * `-1` at the call sites means "this request carries no event kind", never "any kind". The grant
 * store no longer conflates the two, so it is translated to null on the way in (#136).
 */
export const toPermissionKind = (eventKind: number): number | null =>
  eventKind < 0 ? null : eventKind;

export async function requestApproval(
  origin: string,
  eventKind: number,
  details: ApprovalRequestDetails,
): Promise<boolean> {
  const permissionKind = toPermissionKind(eventKind);

  // The account that will act for this site, which is the one a grant belongs to. Resolved before
  // the permission check so a grant given to one identity cannot answer for another (#116).
  const resolved = await resolveSigningAccount(origin);
  const actingAccount = 'account' in resolved ? resolved.account : null;

  if (!details.skipPermissionCheck && actingAccount) {
    const permission = await checkPermission(
      origin,
      actingAccount.id,
      details.requestType,
      permissionKind,
    );
    if (permission.granted) return true;
  }

  // The site keeps the account it connected with; the prompt says so when that is not the active
  // one, rather than letting the user approve thinking it is (diogel-io/workspace#23).
  const activeAccount = actingAccount ? await getActiveAccount() : null;

  const { record, decision } = await enqueueRequest(
    {
      origin,
      requestType: details.requestType,
      eventKind,
      accountAlias: actingAccount?.alias ?? null,
      // The identity the user is deciding for, shown on the approval and recorded on the grant.
      accountPubkey: actingAccount?.id ?? null,
      activeAccountAlias: activeAccount?.alias ?? null,
      activeAccountPubkey: activeAccount?.id ?? null,
    },
    {
      // Reviewable detail stays in worker memory for the life of the request.
      ...(details.contentDescription !== undefined
        ? { contentDescription: details.contentDescription }
        : {}),
      ...(details.event !== undefined ? { event: details.event } : {}),
      ...(details.counterpartyPubkey !== undefined
        ? { counterpartyPubkey: details.counterpartyPubkey }
        : {}),
      allowRemember: details.allowRemember !== false,
    },
  );

  // A locked vault no longer opens its own window: the panel presents the unlock view with the
  // waiting request, and unlocking still requires an explicit decision afterwards (ADR D14).
  const outcome = await decision;

  const approved = outcome.approved;
  const durationLabel: ApprovalDuration = outcome.duration;

  if (
    approved &&
    durationLabel !== 'once' &&
    details.allowRemember !== false &&
    !details.skipPermissionCheck
  ) {
    try {
      await grantPermission(
        origin,
        record.accountPubkey ?? '',
        details.requestType,
        permissionKind,
        durationLabel,
      );
    } catch (error: unknown) {
      logService.log(LogLevel.ERROR, '[BEX] Failed to grant permission', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Logged on the terminal transition rather than when the site asked, so a rejection is not
  // recorded as an approval.
  void logService.logApproval(
    eventKind === -1 ? details.requestType : eventKind,
    originHostname(origin),
    record.accountAlias,
    approved ? 'approved' : 'rejected',
  );

  return approved;
}
