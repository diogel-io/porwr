/**
 * Which account a site is connected as, compared with the active one, and moving it on request.
 *
 * A site keeps the account it first connected with, whichever account is active later (#116). That
 * is deliberate, but it was invisible: selecting another account in Porwr changed nothing for a
 * site that was already connected, and nothing said so (diogel-io/workspace#23). This is what the
 * panel reads to say so, and what it calls when the user asks to move the site.
 *
 * Moving a site only ever happens from Porwr's own UI. A site cannot ask for it, and it never
 * happens because the active account changed.
 */

import { ErrorCode } from '@/types/error-codes.d';
import { isVaultUnlocked } from '../vault';
import { disconnectSite } from './connected-sites';
import { normalizeOrigin } from './origin';
import { interruptRequestsForOrigin } from './request-queue';
import { getActiveAccount, listAccounts } from './signing-account';
import { bindOriginIfUnbound, getBinding } from './site-binding-store';

export interface SiteAccount {
  origin: string;
  /** The account this site signs as. */
  boundPubkey: string;
  /** Null when the vault is locked, or the bound account is no longer in it. */
  boundAlias: string | null;
  /** Null when the vault is locked or no account is active. */
  activePubkey: string | null;
  activeAlias: string | null;
  /** True only when both are known and differ. */
  mismatch: boolean;
}

export type SwitchSiteAccountResult =
  | { success: true; site: SiteAccount }
  | { success: false; error: string; code: ErrorCode };

/** The account a site is connected as, or null for a site that is not connected. */
export const getSiteAccount = async (origin: string): Promise<SiteAccount | null> => {
  const binding = await getBinding(origin);
  if (!binding) return null;

  // Aliases live in the vault. A locked vault still answers which key the site is bound to, which
  // is what matters, and leaves the comparison unknown rather than guessing.
  const unlocked = isVaultUnlocked();
  const [accounts, active] = unlocked
    ? await Promise.all([listAccounts(), getActiveAccount()])
    : [[], null];

  const bound = accounts.find((account) => account.id === binding.pubkey) ?? null;

  return {
    origin: binding.origin,
    boundPubkey: binding.pubkey,
    boundAlias: bound?.alias ?? null,
    activePubkey: active?.id ?? null,
    activeAlias: active?.alias ?? null,
    mismatch: active !== null && active.id !== binding.pubkey,
  };
};

/**
 * Connect a site as the active account instead of the one it is bound to.
 *
 * The same as disconnecting it and letting it connect again with this account active: every grant
 * it holds is revoked, because grants belong to an account and the new one has none (#166).
 *
 * The site's waiting requests are closed first, as rejected. Each one names the account it would
 * act as, and that account is decided again when it is approved; leaving them open would let an
 * approval sign as an account its prompt never named.
 */
export const switchSiteToActiveAccount = async (
  origin: string,
): Promise<SwitchSiteAccountResult> => {
  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return {
      success: false,
      error: 'Not a site Porwr connects to',
      code: ErrorCode.GEN_INVALID_INPUT,
    };
  }

  if (!isVaultUnlocked()) {
    return { success: false, error: 'Vault is locked', code: ErrorCode.VLT_LOCKED };
  }

  const active = await getActiveAccount();
  if (!active) {
    return { success: false, error: 'No active account', code: ErrorCode.SIG_NO_ACTIVE_KEY };
  }

  await interruptRequestsForOrigin(normalized);
  await disconnectSite(normalized);
  await bindOriginIfUnbound(normalized, active.id);

  const site = await getSiteAccount(normalized);
  if (!site) {
    return {
      success: false,
      error: 'The site could not be connected',
      code: ErrorCode.SIG_NO_ACTIVE_KEY,
    };
  }

  return { success: true, site };
};
