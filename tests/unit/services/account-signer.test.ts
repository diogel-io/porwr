import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils.js';
import { finalizeEvent, generateSecretKey, getPublicKey, nip44, verifyEvent } from 'nostr-tools';

/**
 * Signing as an account, local or remote (diogel-io/workspace#138, T39).
 *
 * A local account signs with its key in the vault. A remote account sends the operation to its
 * NIP-46 signer, and what comes back is accepted only as the event the user approved.
 */

const { request } = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('@/../src-bex/services/nip46-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/../src-bex/services/nip46-client')>();
  return { ...actual, nip46Client: { request } };
});
vi.mock('@/../src-bex/services/panel-presence', () => ({ notifyPanelsOfQueueChange: vi.fn() }));

import { checkRemoteSignedEvent, signerFor } from '@/../src-bex/services/account-signer';
import { listAuthChallenges } from '@/../src-bex/services/nip46-auth-challenges';
import { Nip46BadResponseError } from '@/../src-bex/services/nip46-client';
import { RemoteAccountUnsupportedError } from '@/../src-bex/services/account-key';
import type { StoredKey } from '@/types';

const userSecret = generateSecretKey();
const userPubkey = getPublicKey(userSecret);
const peerSecret = generateSecretKey();
const peerPubkey = getPublicKey(peerSecret);

const local: StoredKey = {
  id: userPubkey,
  alias: 'local',
  account: { privkey: bytesToHex(userSecret) },
  createdAt: '',
};

const remote: StoredKey = {
  id: userPubkey,
  alias: 'phone',
  account: {
    type: 'remote',
    nip46: {
      remoteSignerPubkey: 'cd'.repeat(32),
      relays: ['wss://relay.example.com'],
      clientSecret: '11'.repeat(32),
    },
  },
  createdAt: '',
};

const template = { kind: 1, content: 'hello', tags: [['t', 'porwr']], created_at: 1_700_000_000 };
const signedAs = (secret: Uint8Array, overrides: Partial<typeof template> = {}) =>
  finalizeEvent({ ...template, ...overrides }, secret);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a local account', () => {
  it('signs and encrypts with its own key and contacts no signer', async () => {
    const signer = signerFor(local, { origin: 'https://site.example' });

    const event = await signer.signEvent(template);
    expect(event.pubkey).toBe(userPubkey);
    expect(verifyEvent(event)).toBe(true);

    const ciphertext = await signer.nip44Encrypt(peerPubkey, 'secret');
    expect(nip44.decrypt(ciphertext, nip44.getConversationKey(peerSecret, userPubkey))).toBe(
      'secret',
    );
    expect(request).not.toHaveBeenCalled();
  });
});

describe('a remote-signer account', () => {
  it('sends sign_event with only the approved fields and returns the checked event', async () => {
    const signed = signedAs(userSecret);
    request.mockResolvedValue(JSON.stringify({ ...signed, extra: 'dropped' }));

    const event = await signerFor(remote, { origin: 'https://site.example' }).signEvent({
      ...template,
      pubkey: 'ignored',
    });

    expect(request).toHaveBeenCalledWith(
      remote.account.type === 'remote' ? remote.account.nip46 : undefined,
      'sign_event',
      [JSON.stringify(template)],
      expect.objectContaining({ onAuthUrl: expect.any(Function) }),
    );
    expect(event).toEqual(signed);
    expect(event).not.toHaveProperty('extra');
  });

  it('maps every encryption method to its NIP-46 call', async () => {
    request.mockResolvedValue('answer');
    const signer = signerFor(remote, { origin: 'https://site.example' });

    await signer.nip04Encrypt(peerPubkey, 'a');
    await signer.nip04Decrypt(peerPubkey, 'b');
    await signer.nip44Encrypt(peerPubkey, 'c');
    await signer.nip44Decrypt(peerPubkey, 'd');

    expect(request.mock.calls.map(([, method, params]) => [method, params])).toEqual([
      ['nip04_encrypt', [peerPubkey, 'a']],
      ['nip04_decrypt', [peerPubkey, 'b']],
      ['nip44_encrypt', [peerPubkey, 'c']],
      ['nip44_decrypt', [peerPubkey, 'd']],
    ]);
  });

  it('refuses an encryption result larger than a page may send', async () => {
    request.mockResolvedValue('x'.repeat(512 * 1024 + 1));

    await expect(
      signerFor(remote, { origin: 'https://site.example' }).nip44Decrypt(peerPubkey, 'x'),
    ).rejects.toBeInstanceOf(Nip46BadResponseError);
  });

  it('shows an auth_url on the panel for the waiting site, and withdraws it once answered', async () => {
    let seenDuringWait: unknown[] = [];
    request.mockImplementation(
      async (_connection, _method, _params, options: { onAuthUrl: (url: string) => void }) => {
        options.onAuthUrl('https://signer.example/auth');
        seenDuringWait = listAuthChallenges();
        return JSON.stringify(signedAs(userSecret));
      },
    );

    await signerFor(remote, { origin: 'https://site.example' }).signEvent(template);

    expect(seenDuringWait).toEqual([
      expect.objectContaining({
        origin: 'https://site.example',
        accountPubkey: userPubkey,
        url: 'https://signer.example/auth',
        host: 'signer.example',
      }),
    ]);
    expect(listAuthChallenges()).toEqual([]);
  });

  it('withdraws an auth_url when the request fails too', async () => {
    request.mockImplementation(
      async (_connection, _method, _params, options: { onAuthUrl: (url: string) => void }) => {
        options.onAuthUrl('https://signer.example/auth');
        throw new Error('timed out');
      },
    );

    await expect(
      signerFor(remote, { origin: 'https://site.example' }).nip44Decrypt(peerPubkey, 'x'),
    ).rejects.toThrow('timed out');
    expect(listAuthChallenges()).toEqual([]);
  });
});

describe('checkRemoteSignedEvent', () => {
  it('accepts the approved event, signed by the account', () => {
    const signed = signedAs(userSecret);
    expect(checkRemoteSignedEvent(JSON.stringify(signed), template, userPubkey)).toEqual(signed);
  });

  it('refuses an event signed by another key', () => {
    const signed = signedAs(peerSecret);
    expect(() => checkRemoteSignedEvent(JSON.stringify(signed), template, userPubkey)).toThrow(
      Nip46BadResponseError,
    );
  });

  it.each([
    ['kind', { kind: 4 }],
    ['content', { content: 'something else' }],
    ['tags', { tags: [['p', 'f'.repeat(64)]] }],
    ['created_at', { created_at: 1 }],
  ])('refuses an event whose %s differs from the approval', (_field, overrides) => {
    const signed = signedAs(userSecret, overrides);
    expect(() => checkRemoteSignedEvent(JSON.stringify(signed), template, userPubkey)).toThrow(
      'different event',
    );
  });

  it('refuses a bad signature, and an answer that is not an event', () => {
    const signed = { ...signedAs(userSecret), sig: '00'.repeat(64) };
    expect(() => checkRemoteSignedEvent(JSON.stringify(signed), template, userPubkey)).toThrow(
      Nip46BadResponseError,
    );
    expect(() => checkRemoteSignedEvent('not json', template, userPubkey)).toThrow(
      Nip46BadResponseError,
    );
    expect(() => checkRemoteSignedEvent('[]', template, userPubkey)).toThrow(Nip46BadResponseError);
  });
});

describe('local-only operations', () => {
  it('refuse a remote-signer account with one clear error', async () => {
    const { localSecretKeyOf, accountPubkeyOf } = await import('@/../src-bex/services/account-key');

    expect(() => localSecretKeyOf(remote)).toThrow(RemoteAccountUnsupportedError);
    expect(accountPubkeyOf(remote)).toBe(userPubkey);
    expect(accountPubkeyOf(local)).toBe(userPubkey);
    expect(accountPubkeyOf({ ...local, account: { privkey: 'zz' } })).toBeNull();
  });
});
