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
  /**
   * Set while the background settles a background-owned authorization (workspace#85). The entry
   * stays stored until the result is final, so a background that is suspended or restarted
   * meanwhile still finds it, and cancelling can still close its popup.
   */
  claimed?: boolean;
}

export interface PendingNip47AuthorizationPopup {
  windowId: number;
  tabId: number;
  /** Ties the outcome to the Wallet Connections request that asked for it (`wallet-connect-channel`). */
  requestId: string;
}

export const PENDING_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
/** How long a claimed authorization may take to settle: the wallet's answer and the vault write. */
export const CLAIMED_AUTHORIZATION_GRACE_MS = 2 * 60 * 1000;
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

let expiredPopupListener: ((expired: PendingNip47Authorization[]) => void) | null = null;

/**
 * Called with expired entries that owned a background-opened popup, whenever a write drops them, so
 * the popup can be closed rather than outlive its authorization (workspace#85).
 */
export function onExpiredPendingNip47Popups(
  listener: (expired: PendingNip47Authorization[]) => void,
): void {
  expiredPopupListener = listener;
}

/** `unexpired`, for a write: the expired entries it drops are reported if they owned a popup. */
function dropExpired(
  entries: PendingNip47Authorization[],
  now: number,
): PendingNip47Authorization[] {
  const expiredWithPopup = entries.filter((entry) => entry.expiresAt <= now && entry.popup);
  if (expiredWithPopup.length > 0) {
    expiredPopupListener?.(expiredWithPopup);
  }
  return unexpired(entries, now);
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
    const others = dropExpired(await readPending(), now).filter(
      (item) => item.pendingId !== entry.pendingId,
    );
    // Room is made from the oldest unclaimed entries only: a claimed one is being settled, and is
    // removed once its result is final (workspace#85).
    const keep = MAX_PENDING_AUTHORIZATIONS - 1;
    const evictable = others.filter((item) => !item.claimed);
    const evicted = evictable.slice(0, Math.max(0, others.length - keep));
    await writePending([...others.filter((item) => !evicted.includes(item)), pending]);
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
 * `when` is checked against the stored entry in the same serialized step; an entry it rejects is
 * left in place and `null` returned. A cancel uses it so it cannot remove an entry whose claim
 * changed a moment before (workspace#85).
 *
 * @returns The entry, or `null` when it does not exist or has expired.
 */
export async function takePendingNip47Authorization(
  pendingId: string,
  now: number = Date.now(),
  { when }: { when?: (entry: PendingNip47Authorization) => boolean } = {},
): Promise<PendingNip47Authorization | null> {
  return serialized(async () => {
    const entries = await readPending();
    const match = entries.find((entry) => entry.pendingId === pendingId);
    if (match && when && !when(match)) {
      return null;
    }
    await writePending(dropExpired(entries, now).filter((entry) => entry.pendingId !== pendingId));
    return match && match.expiresAt > now ? match : null;
  });
}

/**
 * Marks a background-owned authorization as being settled, and keeps it stored until the caller
 * removes it with `takePendingNip47Authorization` (workspace#85). Only one caller can claim an
 * entry. Its expiry is pushed out by `CLAIMED_AUTHORIZATION_GRACE_MS`, so settling is not cut off.
 *
 * `abandoned` is asked, inside the same serialized step, whether an existing claim was left by a
 * background that has since restarted; such a claim can be taken over, so its work resumes.
 *
 * @returns The entry, or `null` when it does not exist, has expired, or is claimed by live work.
 */
export async function claimPendingNip47Authorization(
  pendingId: string,
  now: number = Date.now(),
  abandoned: (pendingId: string) => boolean = () => false,
): Promise<PendingNip47Authorization | null> {
  return serialized(async () => {
    const entries = dropExpired(await readPending(), now);
    const index = entries.findIndex((entry) => entry.pendingId === pendingId);
    const entry = entries[index];
    if (!entry || (entry.claimed && !abandoned(pendingId))) {
      return null;
    }
    const claimed: PendingNip47Authorization = {
      ...entry,
      claimed: true,
      expiresAt: Math.max(entry.expiresAt, now + CLAIMED_AUTHORIZATION_GRACE_MS),
    };
    entries[index] = claimed;
    await writePending(entries);
    return claimed;
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
    const entries = dropExpired(await readPending(), now);
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
 * `includeExpired` also finds one that has expired but is still stored, so cancelling it can close
 * its popup.
 *
 * @returns The entry, or `null` when no unexpired authorization owns that popup.
 */
export async function findPendingNip47AuthorizationByPopup(
  match: { windowId: number } | { tabId: number } | { requestId: string },
  now: number = Date.now(),
  { includeExpired = false }: { includeExpired?: boolean } = {},
): Promise<PendingNip47Authorization | null> {
  const stored = await readPending();
  const entries = includeExpired ? stored : unexpired(stored, now);
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
