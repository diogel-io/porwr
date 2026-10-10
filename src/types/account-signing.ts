/**
 * Signing an event as one of the vault's accounts, from an extension page (#240).
 *
 * The page sends a template and the account's public key; the background signs with that account's
 * key and returns the signed event. A signed event is public, so the page publishes it as before —
 * but it never holds the key.
 */

/** Kinds QuickSign may publish. */
export const QUICK_SIGN_SUPPORTED_KINDS = [1, 30023] as const;
export type QuickSignSupportedKind = (typeof QUICK_SIGN_SUPPORTED_KINDS)[number];

/**
 * Every kind an extension page may have the background sign: profile (0), contact list (3), relay
 * list (10002), and QuickSign's kinds. Anything else is refused, so the action cannot be turned into
 * a general-purpose signer.
 */
export const ACCOUNT_SIGNABLE_KINDS: readonly number[] = [0, 3, 10002, ...QUICK_SIGN_SUPPORTED_KINDS];

export interface AccountEventTemplate {
  kind: number;
  content: string;
  tags: string[][];
  created_at?: number;
}

export interface AccountSignRequest {
  accountPubkey: string;
  template: AccountEventTemplate;
}
