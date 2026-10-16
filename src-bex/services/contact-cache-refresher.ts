import { SimplePool } from 'nostr-tools';

import { LogLevel, logService } from '@/services/log-service';
import { fetchContactListSnapshot, fetchProfilesInBatches } from '@/services/contact-fetch';
import {
  isStale,
  pruneProfiles,
  readContactList,
  upsertProfiles,
  writeContactList,
} from '@/services/contact-cache';
import { getFallbackRelays } from './messaging-relays';

/**
 * Keeps the contact cache filled from relays, in the background (#257).
 *
 * Runs when the worker starts with the vault unlocked, when the vault unlocks, when the active
 * account changes, and when a page asks. Pages never wait on it: they read the cache and Dexie tells
 * them when this writes. Each step is written as it lands, so a worker stopped mid-refresh keeps
 * whatever it already fetched and the next trigger finishes the job.
 */

const pool = new SimplePool();
const inFlight = new Map<string, Promise<void>>();
const queued = new Map<string, Promise<void>>();

export interface RefreshOptions {
  /** Ignore the cache's age, as the Refresh button does. */
  force?: boolean;
}

async function refresh(accountPubkey: string, options: RefreshOptions): Promise<void> {
  if (!options.force) {
    const cached = await readContactList(accountPubkey);
    if (cached && !isStale(cached.fetchedAt)) return;
  }

  const relays = await getFallbackRelays();
  await writeContactList(
    accountPubkey,
    await fetchContactListSnapshot(pool, relays, accountPubkey),
  );

  // Read back rather than using the fetch: a publish made meanwhile may have won.
  const contacts = (await readContactList(accountPubkey))?.contacts ?? [];
  const pubkeys = contacts.map((contact) => contact.pubkey);

  await fetchProfilesInBatches(pool, relays, pubkeys, (profiles) =>
    upsertProfiles(accountPubkey, Object.values(profiles)),
  );
  await pruneProfiles(accountPubkey, pubkeys);
}

/**
 * Refreshes one account's contacts. Concurrent calls for the same account share one run, so a
 * worker start, an unlock and a page open arriving together ask relays once. A forced call that
 * arrives mid-run may have been made because something changed after that run began, so it gets one
 * more run once the current one ends; further forced calls meanwhile share that one.
 */
export function refreshContacts(
  accountPubkey: string,
  options: RefreshOptions = {},
): Promise<void> {
  const running = inFlight.get(accountPubkey);
  if (!running) return start(accountPubkey, options);
  if (!options.force) return running;

  let next = queued.get(accountPubkey);
  if (!next) {
    next = running
      .catch(() => undefined)
      .then(() => {
        queued.delete(accountPubkey);
        return refreshContacts(accountPubkey, { force: true });
      });
    queued.set(accountPubkey, next);
  }
  return next;
}

function start(accountPubkey: string, options: RefreshOptions): Promise<void> {
  const run = refresh(accountPubkey, options).finally(() => {
    inFlight.delete(accountPubkey);
  });
  inFlight.set(accountPubkey, run);
  return run;
}

/** Starts a refresh without waiting for it, logging rather than throwing if it fails. */
export function refreshContactsInBackground(
  accountPubkey: string,
  options: RefreshOptions = {},
): void {
  void refreshContacts(accountPubkey, options).catch((error: unknown) => {
    logService.log(LogLevel.WARN, '[ContactCache] Refresh failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
