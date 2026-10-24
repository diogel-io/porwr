/**
 * The largest event kind NIP-01 defines a range for. Kinds are 16-bit integers in practice, and
 * anything beyond is not a kind Porwr can classify or grant.
 */
export const MAX_EVENT_KIND = 65_535;

/**
 * Whether a site-supplied event kind is one Porwr may present and grant.
 *
 * The kind flows into the risk class, the grant key, and the approval log. A string such as `'any'`
 * would reach the grant store as a wildcard, and a float or negative number would be classified as
 * something it is not, so anything other than a whole number in range is refused before a request
 * is queued (#139).
 */
export const isSignableEventKind = (kind: unknown): kind is number =>
  typeof kind === 'number' && Number.isInteger(kind) && kind >= 0 && kind <= MAX_EVENT_KIND;
