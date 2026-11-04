/**
 * NIP-46 remote-signer types shared by the background and Porwr's pages (diogel-io/workspace#138).
 */

/** A remote signer's request that the user authorise this client, as the panel shows it. */
export interface Nip46AuthChallengeView {
  id: string;
  /** The waiting site, or empty while an account is being connected from Porwr's own page. */
  origin: string;
  accountPubkey: string;
  /** An `https:` URL, shown as text and opened only on the user's click. */
  url: string;
  host: string;
}

export interface Nip46OpenAuthChallengeRequest {
  challengeId: string;
}
