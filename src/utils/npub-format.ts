import * as nip19 from 'nostr-tools/nip19';

/**
 * npub encoding and display shared between the surfaces that show an account's public key.
 *
 * The Keys table had its own copy of the truncation; the panel's profile card shows the same value
 * (#303), and two surfaces shortening one key differently would read as two different keys.
 */

const NPUB_DISPLAY_HEAD_LENGTH = 14;
const NPUB_DISPLAY_TAIL_LENGTH = 10;

const HEX_PUBKEY = /^[0-9a-f]{64}$/i;

/**
 * The NIP-19 npub for a hex pubkey, or empty when the value is not one.
 *
 * Checked up front because `npubEncode` does not reject everything it should: an empty string
 * encodes to `npub106246s`, which would show and copy as if it were a key.
 */
export const encodeNpub = (pubkey: string): string => {
  if (!HEX_PUBKEY.test(pubkey)) return '';

  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return '';
  }
};

/**
 * An npub shortened in the middle, for display only.
 *
 * Head and tail are both kept because the `npub1` prefix alone tells the user nothing and the tail
 * is what people compare by eye. Callers copy the full value, never this one.
 */
export const formatNpubDisplay = (npub: string): string => {
  if (npub.length <= NPUB_DISPLAY_HEAD_LENGTH + NPUB_DISPLAY_TAIL_LENGTH + 1) {
    return npub;
  }

  return `${npub.slice(0, NPUB_DISPLAY_HEAD_LENGTH)}…${npub.slice(-NPUB_DISPLAY_TAIL_LENGTH)}`;
};
