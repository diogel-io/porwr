import { normalizeRelayUrl } from '@/services/relay-url';

/**
 * A relay websocket URL, normalized and validated by `normalizeRelayUrl`
 * (see `src/services/relay-url.ts`). Construct via `createRelayUrl` — never
 * assert a raw string as `RelayUrl` — so the type system guarantees any
 * `RelayUrl` value has already passed validation.
 */
export type RelayUrl = string & { readonly __brand: 'RelayUrl' };

/**
 * Validates and normalizes a relay websocket URL, delegating to the existing
 * `normalizeRelayUrl` (ws/wss protocol check, hostname/length validation,
 * trailing-slash normalization).
 *
 * @returns The normalized `RelayUrl`, or `null` if `input` fails validation.
 */
export function createRelayUrl(input: string | null | undefined): RelayUrl | null {
  const result = normalizeRelayUrl(input);
  return result.valid && result.url ? (result.url as RelayUrl) : null;
}
