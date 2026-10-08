import type { VaultData } from '@/types/bridge';
import type { MessagingReadState } from '@/types/messaging';

/**
 * Who an account talks to is private, so read state lives inside the encrypted vault rather than in
 * plain extension storage. These are pure functions over `VaultData`; the handler persists the result.
 */

export function readStateFor(vaultData: VaultData, account: string): MessagingReadState {
  return { ...(vaultData.messagingReadState?.[account] ?? {}) };
}

/** Records that `peer`'s conversation has been read up to `readAt`. Never moves backwards. */
export function markConversationRead(
  vaultData: VaultData,
  account: string,
  peer: string,
  readAt: number,
): VaultData {
  const current = vaultData.messagingReadState?.[account] ?? {};
  if ((current[peer] ?? 0) >= readAt) {
    return vaultData;
  }
  return {
    ...vaultData,
    messagingReadState: {
      ...(vaultData.messagingReadState ?? {}),
      [account]: { ...current, [peer]: readAt },
    },
  };
}
