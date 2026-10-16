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

function unexpired(entries: PendingNip47Authorization[], now: number): PendingNip47Authorization[] {
  return entries.filter((entry) => entry.expiresAt > now);
}

/** Records a new pending authorization, dropping expired ones and keeping only the newest few. */
export async function savePendingNip47Authorization(
  entry: Omit<PendingNip47Authorization, 'createdAt' | 'expiresAt'>,
  now: number = Date.now(),
): Promise<PendingNip47Authorization> {
  const pending: PendingNip47Authorization = {
    ...entry,
    createdAt: now,
    expiresAt: now + PENDING_AUTHORIZATION_TTL_MS,
  };
  const kept = unexpired(await readPending(), now)
    .filter((item) => item.pendingId !== entry.pendingId)
    .slice(-(MAX_PENDING_AUTHORIZATIONS - 1));
  await writePending([...kept, pending]);
  return pending;
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
  const entries = await readPending();
  const match = entries.find((entry) => entry.pendingId === pendingId);
  await writePending(unexpired(entries, now).filter((entry) => entry.pendingId !== pendingId));
  return match && match.expiresAt > now ? match : null;
}
