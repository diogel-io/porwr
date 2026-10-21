/**
 * What a site currently holds: which identity it is bound to, and what it may do without asking.
 *
 * The pieces existed and nothing joined them. `getGrantedPermissions` and `revokePermission` were
 * written months ago with no bridge event and no caller, so no user has ever been able to see or
 * revoke a grant (#116). Bindings arrived with the same gap.
 *
 * Joined here rather than in the view, so what "connected" means is one answer the panel, the
 * dashboard and any future surface all read the same way.
 */

import {
  getGrantedPermissions,
  revokeGrantsExcept,
  revokePermission,
} from '../handlers/permission-handler';
import { LogLevel, logService } from '@/services/log-service';
import { isVaultUnlocked } from '../vault';
import { listAllNip47Connections } from './nip47-connection-store';
import { mutateWalletVault } from './wallet-vault';
import { removeWebLnPermissionsForOrigin } from './webln-permission-store';
import {
  getBinding,
  listBindings,
  removeBinding,
  removeBindingsExcept,
} from './site-binding-store';
import { normalizeOrigin } from './origin';
import type { PermissionEventKind } from '../types/background';

export interface ConnectedSiteGrant {
  /**
   * The account this grant belongs to.
   *
   * A site can hold grants for more than one identity — each was given while that account was the
   * one acting — so a grant list that did not say which would be ambiguous exactly where it matters.
   */
  accountPubkey: string;
  requestType: string;
  eventKind: PermissionEventKind;
  /** Absent for a grant that does not expire. */
  expiresAt?: number;
  grantedAt: number;
}

export interface ConnectedSite {
  origin: string;
  /** The account this site signs as, or null when it holds grants but was never bound. */
  boundPubkey: string | null;
  boundAt: number | null;
  grants: ConnectedSiteGrant[];
}

/**
 * Every site with a binding, a grant, or both.
 *
 * A site can have one without the other: a binding with no grants is a site that asked once and was
 * answered "just this once", which is worth showing — it still signs as that identity next time.
 */
export const listConnectedSites = async (): Promise<ConnectedSite[]> => {
  const [bindings, grants] = await Promise.all([listBindings(), getGrantedPermissions()]);

  const sites = new Map<string, ConnectedSite>();

  const siteFor = (origin: string): ConnectedSite => {
    const existing = sites.get(origin);
    if (existing) return existing;

    const site: ConnectedSite = { origin, boundPubkey: null, boundAt: null, grants: [] };
    sites.set(origin, site);
    return site;
  };

  for (const binding of bindings) {
    const site = siteFor(binding.origin);
    site.boundPubkey = binding.pubkey;
    site.boundAt = binding.boundAt;
  }

  for (const grant of grants) {
    if (!grant.granted) continue;

    siteFor(grant.origin).grants.push({
      accountPubkey: grant.accountPubkey,
      requestType: grant.requestType,
      eventKind: grant.eventKind,
      grantedAt: grant.timestamp,
      ...(grant.expiry !== undefined ? { expiresAt: grant.expiry } : {}),
    });
  }

  return [...sites.values()].sort((a, b) => a.origin.localeCompare(b.origin));
};

/**
 * How many sites hold at least one standing permission for an account.
 *
 * The dashboard's "Approved Clients" figure used to count distinct hostnames in the approvals log,
 * which answers a different question: it counted sites that *asked*, including ones the user
 * rejected, and kept counting them after a grant was revoked (#116).
 */
export const countSitesHoldingGrantsFor = async (accountPubkey: string): Promise<number> => {
  if (!accountPubkey) return 0;

  const sites = await listConnectedSites();
  return sites.filter((site) => site.grants.some((grant) => grant.accountPubkey === accountPubkey))
    .length;
};

/**
 * Disconnect a site entirely: every grant it holds, and its binding.
 *
 * Deliberately all-or-nothing rather than per-grant. A site whose grants are revoked but whose
 * binding remains still signs as that identity the next time it asks, which is not what "disconnect"
 * means to anyone reading it. Removing the binding lets the next request bind afresh, and the user
 * is asked again for everything.
 *
 * Every account's grants go, not only the bound one's: this is what moving a site to another
 * account relies on (#166). The Connected Sites page disconnects one account with
 * `disconnectSiteFor` instead (#309).
 */
export const disconnectSite = async (origin: string): Promise<boolean> => {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  const grants = await getGrantedPermissions();
  const held = grants.filter((grant) => grant.origin === normalized);

  for (const grant of held) {
    await revokePermission(normalized, grant.accountPubkey, grant.requestType, grant.eventKind);
  }

  await removeBinding(normalized);
  await removeWebLnPermissions(normalized);

  return true;
};

/**
 * Remove an origin's WebLN permissions, all of them or only those for one account's wallets.
 *
 * They live in the vault, so this needs it unlocked. Locked, they cannot be used either, and the
 * site is asked again to enable WebLN once its binding is gone; the failure is logged (#139).
 */
const removeWebLnPermissions = async (origin: string, accountPubkey?: string): Promise<void> => {
  if (!isVaultUnlocked()) {
    logService.log(LogLevel.WARN, '[Sites] Left WebLN permissions while the vault is locked');
    return;
  }
  await mutateWalletVault((vaultData) => {
    const connectionIds =
      accountPubkey === undefined
        ? undefined
        : new Set(
            listAllNip47Connections(vaultData)
              .filter((connection) => connection.accountPubkey === accountPubkey)
              .map((connection) => connection.id),
          );
    return {
      vaultData: removeWebLnPermissionsForOrigin(vaultData, origin, connectionIds),
      data: undefined,
    };
  });
};

/**
 * Remove grants and bindings that belong to accounts no longer in the vault.
 *
 * Removing an account does this as it happens; this catches anything left from before that, so a
 * key imported again later does not quietly bring its old sites back (#139).
 */
export const sweepSiteStateForRemovedAccounts = async (
  accountPubkeys: readonly string[],
): Promise<{ grants: number; bindings: number }> => {
  const keep = new Set(accountPubkeys);
  return { grants: await revokeGrantsExcept(keep), bindings: await removeBindingsExcept(keep) };
};

/**
 * The sites one account is connected to, and only that account's grants on each (#309).
 *
 * A site is the account's when it is bound to it, or when it is unbound and holds a grant for it. A
 * site bound to another account is that account's, even if it still carries a grant for this one
 * from before bindings existed (#116): signing uses the bound account, so such a grant does nothing.
 *
 * Built on `listConnectedSites` rather than beside it, so what "connected" means stays one answer.
 */
export const listConnectedSitesFor = async (accountPubkey: string): Promise<ConnectedSite[]> => {
  if (!accountPubkey) return [];

  const sites = await listConnectedSites();
  return sites
    .filter((site) =>
      site.boundPubkey !== null
        ? site.boundPubkey === accountPubkey
        : site.grants.some((grant) => grant.accountPubkey === accountPubkey),
    )
    .map((site) => ({
      ...site,
      grants: site.grants.filter((grant) => grant.accountPubkey === accountPubkey),
    }));
};

/**
 * Disconnect a site for one account only (#309): that account's grants, and the binding when the
 * site is bound to it. Another account's grants on the same origin are left exactly as they were.
 *
 * Removing the binding keeps "disconnect" meaning what it does in `disconnectSite`: the site is
 * asked again, from scratch, the next time it wants a key.
 */
export const disconnectSiteFor = async (
  origin: string,
  accountPubkey: string,
): Promise<boolean> => {
  const normalized = normalizeOrigin(origin);
  if (!normalized || !accountPubkey) return false;

  const grants = await getGrantedPermissions();
  const held = grants.filter(
    (grant) => grant.origin === normalized && grant.accountPubkey === accountPubkey,
  );

  for (const grant of held) {
    await revokePermission(normalized, grant.accountPubkey, grant.requestType, grant.eventKind);
  }

  if ((await getBinding(normalized))?.pubkey === accountPubkey) {
    await removeBinding(normalized);
  }
  await removeWebLnPermissions(normalized, accountPubkey);

  return true;
};
