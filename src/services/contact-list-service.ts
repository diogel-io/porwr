import { nip19, SimplePool } from 'nostr-tools';
import type { Event as NostrEvent } from 'nostr-tools';
import { signAsAccount } from '@/services/account-signing-client';
import type { StoredKey } from '@/types';
import type {
  ContactInputValidationResult,
  ContactListPublishResult,
  ContactListState,
  ContactListRelayPublishResult,
  ContactProfile,
  ContactSearchResult,
  Nip02Contact,
} from '@/types/contact-list';
import useSettingsStore from '@/stores/settings-store';
import { normalizeRelayUrl } from '@/services/relay-url';
import { parseNip05Identifier } from '@/services/nip05-service';

const CONTACT_LIST_KIND = 3;
const PROFILE_METADATA_KIND = 0;
const HEX_PUBKEY_PATTERN = /^[0-9a-f]{64}$/i;
const pool = new SimplePool();

function getAccountPubkey(storedKey: StoredKey): string {
  return storedKey.id;
}

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

export function formatContactNpub(pubkey: string): string {
  return nip19.npubEncode(pubkey);
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

export function getContactDisplayName(contact: Nip02Contact, profile?: ContactProfile): string {
  return profile?.displayName || profile?.name || contact.petname || formatContactNpub(contact.pubkey);
}

function mergeSearchResult(
  results: Map<string, ContactSearchResult>,
  result: ContactSearchResult,
): void {
  const existing = results.get(result.pubkey);
  if (!existing) {
    results.set(result.pubkey, result);
    return;
  }

  if (!existing.profile && result.profile) {
    results.set(result.pubkey, result);
  }
}

async function resolveNip05Pubkey(identifier: string): Promise<string | null> {
  const parsed = parseNip05Identifier(identifier);
  if (!parsed) {
    return null;
  }

  const url = new URL(`https://${parsed.domain}/.well-known/nostr.json`);
  url.searchParams.set('name', parsed.name);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  const json = (await response.json()) as unknown;
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return null;
  }

  const names = (json as Record<string, unknown>).names;
  if (!names || typeof names !== 'object' || Array.isArray(names)) {
    return null;
  }

  const pubkey = (names as Record<string, unknown>)[parsed.name];
  return typeof pubkey === 'string' ? normalizePubkey(pubkey) : null;
}

export async function searchContacts(query: string): Promise<ContactSearchResult[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }

  const settingsStore = useSettingsStore();
  const relays = await settingsStore.getProfileSearchRelays();
  const results = new Map<string, ContactSearchResult>();
  const directPubkey = normalizePubkey(trimmedQuery);

  if (directPubkey) {
    const profile = (await fetchContactProfiles([directPubkey]))[directPubkey];
    const result: ContactSearchResult = {
      pubkey: directPubkey,
      relayUrl: '',
      matchType: 'pubkey',
    };
    if (profile) {
      result.profile = profile;
    }
    mergeSearchResult(results, result);
  }

  if (parseNip05Identifier(trimmedQuery)) {
    try {
      const pubkey = await resolveNip05Pubkey(trimmedQuery);
      if (pubkey) {
        const existingProfile = (await fetchContactProfiles([pubkey]))[pubkey];
        const profile = existingProfile
          ? {
              ...existingProfile,
              nip05: existingProfile.nip05 || trimmedQuery,
            }
          : {
              pubkey,
              name: '',
              displayName: '',
              about: '',
              picture: '',
              nip05: trimmedQuery,
              updatedAt: 0,
            };

        mergeSearchResult(results, {
          pubkey,
          relayUrl: '',
          profile,
          matchType: 'nip05',
        });
      }
    } catch {
      // NIP-05 lookup is best-effort; relay profile search may still return matches.
    }
  }

  const events = await pool.querySync(
    relays,
    {
      kinds: [PROFILE_METADATA_KIND],
      search: trimmedQuery,
      limit: 20,
    },
    { maxWait: 5000 },
  );

  for (const event of events) {
    const profile = parseContactProfile(event);
    if (!profile) {
      continue;
    }

    mergeSearchResult(results, {
      pubkey: profile.pubkey,
      relayUrl: '',
      profile,
      matchType: 'profile-search',
    });
  }

  return Array.from(results.values()).sort((left, right) => {
    const leftName = left.profile?.displayName || left.profile?.name || left.profile?.nip05 || left.pubkey;
    const rightName = right.profile?.displayName || right.profile?.name || right.profile?.nip05 || right.pubkey;
    return leftName.localeCompare(rightName);
  });
}

export async function fetchContactProfiles(pubkeys: string[]): Promise<Record<string, ContactProfile>> {
  const uniquePubkeys = Array.from(new Set(pubkeys.filter((pubkey) => HEX_PUBKEY_PATTERN.test(pubkey))));
  if (uniquePubkeys.length === 0) {
    return {};
  }

  const settingsStore = useSettingsStore();
  const relays = await settingsStore.getFallbackRelays();
  const events = await pool.querySync(
    relays,
    {
      authors: uniquePubkeys,
      kinds: [PROFILE_METADATA_KIND],
      limit: uniquePubkeys.length,
    },
    { maxWait: 5000 },
  );

  const profiles: Record<string, ContactProfile> = {};

  for (const event of events) {
    const profile = parseContactProfile(event);
    if (!profile) {
      continue;
    }

    const existing = profiles[profile.pubkey];
    if (!existing || profile.updatedAt > existing.updatedAt) {
      profiles[profile.pubkey] = profile;
    }
  }

  return profiles;
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

export function buildContactListTags(contacts: Nip02Contact[]): string[][] {
  return contacts.map((contact) => ['p', contact.pubkey, contact.relayUrl.trim(), contact.petname.trim()]);
}

export function validateContactInput(
  pubkeyInput: string,
  relayUrlInput: string,
  petnameInput: string,
  existingContacts: Nip02Contact[],
  originalPubkey?: string,
): ContactInputValidationResult {
  const pubkey = normalizePubkey(pubkeyInput);
  if (!pubkey) {
    return { valid: false, error: 'Enter a valid hex pubkey or npub.' };
  }

  const duplicate = existingContacts.some((contact) => contact.pubkey === pubkey && contact.pubkey !== originalPubkey);
  if (duplicate) {
    return { valid: false, error: 'This contact is already in the list.' };
  }

  const relayUrl = relayUrlInput.trim();
  if (relayUrl) {
    const relayResult = normalizeRelayUrl(relayUrl);
    if (!relayResult.valid || !relayResult.url) {
      return { valid: false, error: relayResult.error ?? 'Enter a valid relay URL.' };
    }

    return {
      valid: true,
      contact: {
        pubkey,
        relayUrl: relayResult.url,
        petname: petnameInput.trim(),
      },
    };
  }

  return {
    valid: true,
    contact: {
      pubkey,
      relayUrl: '',
      petname: petnameInput.trim(),
    },
  };
}

export async function fetchContactList(storedKey: StoredKey): Promise<ContactListState> {
  const settingsStore = useSettingsStore();
  const relays = await settingsStore.getFallbackRelays();
  const pubkey = getAccountPubkey(storedKey);

  const event = await pool.get(relays, {
    authors: [pubkey],
    kinds: [CONTACT_LIST_KIND],
  });

  const state: ContactListState = {
    accountAlias: storedKey.alias,
    pubkey,
    contacts: event ? parseContactTags(event.tags) : [],
    dirty: false,
  };

  if (event) {
    state.sourceEventId = event.id;
    state.sourceCreatedAt = event.created_at;
  }

  return state;
}

function settlePublishResult(relayUrl: string, result: Promise<string>): Promise<ContactListRelayPublishResult> {
  return result
    .then(() => ({ relayUrl, success: true }))
    .catch((error: unknown) => ({
      relayUrl,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }));
}

export async function publishContactList(
  accountPubkey: string,
  contacts: Nip02Contact[],
): Promise<ContactListPublishResult> {
  const settingsStore = useSettingsStore();
  const relays = await settingsStore.getFallbackRelays();

  // Signed in the background, which holds the key (#240).
  const signedEvent: NostrEvent = await signAsAccount(accountPubkey, {
    kind: CONTACT_LIST_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: buildContactListTags(contacts),
    content: '',
  });

  const publishResults = pool.publish(relays, signedEvent);
  const relayResults = await Promise.all(
    relays.map((relayUrl, index) => settlePublishResult(relayUrl, publishResults[index] ?? Promise.reject(new Error('Publish was not attempted.')))),
  );

  if (!relayResults.some((result) => result.success)) {
    throw new Error('Failed to publish contact list to any relay.');
  }

  return {
    event: signedEvent,
    relayResults,
  };
}
