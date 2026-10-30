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

  // Serialised without a trailing slash, the form a kind 10063 `server` tag carries (porwr#417).
  // `URL.toString()` would add one to a bare origin.
  const path = url.pathname.replace(/\/+$/, '');
  return {
    valid: true,
    url: `${url.origin}${path}${url.search}`,
    hostname: url.hostname.toLowerCase(),
  };
}

export const BLOSSOM_SERVER_TRAILING_SLASH_ERROR = 'A Blossom server URL must not end with a /';

/**
 * Checks what the user typed into the Media Management field (porwr#417).
 *
 * Stricter than `normalizeBlossomServer`, which reads stored values and drops a trailing slash:
 * typed input that ends in one is refused, so what is saved is exactly what was typed.
 */
export function validateBlossomServerInput(input: string | null | undefined): BlossomServerResult {
  if ((input ?? '').trim().endsWith('/')) {
    return { valid: false, error: BLOSSOM_SERVER_TRAILING_SLASH_ERROR };
  }
  return normalizeBlossomServer(input);
}

/**
 * Why a Blossom upload failed, as recorded in upload status (porwr#370).
 *
 * The status lives in `chrome.storage.local`, which content scripts can read, so it holds one of
 * these and never the server's own words. The page that shows it turns the code into a message.
 */
export type BlossomUploadErrorCode = 'too_large' | 'unauthorized' | 'not_https' | 'failed';

const BLOSSOM_UPLOAD_ERROR_CODES: ReadonlySet<string> = new Set<BlossomUploadErrorCode>([
  'too_large',
  'unauthorized',
  'not_https',
  'failed',
]);

export const isBlossomUploadErrorCode = (value: unknown): value is BlossomUploadErrorCode =>
  typeof value === 'string' && BLOSSOM_UPLOAD_ERROR_CODES.has(value);

/** The code for a server's HTTP refusal. */
export const blossomUploadErrorForStatus = (status: number): BlossomUploadErrorCode => {
  if (status === 413) return 'too_large';
  if (status === 401 || status === 403) return 'unauthorized';
  return 'failed';
};
