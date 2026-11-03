import { normalizeRelayUrl } from '@/services/relay-url';

/** Kept in step with `MAX_SIGNER_RELAYS` in `src-bex/services/nip46-client.ts`. */
export const MAX_BUNKER_URI_RELAYS = 16;

/**
 * Parsing a NIP-46 `bunker://` URI (diogel-io/workspace#138).
 *
 * `bunker://<remote-signer-pubkey>?relay=<wss://…>&relay=…&secret=<optional>`. The pubkey is the
 * key the remote signer answers as, which may differ from the user's key: the user's key is asked
 * for with `get_public_key` once connected, never taken from here.
 *
 * Every relay is checked with `normalizeRelayUrl`, so a refused relay is never contacted, and a URI
 * left with none is refused before anything is sent. NIP-05 bunker discovery is not supported.
 */

export interface ParsedBunkerUri {
  remoteSignerPubkey: string;
  relays: string[];
  secret?: string;
}

const HEX_64 = /^[0-9a-f]{64}$/;

/** Long enough for any real token, short enough that a pasted blob is refused. */
const MAX_SECRET_LENGTH = 256;

export const BUNKER_URI_NO_RELAYS =
  'This bunker URI has no relay Porwr can use. Relays must be wss:// (or ws:// to localhost).';

export function parseBunkerUri(input: string): ParsedBunkerUri {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) throw new Error('A bunker URI is required');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('This is not a valid bunker URI');
  }
  if (url.protocol !== 'bunker:') {
    throw new Error('A remote signer URI must start with bunker://');
  }

  const remoteSignerPubkey = (url.hostname || url.pathname.replace(/^\/\//, ''))
    .replace(/\/$/, '')
    .toLowerCase();
  if (!HEX_64.test(remoteSignerPubkey)) {
    throw new Error("The bunker URI's remote signer key must be a 64-character hex key");
  }

  // A URI's query is not a form body: a literal `+` is a plus, not a space. `URLSearchParams` would
  // turn it into one, so a secret such as `ab+cd` would no longer match the signer's.
  const params = new URLSearchParams(url.search.replace(/\+/g, '%2B'));

  const relays = Array.from(
    new Set(
      params
        .getAll('relay')
        .map((relay) => normalizeRelayUrl(relay))
        .flatMap((result) => (result.valid && result.url ? [result.url] : [])),
    ),
  );
  if (relays.length === 0) throw new Error(BUNKER_URI_NO_RELAYS);
  if (relays.length > MAX_BUNKER_URI_RELAYS) {
    throw new Error(`A bunker URI may name at most ${MAX_BUNKER_URI_RELAYS} relays`);
  }

  const secret = params.get('secret') ?? undefined;
  if (secret !== undefined && (secret.length === 0 || secret.length > MAX_SECRET_LENGTH)) {
    throw new Error("The bunker URI's secret is not valid");
  }

  return { remoteSignerPubkey, relays, ...(secret !== undefined ? { secret } : {}) };
}
