/**
 * Deciding which origins have gone, when a page disappears.
 *
 * Extracted from `background.ts` (#173). The listener stays there; this is the part with a decision
 * in it, and it was unreachable from any test.
 *
 * A request record names an origin and no tab, so two tabs on the same origin are indistinguishable
 * here. The rule is therefore conservative by construction: an origin has only gone when *no* tab
 * still holds it. Anything less would interrupt a request another live tab is still waiting on.
 */

import { LogLevel, logService } from '@/services/log-service';
import { listPageOrigins } from './page-origin-registry';
import { interruptRequestsForOrigin, listPendingRequests } from './request-queue';

/**
 * Origins that have pending requests but are no longer held by any tab.
 *
 * Pure, so the rule can be read and tested without a browser: given what is pending and what is
 * still open, which origins can no longer be signed for.
 */
export const findAbandonedOrigins = (
  pendingOrigins: readonly string[],
  heldOrigins: ReadonlySet<string>,
): string[] => [...new Set(pendingOrigins)].filter((origin) => !heldOrigins.has(origin));

/**
 * Interrupt every request whose origin no longer has a tab.
 *
 * Called when the page origin registry reports a tab gone. Failure is logged rather than thrown:
 * this runs from a browser event with no caller to return to, and a request left pending is still
 * bounded by its own expiry (D8).
 */
export const reconcileAbandonedRequests = async (): Promise<string[]> => {
  try {
    const heldOrigins = new Set<string>();
    for (const [, record] of listPageOrigins()) heldOrigins.add(record.origin);

    const pending = (await listPendingRequests()) ?? [];
    const abandoned = findAbandonedOrigins(
      pending.map((request) => request.origin),
      heldOrigins,
    );

    for (const origin of abandoned) {
      await interruptRequestsForOrigin(origin);
    }

    return abandoned;
  } catch (error: unknown) {
    logService.log(LogLevel.ERROR, '[Pages] Failed to reconcile requests for a closed page', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};
