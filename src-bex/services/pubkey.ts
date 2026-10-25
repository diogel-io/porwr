/**
 * The message a site gets back for a malformed counterparty public key.
 *
 * Fixed rather than nostr-tools' own error, which would otherwise be echoed to the page (#373).
 */
export const INVALID_PUBKEY_MESSAGE = 'Public key must be 64 lowercase hex characters';

/**
 * Whether a site-supplied public key is a hex key Porwr will encrypt or decrypt with.
 *
 * NIP-07 pubkeys are 32 bytes as lowercase hex, which is what the rest of the background accepts.
 * Anything else is refused before a request is queued, so the user is never asked to approve a
 * request that could only fail (#373).
 */
export const isHexPubkey = (pubkey: unknown): pubkey is string =>
  typeof pubkey === 'string' && /^[0-9a-f]{64}$/.test(pubkey);
