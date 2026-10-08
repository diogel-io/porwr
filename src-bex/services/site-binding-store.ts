/**
 * Which account each origin signs as.
 *
 * Porwr signs as the account a site is bound to, never as whichever account happens to be active
 * (#116). A NIP-07 client caches the public key it received at login and assumes every later
 * signature comes from that identity; before this, switching the active account silently made that
 * untrue.
 *
 * The binding is established on a site's first use and does not move afterwards. Establishing it
 * takes the active account, because something has to — the security property is that it cannot
 * change underneath a session that has already started.
 *
 * Bindings are keyed by public key, never by alias. Aliases are user-editable, and renaming one
 * must not orphan a binding or hand a site to a different identity.
 */

import { SITE_BINDINGS_KEY, storageService } from '@/services/storage-service';
import { LogLevel, logService } from '@/services/log-service';
import { normalizeOrigin } from './origin';

export interface SiteBinding {
  origin: string;
  /** The bound account's public key, which is `StoredKey.id`. */
  pubkey: string;
  boundAt: number;
}

let cache: SiteBinding[] | null = null;

const isBinding = (value: unknown): value is SiteBinding => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SiteBinding>;
  return typeof candidate.origin === 'string' && typeof candidate.pubkey === 'string';
};

/**
 * Reads bindings, discarding anything that is not one.
 *
 * This store decides which key signs for a site, so it does not trust storage to hold the shape it
 * expects. A malformed record is dropped rather than propagated: the site rebinds and the user is
 * asked, which is the safe direction.
 */
const load = async (): Promise<SiteBinding[]> => {
  if (cache) return cache;

  const stored = await storageService.get<unknown>(SITE_BINDINGS_KEY);
  cache = Array.isArray(stored) ? stored.filter(isBinding) : [];
  return cache;
};

const save = async (bindings: SiteBinding[]): Promise<void> => {
  cache = bindings;
  await storageService.set(SITE_BINDINGS_KEY, bindings);
};

export const getBinding = async (origin: string): Promise<SiteBinding | null> => {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return null;

  const bindings = await load();
  return bindings.find((binding) => binding.origin === normalized) ?? null;
};

/**
 * Binds an origin to an account if it is not bound already, and returns the binding that applies.
 *
 * Deliberately does not overwrite: a site that is already bound keeps its account, which is the
 * whole point. Re-binding is a user action through revocation, not a side effect of a request.
 */
export const bindOriginIfUnbound = async (
  origin: string,
  pubkey: string,
): Promise<SiteBinding | null> => {
  const normalized = normalizeOrigin(origin);
  if (!normalized || !pubkey) return null;

  const bindings = await load();
  const existing = bindings.find((binding) => binding.origin === normalized);
  if (existing) return existing;

  const binding: SiteBinding = { origin: normalized, pubkey, boundAt: Date.now() };
  await save([...bindings, binding]);

  logService.log(LogLevel.INFO, '[Bindings] Bound an origin to an account', {
    origin: normalized,
  });

  return binding;
};

/** Removes a binding, so the next request from that origin binds afresh. */
export const removeBinding = async (origin: string): Promise<void> => {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return;

  const bindings = await load();
  const remaining = bindings.filter((binding) => binding.origin !== normalized);
  if (remaining.length !== bindings.length) await save(remaining);
};

export const listBindings = async (): Promise<SiteBinding[]> => [...(await load())];

export const clearSiteBindingCache = (): void => {
  cache = null;
};
