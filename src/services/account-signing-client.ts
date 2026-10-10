import type { Event as NostrEvent } from 'nostr-tools';

import { sendBexMessage } from './vault-service';
import type { AccountEventTemplate } from '@/types/account-signing';

/**
 * Has the background sign `template` as the vault account `accountPubkey` (#240).
 *
 * The page never holds a private key: it gets back the signed event, which is public, and publishes
 * it itself.
 */
export async function signAsAccount(accountPubkey: string, template: AccountEventTemplate): Promise<NostrEvent> {
  const response = await sendBexMessage('account.signEvent', { accountPubkey, template });
  if (response && typeof response === 'object' && 'success' in response && response.success === false) {
    throw new Error(typeof response.error === 'string' ? response.error : 'Signing failed');
  }
  if (!response || typeof response !== 'object' || !('sig' in response) || response.pubkey !== accountPubkey) {
    throw new Error('Invalid signing response');
  }
  return response;
}
