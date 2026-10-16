import { nip19 } from 'nostr-tools';
import { normalizePubkey } from '@/services/contact-fetch';
import type { ContactProfile, Nip02Contact } from '@/types/contact-list';

/**
 * Finds contacts in the cached contact list (#258). Nothing here asks relays: Messaging searches the
 * people the account already follows, so results appear as the user types.
 */

export const CONTACT_SEARCH_LIMIT = 20;

/** Lower is better: exact matches, then matches at the start of a word, then anywhere. */
type Rank = 0 | 1 | 2;

function rankText(text: string, query: string): Rank | null {
  const value = text.trim().toLowerCase();
  if (!value) return null;
  if (value === query) return 0;
  if (value.startsWith(query) || value.split(/[\s@._-]+/).some((word) => word.startsWith(query)))
    return 1;
  if (value.includes(query)) return 2;
  return null;
}

function bestRank(ranks: (Rank | null)[]): Rank | null {
  const found = ranks.filter((rank): rank is Rank => rank !== null);
  return found.length > 0 ? (Math.min(...found) as Rank) : null;
}

function displayName(contact: Nip02Contact, profile?: ContactProfile): string {
  return profile?.displayName || profile?.name || contact.petname || contact.pubkey;
}

/**
 * The pubkeys of contacts matching `query`, best first. Matches display name, name, petname and
 * NIP-05 by text; a full npub or hex key matches that contact exactly, and an `npub1…` prefix matches
 * the start of a contact's npub.
 */
export function searchCachedContacts(
  query: string,
  contacts: readonly Nip02Contact[],
  profiles: Readonly<Record<string, ContactProfile>>,
  limit = CONTACT_SEARCH_LIMIT,
): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const exactPubkey = normalizePubkey(trimmed);
  if (exactPubkey) {
    return contacts.some((contact) => contact.pubkey === exactPubkey) ? [exactPubkey] : [];
  }

  const needle = trimmed.toLowerCase();
  const npubPrefix = needle.startsWith('npub1') ? needle : null;

  const matches: { pubkey: string; rank: Rank; name: string }[] = [];
  for (const contact of contacts) {
    const profile = profiles[contact.pubkey];
    const rank = npubPrefix
      ? nip19.npubEncode(contact.pubkey).startsWith(npubPrefix)
        ? 1
        : null
      : bestRank([
          rankText(profile?.displayName ?? '', needle),
          rankText(profile?.name ?? '', needle),
          rankText(contact.petname, needle),
          rankText(profile?.nip05 ?? '', needle),
        ]);
    if (rank !== null) {
      matches.push({
        pubkey: contact.pubkey,
        rank,
        name: displayName(contact, profile).toLowerCase(),
      });
    }
  }

  return matches
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((match) => match.pubkey);
}
