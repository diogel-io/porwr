import { NIP47_PENDING_AUTHORIZATIONS_KEY, storageService } from '@/services/storage-service';
import type { WalletProviderId } from '@/types/wallet-provider';

/**
 * Client secrets for wallet connections the user is still approving in a wallet's popup (#110).
 *
 * The secret is generated here, in the background, and never sent to a page. It waits in
 * `chrome.storage.session` rather than in memory because signing in to the wallet can take longer
 * than the service worker stays alive. Session storage is held in memory by the browser, is
 * restricted to Porwr's own contexts (`lockDownSessionStorage` in `background.ts`), and is cleared
 * when the browser closes, so an unapproved secret never reaches disk.
 */
export interface PendingNip47Authorization {
  pendingId: string;
  /** The account the connection is for, fixed when the popup opened (#304). */
  accountPubkey: string;
  providerId: WalletProviderId;
  origin: string;
  clientSecret: string;
  clientPubkey: string;
  createdAt: number;
  expiresAt: number;
  /**
   * The wallet popup the background opened for this authorization, in Firefox (workspace#85). Set
   * only when the background, not a Porwr page, owns the popup.
   */
  popup?: PendingNip47AuthorizationPopup;
}

export interface PendingNip47AuthorizationPopup {
  windowId: number;
  tabId: number;
  /** Ties the outcome to the Wallet Connections request that asked for it (`wallet-connect-channel`). */
  requestId: string;
}

export const PENDING_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_AUTHORIZATIONS = 5;

async function readPending(): Promise<PendingNip47Authorization[]> {
  const stored = await storageService.get<PendingNip47Authorization[]>(
    NIP47_PENDING_AUTHORIZATIONS_KEY,
    'session',
  );
  return Array.isArray(stored) ? stored : [];
}

async function writePending(entries: PendingNip47Authorization[]): Promise<void> {
  if (entries.length === 0) {
    await storageService.remove(NIP47_PENDING_AUTHORIZATIONS_KEY, 'session');
    return;
  }
  await storageService.set(NIP47_PENDING_AUTHORIZATIONS_KEY, entries, 'session');
}

// Each read-modify-write waits for the one before it. The wallet popup closing and the wallet's
// relayed answer can arrive together, and without this both could read the entry before either
// removed it, so both would settle the same authorization (workspace#85).
let pendingWrites: Promise<unknown> = Promise.resolve();

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingWrites.then(operation, operation);
  pendingWrites = result.catch(() => undefined);
  return result;
}

function unexpired(entries: PendingNip47Authorization[], now: number): PendingNip47Authorization[] {
  return entries.filter((entry) => entry.expiresAt > now);
}

/**
 * Records a new pending authorization, dropping expired ones and keeping only the newest few.
 *
 * `onEvicted` is given the unexpired entries pushed out to make room, so a popup the background
 * opened for one of them can be closed and its outcome reported rather than left open (workspace#85).
 */
export async function savePendingNip47Authorization(
  entry: Omit<PendingNip47Authorization, 'createdAt' | 'expiresAt'>,
  now: number = Date.now(),
  onEvicted?: (evicted: PendingNip47Authorization[]) => void,
): Promise<PendingNip47Authorization> {
  return serialized(async () => {
    const pending: PendingNip47Authorization = {
      ...entry,
      createdAt: now,
      expiresAt: now + PENDING_AUTHORIZATION_TTL_MS,
    };
    const others = unexpired(await readPending(), now).filter(
      (item) => item.pendingId !== entry.pendingId,
    );
    const keep = MAX_PENDING_AUTHORIZATIONS - 1;
    const evicted = others.length > keep ? others.slice(0, others.length - keep) : [];
    await writePending([...others.slice(-keep), pending]);
    if (evicted.length > 0) {
      onEvicted?.(evicted);
    }
    return pending;
  });
}

/**
 * Removes and returns a pending authorization. It is single use: whatever happens next, a second
 * completion for the same id finds nothing.
 *
 * @returns The entry, or `null` when it does not exist or has expired.
 */
export async function takePendingNip47Authorization(
  pendingId: string,
  now: number = Date.now(),
): Promise<PendingNip47Authorization | null> {
  return serialized(async () => {
    const entries = await readPending();
    const match = entries.find((entry) => entry.pendingId === pendingId);
    await writePending(unexpired(entries, now).filter((entry) => entry.pendingId !== pendingId));
    return match && match.expiresAt > now ? match : null;
  });
}

/**
 * Records the popup the background opened for a pending authorization (workspace#85).
 *
 * @returns Whether the entry was still pending. A lock or an expiry may have removed it while the
 * popup was opening.
 */
export async function bindPendingNip47AuthorizationPopup(
  pendingId: string,
  popup: PendingNip47AuthorizationPopup,
  now: number = Date.now(),
): Promise<boolean> {
  return serialized(async () => {
    const entries = unexpired(await readPending(), now);
    const index = entries.findIndex((entry) => entry.pendingId === pendingId);
    if (index === -1) {
      return false;
    }
    entries[index] = { ...entries[index]!, popup };
    await writePending(entries);
    return true;
  });
}

/**
 * Finds the pending authorization whose background-owned popup matches, without removing it.
 *
 * @returns The entry, or `null` when no unexpired authorization owns that popup.
 */
export async function findPendingNip47AuthorizationByPopup(
  match: { windowId: number } | { tabId: number } | { requestId: string },
  now: number = Date.now(),
): Promise<PendingNip47Authorization | null> {
  const entries = unexpired(await readPending(), now);
  return (
    entries.find((entry) =>
      'windowId' in match
        ? entry.popup?.windowId === match.windowId
        : 'tabId' in match
          ? entry.popup?.tabId === match.tabId
          : entry.popup?.requestId === match.requestId,
    ) ?? null
  );
}

/**
 * Discards every pending authorization. Runs when the vault locks: a wallet approval the user
 * started while unlocked is not finished on a locked vault, and its client secret should not wait
 * out its TTL in session storage (diogel-io/workspace#142, T22).
 *
 * @returns The entries removed, so the caller can close any popup the background opened for them.
 */
export async function clearPendingNip47Authorizations(): Promise<PendingNip47Authorization[]> {
  return serialized(async () => {
    const entries = await readPending();
    await writePending([]);
    return entries;
  });
}
