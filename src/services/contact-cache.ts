import { liveQuery } from 'dexie';
import { db } from '@/services/database';
import type {
  CachedContactList,
  CachedContactProfile,
  ContactListSnapshot,
  ContactProfile,
} from '@/types/contact-list';

/**
 * The contact cache: each account's contact list and its contacts' profiles (#257).
 *
 * The background fills it and pages read it, so Contacts and Messaging show contacts without
 * waiting on relays. Both sides share the one IndexedDB, and Dexie tells every open page about a
 * write wherever it happened.
 *
 * Everything here is public Nostr data, stored unencrypted and keyed by account public key. It does
 * reveal which accounts live on this device while the vault is locked; PRIVACY.md says so.
 */

/**
 * How long a cached list counts as fresh for the background's own triggers — worker start, unlock,
 * account change — which often arrive together. A page opening always revalidates.
 */
export const CONTACT_CACHE_TTL_MS = 5 * 60 * 1000;

export interface ContactCacheSnapshot {
  /** Absent until relays have been asked once for this account. */
  list: CachedContactList | undefined;
  profiles: Record<string, ContactProfile>;
}

function toProfile(cached: CachedContactProfile): ContactProfile {
  return {
    pubkey: cached.pubkey,
    name: cached.name,
    displayName: cached.displayName,
    about: cached.about,
    picture: cached.picture,
    nip05: cached.nip05,
    updatedAt: cached.updatedAt,
  };
}

export function isStale(fetchedAt: number, now = Date.now(), ttl = CONTACT_CACHE_TTL_MS): boolean {
  return now - fetchedAt >= ttl;
}

export async function readContactList(accountPubkey: string): Promise<CachedContactList | undefined> {
  return db.contactLists.get(accountPubkey);
}

export async function readContactCache(accountPubkey: string): Promise<ContactCacheSnapshot> {
  const [list, rows] = await Promise.all([
    db.contactLists.get(accountPubkey),
    db.contactProfiles.where('accountPubkey').equals(accountPubkey).toArray(),
  ]);

  const profiles: Record<string, ContactProfile> = {};
  for (const row of rows) {
    profiles[row.pubkey] = toProfile(row);
  }
  return { list, profiles };
}

/**
 * Stores a contact list unless the cache already holds a newer one.
 *
 * A slow relay can answer with the list from before a publish; that must not undo the publish. An
 * older or missing answer still marks the list as checked, so pages stop asking. Returns whether the
 * contacts were replaced.
 */
export async function writeContactList(
  accountPubkey: string,
  snapshot: ContactListSnapshot,
  now = Date.now(),
): Promise<boolean> {
  return db.transaction('rw', db.contactLists, async () => {
    const existing = await db.contactLists.get(accountPubkey);
    const incomingAt = snapshot.sourceCreatedAt ?? 0;
    const existingAt = existing?.sourceCreatedAt ?? 0;

    if (existing && existingAt > incomingAt) {
      await db.contactLists.put({ ...existing, fetchedAt: now });
      return false;
    }

    if (existing && existing.sourceCreatedAt !== undefined && snapshot.sourceCreatedAt === undefined) {
      // Relays had nothing, but we hold a list we saw published: keep it.
      await db.contactLists.put({ ...existing, fetchedAt: now });
      return false;
    }

    const next: CachedContactList = {
      accountPubkey,
      contacts: snapshot.contacts.map((contact) => ({ ...contact })),
      fetchedAt: now,
    };
    if (snapshot.sourceEventId !== undefined) next.sourceEventId = snapshot.sourceEventId;
    if (snapshot.sourceCreatedAt !== undefined) next.sourceCreatedAt = snapshot.sourceCreatedAt;

    await db.contactLists.put(next);
    return true;
  });
}

/** Stores profiles for an account's contacts, keeping whichever version of each is newest. */
export async function upsertProfiles(
  accountPubkey: string,
  profiles: ContactProfile[],
  now = Date.now(),
): Promise<void> {
  if (profiles.length === 0) return;

  await db.transaction('rw', db.contactProfiles, async () => {
    const keys = profiles.map((profile): [string, string] => [accountPubkey, profile.pubkey]);
    const existing = await db.contactProfiles.bulkGet(keys);

    const rows: CachedContactProfile[] = [];
    profiles.forEach((profile, index) => {
      const current = existing[index];
      if (current && current.updatedAt > profile.updatedAt) return;
      rows.push({ ...profile, accountPubkey, fetchedAt: now });
    });

    if (rows.length > 0) {
      await db.contactProfiles.bulkPut(rows);
    }
  });
}

/** Drops cached profiles of people the account no longer follows. */
export async function pruneProfiles(accountPubkey: string, keepPubkeys: readonly string[]): Promise<void> {
  const keep = new Set(keepPubkeys);
  await db.contactProfiles
    .where('accountPubkey')
    .equals(accountPubkey)
    .filter((row) => !keep.has(row.pubkey))
    .delete();
}

/** Forgets everything cached for an account, for when it leaves the vault. */
export async function clearAccount(accountPubkey: string): Promise<void> {
  await db.transaction('rw', db.contactLists, db.contactProfiles, async () => {
    await db.contactLists.delete(accountPubkey);
    await db.contactProfiles.where('accountPubkey').equals(accountPubkey).delete();
  });
}

/**
 * Calls `onChange` with the account's cache now and after every change to it, from any context.
 * Returns the function that stops watching.
 */
export function observeContactCache(
  accountPubkey: string,
  onChange: (snapshot: ContactCacheSnapshot) => void,
  onError?: (error: unknown) => void,
): () => void {
  const subscription = liveQuery(() => readContactCache(accountPubkey)).subscribe({
    next: onChange,
    error: (error: unknown) => onError?.(error),
  });
  return () => subscription.unsubscribe();
}
