import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { CONTACT_SEARCH_LIMIT, searchCachedContacts } from '@/utils/contact-search';
import type { ContactProfile, Nip02Contact } from '@/types/contact-list';

const pk = (fill: string) => fill.repeat(64);
const ALEX = pk('a');
const BOB = pk('b');
const CALEB = pk('c');
const DANA = pk('d');

const contact = (pubkey: string, petname = ''): Nip02Contact => ({ pubkey, relayUrl: '', petname });
const profile = (pubkey: string, fields: Partial<ContactProfile>): ContactProfile => ({
  pubkey,
  name: '',
  displayName: '',
  about: '',
  picture: '',
  nip05: '',
  updatedAt: 1,
  ...fields,
});

const contacts = [contact(ALEX), contact(BOB, 'Bobby'), contact(CALEB), contact(DANA)];
const profiles = {
  [ALEX]: profile(ALEX, { displayName: 'Alex Brennan', name: 'alexb', nip05: 'alex@nostr.example' }),
  [CALEB]: profile(CALEB, { displayName: 'Caleb Moss', nip05: 'caleb@moss.dev' }),
  [DANA]: profile(DANA, { name: 'dana', nip05: 'd@halal.example' }),
};

describe('searchCachedContacts (#258)', () => {
  it('matches display name, name, petname and NIP-05', () => {
    expect(searchCachedContacts('brennan', contacts, profiles)).toEqual([ALEX]);
    expect(searchCachedContacts('alexb', contacts, profiles)).toEqual([ALEX]);
    expect(searchCachedContacts('bobby', contacts, profiles)).toEqual([BOB]);
    expect(searchCachedContacts('moss.dev', contacts, profiles)).toEqual([CALEB]);
  });

  it('ignores case and surrounding space', () => {
    expect(searchCachedContacts('  CALEB ', contacts, profiles)).toEqual([CALEB]);
  });

  it('ranks exact and word-start matches above matches inside a word', () => {
    // "al" starts Alex's names and sits inside Caleb's and Dana's NIP-05.
    expect(searchCachedContacts('al', contacts, profiles)).toEqual([ALEX, CALEB, DANA]);
  });

  it('finds a contact by full npub or hex key, and nobody else', () => {
    expect(searchCachedContacts(nip19.npubEncode(CALEB), contacts, profiles)).toEqual([CALEB]);
    expect(searchCachedContacts(DANA, contacts, profiles)).toEqual([DANA]);
    expect(searchCachedContacts(nip19.npubEncode(pk('e')), contacts, profiles)).toEqual([]);
  });

  it('matches the start of an npub', () => {
    const prefix = nip19.npubEncode(BOB).slice(0, 12);

    expect(searchCachedContacts(prefix, contacts, profiles)).toContain(BOB);
  });

  it('returns nothing for an empty query', () => {
    expect(searchCachedContacts('   ', contacts, profiles)).toEqual([]);
  });

  it('caps the results', () => {
    const many = Array.from({ length: CONTACT_SEARCH_LIMIT + 5 }, (_, index) =>
      contact(index.toString(16).padStart(64, '0'), `friend ${index}`),
    );

    expect(searchCachedContacts('friend', many, {})).toHaveLength(CONTACT_SEARCH_LIMIT);
  });
});
