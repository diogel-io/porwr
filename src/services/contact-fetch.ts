import { nip19 } from 'nostr-tools';
import type { Event as NostrEvent, SimplePool } from 'nostr-tools';
import type { ContactListSnapshot, ContactProfile, Nip02Contact } from '@/types/contact-list';

/**
 * Reading contact lists and profiles from relays.
 *
 * Shared by the extension's pages and the background, which keeps the contact cache filled (#257).
 * Nothing here reads settings or Pinia: the caller supplies the relays and the pool, because the
 * background cannot use the settings store.
 */

export const CONTACT_LIST_KIND = 3;
export const PROFILE_METADATA_KIND = 0;

/** Authors asked for in one profile query. Small enough that one slow chunk holds up few contacts. */
export const PROFILE_BATCH_SIZE = 25;
/** Profile queries in flight at once; relays limit concurrent subscriptions per connection. */
export const PROFILE_BATCH_CONCURRENCY = 4;
const RELAY_MAX_WAIT_MS = 5000;

const HEX_PUBKEY_PATTERN = /^[0-9a-f]{64}$/i;

export type RelayReader = Pick<SimplePool, 'get' | 'querySync'>;

export function normalizePubkey(input: string): string | null {
  const trimmed = input.trim();

  if (HEX_PUBKEY_PATTERN.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === 'npub' && typeof decoded.data === 'string' && HEX_PUBKEY_PATTERN.test(decoded.data)) {
      return decoded.data.toLowerCase();
    }
  } catch {
    return null;
  }

  return null;
}

export function isHexPubkey(value: string): boolean {
  return HEX_PUBKEY_PATTERN.test(value);
}

function getStringField(value: Record<string, unknown>, field: string): string {
  const fieldValue = value[field];
  return typeof fieldValue === 'string' ? fieldValue.trim() : '';
}

export function parseContactProfile(event: NostrEvent): ContactProfile | null {
  try {
    const parsed = JSON.parse(event.content) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const profile = parsed as Record<string, unknown>;

    return {
      pubkey: event.pubkey,
      name: getStringField(profile, 'name'),
      displayName: getStringField(profile, 'display_name'),
      about: getStringField(profile, 'about'),
      picture: getStringField(profile, 'picture'),
      nip05: getStringField(profile, 'nip05'),
      updatedAt: event.created_at,
    };
  } catch {
    return null;
  }
}

export function parseContactTags(tags: string[][]): Nip02Contact[] {
  const seen = new Set<string>();
  const contacts: Nip02Contact[] = [];

  for (const tag of tags) {
    const [name, rawPubkey, rawRelayUrl = '', rawPetname = ''] = tag;
    if (name !== 'p' || !rawPubkey) {
      continue;
    }

    const pubkey = normalizePubkey(rawPubkey);
    if (!pubkey || seen.has(pubkey)) {
      continue;
    }

    const relayUrl = rawRelayUrl.trim();
    const petname = rawPetname.trim();

    contacts.push({ pubkey, relayUrl, petname });
    seen.add(pubkey);
  }

  return contacts;
}

/** The account's newest kind 3 on `relays`, parsed. No event means no published list. */
export async function fetchContactListSnapshot(
  pool: RelayReader,
  relays: string[],
  accountPubkey: string,
): Promise<ContactListSnapshot> {
  const event = await pool.get(
    relays,
    { authors: [accountPubkey], kinds: [CONTACT_LIST_KIND] },
    { maxWait: RELAY_MAX_WAIT_MS },
  );

  if (!event) {
    return { contacts: [] };
  }

  return {
    contacts: parseContactTags(event.tags),
    sourceEventId: event.id,
    sourceCreatedAt: event.created_at,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** The newest profile per author among `events`. */
function newestProfiles(events: NostrEvent[]): Record<string, ContactProfile> {
  const profiles: Record<string, ContactProfile> = {};
  for (const event of events) {
    const profile = parseContactProfile(event);
    if (!profile) continue;
    const existing = profiles[profile.pubkey];
    if (!existing || profile.updatedAt > existing.updatedAt) {
      profiles[profile.pubkey] = profile;
    }
  }
  return profiles;
}

/**
 * Kind 0 profiles for `pubkeys`, asked for in batches.
 *
 * One query for every contact waits on the slowest relay for all of them; batches let each chunk
 * land as soon as it is answered. `onBatch` sees each chunk's profiles as it arrives. A chunk that
 * fails is skipped: a missing profile only means a contact shows as an npub.
 */
export async function fetchProfilesInBatches(
  pool: RelayReader,
  relays: string[],
  pubkeys: string[],
  onBatch?: (profiles: Record<string, ContactProfile>) => void | Promise<void>,
): Promise<Record<string, ContactProfile>> {
  const unique = Array.from(new Set(pubkeys.filter(isHexPubkey)));
  if (unique.length === 0 || relays.length === 0) {
    return {};
  }

  const queue = chunk(unique, PROFILE_BATCH_SIZE);
  const profiles: Record<string, ContactProfile> = {};

  const worker = async (): Promise<void> => {
    for (let batch = queue.shift(); batch; batch = queue.shift()) {
      try {
        const events = await pool.querySync(
          relays,
          { authors: batch, kinds: [PROFILE_METADATA_KIND], limit: batch.length },
          { maxWait: RELAY_MAX_WAIT_MS },
        );
        const found = newestProfiles(events);
        Object.assign(profiles, found);
        if (onBatch && Object.keys(found).length > 0) {
          await onBatch(found);
        }
      } catch {
        // Best-effort: the other batches still land.
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(PROFILE_BATCH_CONCURRENCY, queue.length) }, worker));
  return profiles;
}
