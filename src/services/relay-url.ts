/**
 * Hosts a plaintext `ws:` relay may use: traffic to them never leaves the device (T19). The
 * extension CSP's `connect-src` names the same two (`src-bex/manifest-csp.ts`); CSP cannot name an
 * IPv6 address, so `[::1]` is not one of them.
 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);

export const RELAY_PROTOCOL_ERROR = 'Relays must use wss:// (ws:// is allowed only for localhost)';

/**
 * Whether a relay URL may be connected to: `wss:` anywhere, plaintext `ws:` only to a loopback
 * host (diogel-io/workspace#142). Every path that opens a relay connection checks this.
 */
export function isAllowedRelayProtocol(url: URL): boolean {
  if (url.protocol === 'wss:') return true;
  return url.protocol === 'ws:' && LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
}

/**
 * Whether any of `relays` is a plaintext `ws://` relay that `normalizeRelayUrl` now refuses. A
 * stored list that loses every entry this way was the user's own choice of relays: it is left
 * empty rather than replaced by the seed relays, so nothing is read from relays the user never
 * chose (diogel-io/workspace#142).
 */
export function hasRefusedPlaintextRelay(relays: readonly string[]): boolean {
  return relays.some(isRefusedPlaintextRelay);
}

/**
 * Whether `relay` is a `ws://` relay refused only because it is plaintext to a non-loopback host.
 * An entry with another scheme, such as `https://`, is unusable for a different reason and does not
 * count (`normalizeRelayUrl` gives both the same error).
 */
export function isRefusedPlaintextRelay(relay: string): boolean {
  if (normalizeRelayUrl(relay).error !== RELAY_PROTOCOL_ERROR) return false;
  try {
    return new URL(relay.trim()).protocol === 'ws:';
  } catch {
    return false;
  }
}

export interface RelayUrlResult {
  valid: boolean;
  url?: string;
  hostname?: string;
  error?: string;
}

/**
 * Normalizes and validates a relay websocket URL.
 *
 * Requirements:
 * - trim whitespace
 * - reject empty values
 * - accept only wss:// URLs, and ws:// to a loopback host
 * - reject malformed URLs
 * - reject URLs with a fragment (the WebSocket constructor throws on these)
 * - normalize hostname casing where safe
 * - normalize trailing slash handling consistently
 * - derive hostname for display/sorting
 * - return structured success/failure output
 *
 * @param input The raw URL string from user input or discovery
 * @returns Structured normalization result
 */
export function normalizeRelayUrl(input: string | null | undefined): RelayUrlResult {
  if (!input || input.trim().length === 0) {
    return {
      valid: false,
      error: 'URL cannot be empty',
    };
  }

  const trimmed = input.trim();

  try {
    const url = new URL(trimmed);

    if (!isAllowedRelayProtocol(url)) {
      return {
        valid: false,
        error: RELAY_PROTOCOL_ERROR,
      };
    }

    // URL constructor already handles:
    // - hostname casing (normalizes to lowercase)
    // - basic malformed URL rejection (throws)

    // Normalize trailing slash: URL object includes a trailing slash for the pathname if it's empty.
    // We want a consistent format. Many Nostr clients prefer no trailing slash if the path is empty.
    // However, if there is a path (e.g. ws://relay.com/path), we should keep it.

    let normalizedUrl = url.toString();

    // If the URL ends with a slash and the pathname was just '/' or a path like '/path/', we trim it for consistency
    // but only if it doesn't have search params or hash which would be unusual for a relay but possible.
    if (url.pathname.endsWith('/') && !url.search && !url.hash && normalizedUrl.endsWith('/')) {
      normalizedUrl = normalizedUrl.slice(0, -1);
    }

    // Additional strict validation for relay catalog quality
    if (normalizedUrl.length > 255) {
      return {
        valid: false,
        error: 'URL exceeds maximum length of 255 characters',
      };
    }

    // Ensure hostname is valid (not just an empty string which can happen in some URL parsers)
    // Also reject hostnames starting with a dot, which are usually malformed placeholders.
    if (!url.hostname || url.hostname.trim().length === 0 || url.hostname.startsWith('.')) {
      return {
        valid: false,
        error: 'URL must contain a valid hostname',
      };
    }

    // The WebSocket constructor throws a SyntaxError for any URL containing a
    // fragment, so a URL with one is not actually usable as a relay URL even
    // though it parses successfully.
    if (url.hash) {
      return {
        valid: false,
        error: 'URL must not contain a fragment',
      };
    }

    return {
      valid: true,
      url: normalizedUrl,
      hostname: url.hostname,
    };
  } catch {
    return {
      valid: false,
      error: 'Invalid URL format',
    };
  }
}

/**
 * Checks if a hostname is restricted (localhost or IP address).
 *
 * This is used to filter out low-value or local-only relays from the catalog
 * by default, while still allowing them if they are seeds or user-added.
 *
 * @param hostname The hostname to check
 */
export function isRestrictedHostname(hostname: string | undefined): boolean {
  if (!hostname) return true;

  const host = hostname.toLowerCase();

  // 1. Localhost and loopback
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host === '0.0.0.0' ||
    host === '::'
  ) {
    return true;
  }

  // 2. IPv4 pattern (strict enough for hostname check)
  const ipv4Pattern = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
  if (ipv4Pattern.test(host)) return true;

  // 3. IPv6 check (contains colon and usually wrapped in brackets in URLs, but hostname from URL object may vary)
  return host.includes(':') || (host.startsWith('[') && host.endsWith(']'));
}
