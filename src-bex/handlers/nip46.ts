/**
 * Remote-signer housekeeping for Porwr's own pages (diogel-io/workspace#138).
 *
 * Connecting an account is `accounts.addRemote` in `accounts.ts`; signing through one happens in the
 * NIP-07 and encryption handlers. This file serves the authorisation challenges a signer raises
 * (`auth_url`) to the panel and the connect form, and drops every connection when the vault locks.
 * The raw listener only accepts these from extension pages, so a website cannot reach them.
 */

import type { Nip46OpenAuthChallengeRequest } from '@/types/nip46';
import type { HandlerResult } from '../types/background';
import { onVaultLocked } from '../vault';
import {
  authChallengeUrl,
  clearAuthChallenges,
  listAuthChallenges,
  type Nip46AuthChallenge,
} from '../services/nip46-auth-challenges';
import { nip46Client } from '../services/nip46-client';

// No remote-signer connection outlives the vault's key, as no wallet or DM connection does (#373).
onVaultLocked(() => {
  nip46Client.close();
  clearAuthChallenges();
});

export function handleNip46AuthChallenges(): Promise<HandlerResult<Nip46AuthChallenge[]>> {
  return Promise.resolve({ success: true, data: listAuthChallenges() });
}

/**
 * Open a challenge's URL in a new tab, on the user's click. The page names the challenge by id only:
 * the URL opened is the one the background checked when the signer sent it.
 */
export async function handleNip46OpenAuthChallenge(
  payload: Nip46OpenAuthChallengeRequest,
): Promise<HandlerResult<boolean>> {
  const url = authChallengeUrl(payload?.challengeId);
  if (!url) return { success: false, error: 'This authorisation request has ended' };
  await chrome.tabs.create({ url, active: true });
  return { success: true, data: true };
}
