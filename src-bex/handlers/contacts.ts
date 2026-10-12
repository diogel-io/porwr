import type { ContactRefreshRequest, ContactRefreshResult } from '@/types/contact-list';
import type { HandlerResult } from '../types/background';
import { getActiveStoredKey } from './active-key';
import { refreshContactsInBackground } from '../services/contact-cache-refresher';

/**
 * Contact cache actions for the extension's own pages (#257).
 *
 * A page asks for a forced refresh when it opens and reads the results from the cache. The answer comes
 * back as soon as the refresh is queued, because relays can take longer than a page waits for any
 * background reply. Reads public data only; needs the vault unlocked to know the active account.
 */
export async function handleContactsRefresh(
  payload: ContactRefreshRequest,
): Promise<HandlerResult<ContactRefreshResult>> {
  const storedKey = await getActiveStoredKey();
  refreshContactsInBackground(storedKey.id, { force: payload?.force === true });
  return { success: true, data: { accountPubkey: storedKey.id } };
}

/** Refreshes the active account's contacts if the vault is unlocked and an account is chosen. */
export async function refreshActiveAccountContacts(): Promise<void> {
  try {
    const storedKey = await getActiveStoredKey();
    refreshContactsInBackground(storedKey.id);
  } catch {
    // Locked, or no account chosen yet: there is nothing to refresh for.
  }
}
