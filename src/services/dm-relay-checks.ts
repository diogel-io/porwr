import type { DmRelayCheck } from '@/types/messaging';

export interface DmRelayCheckSummary {
  /** The relays that accept private messages but don't keep them, in list order. */
  dropping: string[];
  /** Every relay drops messages, so publishing the list would leave the user unreachable. */
  allDrop: boolean;
}

/**
 * What a DM relay check means for publishing the list (#277). A relay that couldn't be checked is not
 * counted as dropping, so a list of dropping and unchecked relays gets a warning rather than a block.
 */
export function summariseDmRelayChecks(checks: readonly DmRelayCheck[]): DmRelayCheckSummary {
  const dropping = checks.filter((check) => check.status === 'drops').map((check) => check.url);
  return { dropping, allDrop: checks.length > 0 && dropping.length === checks.length };
}
