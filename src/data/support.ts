import { nip19 } from 'nostr-tools';

/**
 * The Diogel support account, which the Support page messages over NIP-17 (#228).
 *
 * Defined here and nowhere else. Anything that could change this recipient could redirect users'
 * support messages, so there is deliberately no setting, storage key or environment override for it.
 */
export const SUPPORT_NPUB = 'npub1v2hascsnc9dsshmccucmc3qd92yx0ly4997dvhqdwr2zmx942g3qh3jmd4';

function decodeSupportPubkey(npub: string): string {
  const decoded = nip19.decode(npub);
  if (decoded.type !== 'npub') throw new Error('SUPPORT_NPUB is not an npub');
  return decoded.data;
}

/** The support account's hex public key, which messages are addressed to. */
export const SUPPORT_PUBKEY = decodeSupportPubkey(SUPPORT_NPUB);
