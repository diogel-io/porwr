import type { VaultData } from '@/types/bridge';
import type { MessagingSavedPeers } from '@/types/messaging';

/**
 * Contacts an account added to Chats through search (#258).
 *
 * Who an account means to talk to is private, so these live inside the encrypted vault beside read
 * state. Pure functions over `VaultData`: each returns the vault unchanged when there is nothing to
 * do, so the caller can skip the write.
 */

/** Enough for anyone's real conversations; a ceiling so a page cannot grow the vault without bound. */
export const MAX_SAVED_PEERS = 500;

export function savedPeersFor(vaultData: VaultData, account: string): MessagingSavedPeers {
  return [...(vaultData.messagingSavedPeers?.[account] ?? [])];
}

function withPeers(vaultData: VaultData, account: string, peers: MessagingSavedPeers): VaultData {
  return {
    ...vaultData,
    messagingSavedPeers: { ...(vaultData.messagingSavedPeers ?? {}), [account]: peers },
  };
}

/** Adds `peer` to the end of the account's saved peers. Adding one already saved changes nothing. */
export function addSavedPeer(vaultData: VaultData, account: string, peer: string): VaultData {
  const current = vaultData.messagingSavedPeers?.[account] ?? [];
  if (current.includes(peer)) return vaultData;
  if (current.length >= MAX_SAVED_PEERS) {
    throw new Error(`No more than ${MAX_SAVED_PEERS} conversations can be added`);
  }
  return withPeers(vaultData, account, [...current, peer]);
}

export function removeSavedPeer(vaultData: VaultData, account: string, peer: string): VaultData {
  const current = vaultData.messagingSavedPeers?.[account] ?? [];
  if (!current.includes(peer)) return vaultData;
  return withPeers(
    vaultData,
    account,
    current.filter((saved) => saved !== peer),
  );
}
