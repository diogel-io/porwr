import { normalizeRelayUrl } from './relay-url';

export interface RelayMetadata {
  name?: string;
  description?: string;
  pubkey?: string;
  contact?: string;
  supported_nips?: number[];
  software?: string;
  version?: string;
  [key: string]: unknown;
}

export interface RelayMetadataResult {
  success: boolean;
  url: string;
  metadata?: RelayMetadata;
  error?: string;
  timestamp: number;
}

/**
 * Converts a WebSocket relay URL (wss:// or ws://) to its NIP-11 metadata fetch URL (https:// or http://).
 * @param relayUrl The WebSocket relay URL to convert.
 * @returns The corresponding NIP-11 metadata fetch URL.
 * @throws Error if the URL is invalid or has an unsupported protocol.
 */
export function getNip11Url(relayUrl: string): string {
  const { valid, url } = normalizeRelayUrl(relayUrl);
  if (!valid || !url) {
    throw new Error(`Invalid relay URL: ${relayUrl}`);
  }

  const parsed = new URL(url);
  if (parsed.protocol === 'wss:') {
    parsed.protocol = 'https:';
  } else if (parsed.protocol === 'ws:') {
    parsed.protocol = 'http:';
  } else {
    throw new Error(`Unsupported relay protocol: ${parsed.protocol}`);
  }

  return parsed.toString();
}

/**
 * Fetches NIP-11 metadata for a relay with a specified timeout.
 * @param relayUrl The normalized WebSocket relay URL.
 * @param timeoutMs The timeout in milliseconds (default: 5000).
 * @returns A structured result containing metadata or error.
 */
export async function fetchRelayMetadata(
  relayUrl: string,
  timeoutMs = 5000,
): Promise<RelayMetadataResult> {
  const timestamp = Date.now();
  let nip11Url: string;

  try {
    nip11Url = getNip11Url(relayUrl);
  } catch (err) {
    return {
      success: false,
      url: relayUrl,
      error: err instanceof Error ? err.message : String(err),
      timestamp,
    };
  }

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(nip11Url, {
      method: 'GET',
      headers: {
        Accept: 'application/nostr+json',
      },
      signal: controller.signal,
    });

    clearTimeout(id);

    if (!response.ok) {
      return {
        success: false,
        url: relayUrl,
        error: `HTTP error ${response.status}: ${response.statusText}`,
        timestamp,
      };
    }

    const data = await response.json();

    // Validate that the data is an object
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {
        success: false,
        url: relayUrl,
        error: 'Invalid NIP-11 response: expected JSON object',
        timestamp,
      };
    }

    return {
      success: true,
      url: relayUrl,
      metadata: mapNip11Response(data),
      timestamp,
    };
  } catch (err) {
    clearTimeout(id);
    let errorMessage = 'Fetch failed';
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        errorMessage = `Timeout after ${timeoutMs}ms`;
      } else {
        errorMessage = err.message;
      }
    } else {
      errorMessage = String(err);
    }

    return {
      success: false,
      url: relayUrl,
      error: errorMessage,
      timestamp,
    };
  }
}

/**
 * Maps a raw NIP-11 response object into the structured RelayMetadata shape.
 * This ensures that fields match the expected types and structure.
 * @param data The raw JSON object from the relay.
 * @returns A structured RelayMetadata object.
 */
function mapNip11Response(data: Record<string, unknown>): RelayMetadata {
  const metadata: RelayMetadata = {};

  if (typeof data.name === 'string') metadata.name = data.name;
  if (typeof data.description === 'string') metadata.description = data.description;
  if (typeof data.pubkey === 'string') metadata.pubkey = data.pubkey;
  if (typeof data.contact === 'string') metadata.contact = data.contact;
  if (typeof data.software === 'string') metadata.software = data.software;
  if (typeof data.version === 'string') metadata.version = data.version;

  if (Array.isArray(data.supported_nips)) {
    metadata.supported_nips = data.supported_nips
      .map((nip) => Number(nip))
      .filter((nip) => !isNaN(nip));
  }

  // Preserve other fields for flexibility, but sanitize if needed
  // For now, we just pass through what's in the response to metadata
  // to support additional NIP-11 fields (like limitation, relay_countries, etc.)
  Object.keys(data).forEach((key) => {
    if (
      ![
        'name',
        'description',
        'pubkey',
        'contact',
        'supported_nips',
        'software',
        'version',
      ].includes(key)
    ) {
      metadata[key] = data[key];
    }
  });

  return metadata;
}
