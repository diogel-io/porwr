import { onVaultLocked } from '../vault';

/**
 * WebLN access the user allowed "just this once" (porwr#369).
 *
 * For `enable`, once means this visit: the site can call `getInfo` and ask for payments while the
 * page that asked stays open. Writing no grant at all would make the `sendPayment` that follows an
 * `enable` fail, since a payment needs an enabled site. So the grant is kept here rather than in the
 * vault, and ends when that page closes or navigates, when the vault locks, or when the worker
 * restarts and loses this memory.
 *
 * Grants are keyed by origin and wallet connection, like the stored ones, so another tab of the
 * same site can use one while the page that asked is open.
 */

const grants = new Map<string, Set<AbortSignal>>();

const keyOf = (origin: string, connectionId: string): string => `${origin}\n${connectionId}`;

/** Allow WebLN for an origin and connection until `signal` aborts. */
export function grantWebLnForPage(origin: string, connectionId: string, signal: AbortSignal): void {
  if (signal.aborted) return;
  const key = keyOf(origin, connectionId);
  const pages = grants.get(key) ?? new Set<AbortSignal>();
  pages.add(signal);
  grants.set(key, pages);

  signal.addEventListener(
    'abort',
    () => {
      const remaining = grants.get(key);
      remaining?.delete(signal);
      if (remaining?.size === 0) grants.delete(key);
    },
    { once: true },
  );
}

export function hasWebLnPageGrant(origin: string, connectionId: string): boolean {
  return grants.has(keyOf(origin, connectionId));
}

/** Drop an origin's page grants for a connection, as a newer decision replaces them. */
export function revokeWebLnPageGrants(origin: string, connectionId: string): void {
  grants.delete(keyOf(origin, connectionId));
}

export function clearWebLnPageGrants(): void {
  grants.clear();
}

onVaultLocked(() => clearWebLnPageGrants());
