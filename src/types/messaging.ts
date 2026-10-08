/**
 * NIP-17 private messaging types shared by the background and the extension pages.
 *
 * Everything here is safe to hand to a page: relay URLs and publish outcomes, never key material.
 */

/** Kind 10050: the relays a user wants to receive NIP-17 direct messages on. */
export const DM_RELAY_LIST_KIND = 10050;

/** The user's kind 10050 list as last published, or an empty list when none was found. */
export interface DmRelayList {
  relays: string[];
  /** `created_at` of the event the list came from, or null when the user has never published one. */
  updatedAt: number | null;
}

export interface DmRelayPublishRequest {
  relays: string[];
}

/** Where a published kind 10050 landed. At least one relay accepted it, or the publish fails. */
export interface DmRelayPublishResult {
  relays: string[];
  accepted: string[];
  rejected: { url: string; reason: string }[];
}
