/**
 * Validation for the Blossom server Porwr uploads media to (diogel-io/workspace#142, T21).
 *
 * The upload carries a signed authorisation and the file itself, so it only ever goes over https.
 * Both the settings page and the background check this: the background because the server URL
 * arrives in a page's request payload.
 */

export const BLOSSOM_SERVER_PROTOCOL_ERROR = 'Blossom servers must use https://';

export interface BlossomServerResult {
  valid: boolean;
  /** The parsed URL, serialised. */
  url?: string;
  /** The lowercase bare hostname, as BUD-11 expects in a `server` tag. */
  hostname?: string;
  error?: string;
}

export function normalizeBlossomServer(input: string | null | undefined): BlossomServerResult {
  const trimmed = (input ?? '').trim();
  if (!trimmed) {
    return { valid: false, error: 'Enter a Blossom server URL' };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Enter a valid Blossom server URL' };
  }

  if (url.protocol !== 'https:') {
    return { valid: false, error: BLOSSOM_SERVER_PROTOCOL_ERROR };
  }
  if (!url.hostname) {
    return { valid: false, error: 'Enter a valid Blossom server URL' };
  }
  // Credentials in the URL would be sent with every upload and stored in settings in plain text.
  if (url.username || url.password) {
    return { valid: false, error: 'A Blossom server URL must not contain a username or password' };
  }

  return { valid: true, url: url.toString(), hostname: url.hostname.toLowerCase() };
}
