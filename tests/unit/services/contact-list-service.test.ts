import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import type { Event as NostrEvent } from 'nostr-tools';
import {
  buildContactListTags,
  getContactDisplayName,
  normalizePubkey,
  parseContactProfile,
  parseContactTags,
  validateContactInput,
} from '@/services/contact-list-service';
import type { Nip02Contact } from '@/types/contact-list';

const pubkeyOne = '0'.repeat(63) + '1';
const pubkeyTwo = '0'.repeat(63) + '2';
const pubkeyThree = '0'.repeat(63) + '3';

function createMetadataEvent(pubkey: string, content: string, createdAt = 100): NostrEvent {
  return {
    id: '1'.repeat(64),
    sig: '2'.repeat(128),
    kind: 0,
    tags: [],
    content,
    pubkey,
    created_at: createdAt,
  };
}

describe('contact-list-service', () => {
  describe('normalizePubkey', () => {
    it('normalizes hex pubkeys to lowercase', () => {
      expect(normalizePubkey(pubkeyOne.toUpperCase())).toBe(pubkeyOne);
    });

    it('normalizes npub values to hex pubkeys', () => {
      const npub = nip19.npubEncode(pubkeyTwo);

      expect(normalizePubkey(npub)).toBe(pubkeyTwo);
    });

    it('rejects invalid pubkeys', () => {
      expect(normalizePubkey('not-a-pubkey')).toBeNull();
      expect(normalizePubkey('f'.repeat(63))).toBeNull();
    });
  });

  describe('parseContactTags', () => {
    it('parses valid NIP-02 p tags in order', () => {
      const contacts = parseContactTags([
        ['p', pubkeyOne, 'wss://relay.one', 'alice'],
        ['e', 'ignored'],
        ['p', pubkeyTwo, '', 'bob'],
      ]);

      expect(contacts).toEqual<Nip02Contact[]>([
        { pubkey: pubkeyOne, relayUrl: 'wss://relay.one', petname: 'alice' },
        { pubkey: pubkeyTwo, relayUrl: '', petname: 'bob' },
      ]);
    });

    it('ignores invalid and duplicate p tags', () => {
      const contacts = parseContactTags([
        ['p'],
        ['p', 'bad-key', 'wss://relay.bad', 'bad'],
        ['p', pubkeyOne, 'wss://relay.one', 'alice'],
        ['p', pubkeyOne, 'wss://relay.duplicate', 'duplicate'],
      ]);

      expect(contacts).toEqual<Nip02Contact[]>([
        { pubkey: pubkeyOne, relayUrl: 'wss://relay.one', petname: 'alice' },
      ]);
    });
  });

  describe('buildContactListTags', () => {
    it('builds canonical NIP-02 p tags', () => {
      expect(
        buildContactListTags([
          { pubkey: pubkeyOne, relayUrl: ' wss://relay.one ', petname: ' alice ' },
          { pubkey: pubkeyTwo, relayUrl: '', petname: '' },
        ]),
      ).toEqual([
        ['p', pubkeyOne, 'wss://relay.one', 'alice'],
        ['p', pubkeyTwo, '', ''],
      ]);
    });
  });

  describe('parseContactProfile', () => {
    it('parses supported Nostr profile metadata fields', () => {
      const profile = parseContactProfile(
        createMetadataEvent(
          pubkeyOne,
          JSON.stringify({
            name: 'alice',
            display_name: 'Alice Example',
            about: 'Builder of useful Nostr things.',
            picture: 'https://example.com/alice.png',
            nip05: 'alice@example.com',
          }),
          123,
        ),
      );

      expect(profile).toEqual({
        pubkey: pubkeyOne,
        name: 'alice',
        displayName: 'Alice Example',
        about: 'Builder of useful Nostr things.',
        picture: 'https://example.com/alice.png',
        nip05: 'alice@example.com',
        updatedAt: 123,
      });
    });

    it('returns null for invalid profile metadata JSON', () => {
      expect(parseContactProfile(createMetadataEvent(pubkeyOne, '{broken'))).toBeNull();
    });

    it('ignores non-string profile metadata fields', () => {
      const profile = parseContactProfile(
        createMetadataEvent(pubkeyOne, JSON.stringify({ name: 123, display_name: 'Alice' })),
      );

      expect(profile?.name).toBe('');
      expect(profile?.displayName).toBe('Alice');
      expect(profile?.about).toBe('');
    });
  });

  describe('getContactDisplayName', () => {
    const contact: Nip02Contact = { pubkey: pubkeyOne, relayUrl: '', petname: 'local alice' };

    it('prefers profile display name over name and petname', () => {
      expect(
        getContactDisplayName(contact, {
          pubkey: pubkeyOne,
          name: 'alice',
          displayName: 'Alice Example',
          about: '',
          picture: '',
          nip05: '',
          updatedAt: 100,
        }),
      ).toBe('Alice Example');
    });

    it('falls back to profile name then petname then npub', () => {
      expect(
        getContactDisplayName(contact, {
          pubkey: pubkeyOne,
          name: 'alice',
          displayName: '',
          about: '',
          picture: '',
          nip05: '',
          updatedAt: 100,
        }),
      ).toBe('alice');

      expect(getContactDisplayName(contact)).toBe('local alice');
      expect(getContactDisplayName({ pubkey: pubkeyOne, relayUrl: '', petname: '' })).toBe(nip19.npubEncode(pubkeyOne));
    });
  });

  describe('validateContactInput', () => {
    it('accepts a valid hex pubkey and optional fields', () => {
      const result = validateContactInput(pubkeyOne, '', 'alice', []);

      expect(result.valid).toBe(true);
      expect(result.contact).toEqual<Nip02Contact>({
        pubkey: pubkeyOne,
        relayUrl: '',
        petname: 'alice',
      });
    });

    it('accepts and normalizes a valid relay URL', () => {
      const result = validateContactInput(pubkeyOne, ' wss://relay.example.com/ ', 'alice', []);

      expect(result.valid).toBe(true);
      expect(result.contact?.relayUrl).toBe('wss://relay.example.com');
    });

    it('rejects duplicate contacts', () => {
      const result = validateContactInput(pubkeyOne, '', '', [
        { pubkey: pubkeyOne, relayUrl: '', petname: '' },
      ]);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('already');
    });

    it('allows editing the original contact without treating it as duplicate', () => {
      const result = validateContactInput(
        pubkeyOne,
        '',
        'alice edited',
        [
          { pubkey: pubkeyOne, relayUrl: '', petname: 'alice' },
          { pubkey: pubkeyThree, relayUrl: '', petname: 'carol' },
        ],
        pubkeyOne,
      );

      expect(result.valid).toBe(true);
      expect(result.contact?.petname).toBe('alice edited');
    });

    it('rejects invalid relay URLs', () => {
      const result = validateContactInput(pubkeyOne, 'https://relay.example.com', '', []);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('protocols');
    });
  });
});
