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
 * 5. log the outcome on the terminal transition, so a rejection is never recorded as an approval,
 *    and log a request a grant answered as approved
 */

import { isSelfDecrypt, selfDecryptLogType } from '@/services/approval-preview';
import { LogLevel, logService } from '@/services/log-service';
import { checkPermission, grantPermission } from '../handlers/permission-handler';
import {
  assignAccountsToWaitingRequests,
  enqueueRequest,
  getRequestRecord,
  interruptRequest,
} from './request-queue';
import { originHostname } from './origin';
import { isVaultUnlocked } from '../vault';
import { bindSiteToAccount, getActiveAccount, resolveSigningAccount } from './signing-account';
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
  /**
   * Aborted when the requesting page's port goes away. The request is then interrupted, so it can
   * never be approved for a tab that no longer exists (#139). Held in memory only.
   */
  signal?: AbortSignal;
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

/**
 * What the approval log records as the kind: the event kind, or the request type when it has none.
 * A decrypt of the account's own data is logged as its own type (diogel-io/workspace#226).
 */
const approvalLogKind = (
  eventKind: number,
  details: ApprovalRequestDetails,
  accountPubkey?: string | null,
): number | string => {
  if (eventKind !== -1) return eventKind;
  return isSelfDecrypt(details.requestType, details.counterpartyPubkey, accountPubkey)
    ? selfDecryptLogType(details.requestType)
    : details.requestType;
};

/** What the user decided, for how long, and as which account. */
export interface ApprovalOutcome {
  approved: boolean;
  duration: ApprovalDuration;
  /**
   * The account the request is to be carried out as: the one named on the request the user
   * approved, or the one an earlier grant belongs to. Null for every refusal. The caller hands it
   * to the handler rather than resolving the site's account again (diogel-io/workspace#227).
   */
  accountPubkey: string | null;
}

const REFUSED: ApprovalOutcome = { approved: false, duration: 'once', accountPubkey: null };

/**
 * Ask for approval and report the duration chosen with it.
 *
 * For a caller that writes its own grant, such as WebLN `enable`, which skips the permission store
 * and so must honour the user's choice itself (porwr#369). A request an earlier grant answered was
 * not asked, so it reports `once`, as does every refusal.
 */
export async function requestApprovalDecision(
  origin: string,
  eventKind: number,
  details: ApprovalRequestDetails,
): Promise<ApprovalOutcome> {
  const permissionKind = toPermissionKind(eventKind);

  // The account that will act for this site, which is the one a grant belongs to. Resolved before
  // the permission check so a grant given to one identity cannot answer for another (#116).
  const resolved = await resolveSigningAccount(origin);
  const actingAccount = 'account' in resolved ? resolved.account : null;

  // A decrypt of data the acting account encrypted to itself is never answered by a grant and never
  // remembered: a grant to read messages from others must not also read wallet backups or private
  // lists (diogel-io/workspace#226). A request waiting out a locked vault has no account yet; it is
  // checked again when it is decided and before any grant is written.
  const selfDecrypt = isSelfDecrypt(
    details.requestType,
    details.counterpartyPubkey,
    actingAccount?.id,
  );

  if (!details.skipPermissionCheck && !selfDecrypt && actingAccount) {
    const permission = await checkPermission(
      origin,
      actingAccount.id,
      details.requestType,
      permissionKind,
    );
    if (permission.granted) {
      // A grant is an earlier approval for this account, so the site is bound to it if it is not
      // already (#139). A binding to another account means the grant is for an identity the site
      // no longer acts as, so it does not answer.
      if ((await bindSiteToAccount(origin, actingAccount.id)) !== actingAccount.id) return REFUSED;
      // Answered by a grant the user gave earlier, so still an approval, and logged as one (#37).
      void logService.logApproval(
        approvalLogKind(eventKind, details, actingAccount.id),
        originHostname(origin),
        actingAccount.alias,
        'approved',
      );
      return { approved: true, duration: 'once', accountPubkey: actingAccount.id };
    }
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
      allowRemember: details.allowRemember !== false && !selfDecrypt,
    },
  );

  // Resolved while the vault was locked, but queued after unlock had already named the waiting
  // requests: name it now, so it is never left without an account (diogel-io/workspace#227). A
  // failure to name it is logged, not thrown: the request is queued and waits for its decision,
  // and the panel's next read of the queue tries again.
  if (!record.accountPubkey) {
    await nameWaitingRequests().catch((error: unknown) => {
      logService.log(LogLevel.ERROR, '[BEX] Failed to name the account on a queued request', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  // The page that asked may close while the request waits; it is then interrupted rather than
  // left approvable for a tab that is gone (#139).
  const interruptIfGone = (): void => {
    void interruptRequest(record.id);
  };
  if (details.signal?.aborted) interruptIfGone();
  details.signal?.addEventListener('abort', interruptIfGone, { once: true });

  // A locked vault no longer opens its own window: the panel presents the unlock view with the
  // waiting request, and unlocking still requires an explicit decision afterwards (ADR D14).
  const outcome = await decision.finally(() => {
    details.signal?.removeEventListener('abort', interruptIfGone);
  });

  const approved = outcome.approved;
  const durationLabel: ApprovalDuration = outcome.duration;

  // A request queued while the vault was locked is given its account on unlock, after this
  // function enqueued it, so the record as it stands now is the one to grant and log against
  // (porwr#320).
  const decided = (await getRequestRecord(record.id)) ?? record;

  // An approval is carried out as the account named on the request, so one that names none is
  // refused. The queue refuses it too (`applyDecision`); this holds even if a decision arrives some
  // other way (diogel-io/workspace#227).
  if (approved && !decided.accountPubkey) {
    logService.log(LogLevel.WARN, '[BEX] Refused an approval for a request with no account');
    void logService.logApproval(
      approvalLogKind(eventKind, details, null),
      originHostname(origin),
      decided.accountAlias,
      'rejected',
    );
    return REFUSED;
  }

  // Bound only now, to the account the user saw and approved. A request that was rejected,
  // expired, or interrupted binds nothing (#139).
  //
  // If another approval bound the site to a different account while this one waited (two requests
  // queued around an account switch), this approval was for an identity the site no longer acts
  // as. It is refused rather than letting the caller act as the bound account, which the user did
  // not see on this prompt.
  if (approved && decided.accountPubkey) {
    const bound = await bindSiteToAccount(origin, decided.accountPubkey);
    if (bound !== decided.accountPubkey) {
      logService.log(
        LogLevel.WARN,
        '[BEX] Refused an approval for an account the site is not bound to',
      );
      void logService.logApproval(
        approvalLogKind(eventKind, details, decided.accountPubkey),
        originHostname(origin),
        decided.accountAlias,
        'rejected',
      );
      return REFUSED;
    }
  }

  if (
    approved &&
    durationLabel !== 'once' &&
    details.allowRemember !== false &&
    !details.skipPermissionCheck &&
    // A grant for no account would answer for no one; the user is asked again next time instead.
    decided.accountPubkey &&
    // Named only on unlock for a request that waited out a locked vault, so checked again here.
    !isSelfDecrypt(details.requestType, details.counterpartyPubkey, decided.accountPubkey)
  ) {
    try {
      await grantPermission(
        origin,
        decided.accountPubkey,
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
  // recorded as an approval. This is the only place a prompted request is logged (#37).
  void logService.logApproval(
    approvalLogKind(eventKind, details, decided.accountPubkey),
    originHostname(origin),
    decided.accountAlias,
    outcome.ending ?? (approved ? 'approved' : 'rejected'),
  );

  return approved
    ? { approved, duration: durationLabel, accountPubkey: decided.accountPubkey }
    : REFUSED;
}

/**
 * Name the acting account on requests that waited out a locked vault (porwr#320).
 *
 * Resolved exactly as `requestApproval` resolves it for a request made while unlocked, so the panel
 * shows, and the grant records, the identity the site will actually act as.
 */
export async function identifyWaitingRequests(): Promise<void> {
  await assignAccountsToWaitingRequests(async (origin) => {
    const resolved = await resolveSigningAccount(origin);
    if (!('account' in resolved)) return null;

    const active = await getActiveAccount();
    return {
      accountAlias: resolved.account.alias,
      accountPubkey: resolved.account.id,
      activeAccountAlias: active?.alias ?? null,
      activeAccountPubkey: active?.id ?? null,
    };
  });
}

/**
 * Name the account on waiting requests, if the vault is unlocked (diogel-io/workspace#227).
 *
 * Run before the panel is given a request, and after one is queued. Unlock names the requests
 * waiting at that moment, but a request can reach the queue just after; this way the panel never
 * shows one with no account, whenever it arrived. With nothing to name, it reads the queue and
 * stops.
 */
export async function nameWaitingRequests(): Promise<void> {
  if (!isVaultUnlocked()) return;
  await identifyWaitingRequests();
}
