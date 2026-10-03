/**
 * Panel- and dashboard-side access to what each site holds.
 *
 * A thin pass through the bridge: the background owns the grant and binding stores, and this never
 * caches them. A stale list would show a user authority that has already been revoked.
 */

import { sendBexMessage } from './bridge-client';
import type { ConnectedSite } from 'app/src-bex/services/connected-sites';
import type { SiteAccount, SwitchSiteAccountResult } from 'app/src-bex/services/site-account';
import { ErrorCode } from 'src/types/error-codes.d';

export type { ConnectedSite, SiteAccount, SwitchSiteAccountResult };

export const listConnectedSites = async (): Promise<ConnectedSite[]> =>
  (await sendBexMessage('sites.list')) ?? [];

export const disconnectSite = async (origin: string): Promise<boolean> =>
  (await sendBexMessage('sites.revoke', { origin })) ?? false;

/** How many sites hold a standing permission for an account. */
export const countSitesHoldingGrantsFor = async (accountPubkey: string): Promise<number> =>
  (await sendBexMessage('sites.countForAccount', { accountPubkey })) ?? 0;

/** Which account a site is connected as, and whether that is the active one. Null when it is not. */
export const getSiteAccount = async (origin: string): Promise<SiteAccount | null> =>
  (await sendBexMessage('sites.binding', { origin })) ?? null;

/**
 * Connect a site as the active account instead: disconnects it, then binds it to the active one.
 * Only ever on the user's say-so, from Porwr's own UI (diogel-io/workspace#23).
 */
export const switchSiteToActiveAccount = async (origin: string): Promise<SwitchSiteAccountResult> =>
  (await sendBexMessage('sites.useActiveAccount', { origin })) ?? {
    success: false,
    error: 'No response from the background',
    code: ErrorCode.GEN_UNKNOWN,
  };
