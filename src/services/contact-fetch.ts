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

/*
 * Bounds on what a relay can make Porwr cache (workspace#182). The cache is unencrypted and filled
 * from whatever relays serve, so without them one malicious relay could grow it without limit.
 */
/** Contacts kept per account. Far above real follow lists; also bounds the profiles cached. */
export const MAX_CONTACTS_PER_ACCOUNT = 10_000;
/** A kind 0 whose content is longer, in UTF-8 bytes, is not parsed at all. */
export const MAX_PROFILE_CONTENT_LENGTH = 64 * 1024;
/** Names, display names and petnames are cut to this length. */
export const MAX_NAME_LENGTH = 256;
/** A profile's about text is cut to this length. */
export const MAX_ABOUT_LENGTH = 2000;
/** A longer picture, NIP-05 address or relay hint is dropped, since a cut one would be wrong. */
export const MAX_URL_LENGTH = 2048;

const HEX_PUBKEY_PATTERN = /^[0-9a-f]{64}$/i;

export type RelayReader = Pick<SimplePool, 'get' | 'querySync'>;

export function normalizePubkey(input: string): string | null {
  const trimmed = input.trim();

  if (HEX_PUBKEY_PATTERN.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  try {
    const decoded = nip19.decode(trimmed);
    if (
      decoded.type === 'npub' &&
      typeof decoded.data === 'string' &&
      HEX_PUBKEY_PATTERN.test(decoded.data)
    ) {
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

/**
 * Whether `content` is over `MAX_PROFILE_CONTENT_LENGTH` UTF-8 bytes. Each UTF-16 code unit is one
 * to three bytes, so the length alone settles most cases without encoding.
 */
function isOversizedContent(content: string): boolean {
  if (content.length > MAX_PROFILE_CONTENT_LENGTH) return true;
  if (content.length * 3 <= MAX_PROFILE_CONTENT_LENGTH) return false;
  return new TextEncoder().encode(content).length > MAX_PROFILE_CONTENT_LENGTH;
}

/**
 * `value` cut to `max` UTF-16 code units, for text that still reads correctly when shortened. A cut
 * that would leave half of a surrogate pair, such as an emoji, drops that half too.
 */
function capText(value: string, max: number): string {
  if (value.length <= max) return value;
  const last = value.charCodeAt(max - 1);
  return value.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

/** `value`, or nothing when it is too long: a shortened URL or address points somewhere else. */
function capUrl(value: string): string {
  return value.length > MAX_URL_LENGTH ? '' : value;
}

export function parseContactProfile(event: NostrEvent): ContactProfile | null {
  if (isOversizedContent(event.content)) {
    return null;
  }

  try {
    const parsed = JSON.parse(event.content) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const profile = parsed as Record<string, unknown>;

    return {
      pubkey: event.pubkey,
      name: capText(getStringField(profile, 'name'), MAX_NAME_LENGTH),
      displayName: capText(getStringField(profile, 'display_name'), MAX_NAME_LENGTH),
      about: capText(getStringField(profile, 'about'), MAX_ABOUT_LENGTH),
      picture: capUrl(getStringField(profile, 'picture')),
      nip05: capUrl(getStringField(profile, 'nip05')),
      updatedAt: event.created_at,
    };
  } catch {
    return null;
  }
}

export function parseContactTags(tags: string[][]): Nip02Contact[] {
  return parseContactTagsCapped(tags).contacts;
}

/**
 * The contacts in a kind 3's tags, at most `MAX_CONTACTS_PER_ACCOUNT` of them. `truncated` says that
 * more were dropped, so the list must not be published back as it stands.
 */
export function parseContactTagsCapped(tags: string[][]): {
  contacts: Nip02Contact[];
  truncated: boolean;
} {
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

    if (contacts.length === MAX_CONTACTS_PER_ACCOUNT) {
      return { contacts, truncated: true };
    }

    const relayUrl = capUrl(rawRelayUrl.trim());
    const petname = capText(rawPetname.trim(), MAX_NAME_LENGTH);

    contacts.push({ pubkey, relayUrl, petname });
    seen.add(pubkey);
  }

  return { contacts, truncated: false };
}

/** The account's newest kind 3 on `relays`, parsed. No event means no published list. */
export async function fetchContactListSnapshot(
  pool: RelayReader,
  relays: string[],
  accountPubkey: string,
): Promise<ContactListSnapshot> {
  // `pool.get` over no relays never settles; no relay means no list could be read (#142).
  if (relays.length === 0) return { contacts: [] };
  const event = await pool.get(
    relays,
    { authors: [accountPubkey], kinds: [CONTACT_LIST_KIND] },
    { maxWait: RELAY_MAX_WAIT_MS },
  );

  if (!event) {
    return { contacts: [] };
  }

  const { contacts, truncated } = parseContactTagsCapped(event.tags);
  const snapshot: ContactListSnapshot = {
    contacts,
    sourceEventId: event.id,
    sourceCreatedAt: event.created_at,
  };
  if (truncated) snapshot.truncated = true;
  return snapshot;
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

  await Promise.all(
    Array.from({ length: Math.min(PROFILE_BATCH_CONCURRENCY, queue.length) }, worker),
  );
  return profiles;
}
