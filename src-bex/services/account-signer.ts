/**
 * Signing and encrypting as an account, whichever kind of key stands behind it (#138).
 *
 * The NIP-07 and encryption handlers resolve the site's account, check its permissions, and then
 * ask this for a signer. A local account signs here with the key in the vault. A remote-signer
 * account sends the operation to its NIP-46 signer, which may refuse on its own. Porwr's approval
 * has already happened by the time either is reached, so nothing is sent to a signer for a request
 * the user has not allowed.
 *
 * What a remote signer returns is checked before a page sees it. A signed event must be valid,
 * signed by the account's key, and be exactly the event the user approved: a signer that signs
 * something else is refused (T39).
 */

import { finalizeEvent, nip04, nip44, verifyEvent } from 'nostr-tools';

import type { StoredKey } from '@/types';
import type { SignedEvent, UnsignedEvent } from '../types/background';
import { isRemoteAccount, localSecretKeyOf, type RemoteStoredKey } from './account-key';
import { addAuthChallenge } from './nip46-auth-challenges';
import { Nip46BadResponseError, nip46Client, type Nip46Method } from './nip46-client';
import { MAX_PAGE_PAYLOAD_LENGTH } from './request-limits';

export interface AccountSigner {
  signEvent(event: UnsignedEvent): Promise<SignedEvent>;
  nip04Encrypt(peer: string, plaintext: string): Promise<string>;
  nip04Decrypt(peer: string, ciphertext: string): Promise<string>;
  nip44Encrypt(peer: string, plaintext: string): Promise<string>;
  nip44Decrypt(peer: string, ciphertext: string): Promise<string>;
}

/** Who the operation is for, so a remote signer's `auth_url` names the waiting site. */
export interface SignerContext {
  origin: string;
}

/** Runs `operation` as a promise, so a local failure rejects just as a remote one does. */
const asPromise = <T>(operation: () => T): Promise<T> => Promise.resolve().then(operation);

function localSigner(account: StoredKey): AccountSigner {
  const secretKey = (): Uint8Array => localSecretKeyOf(account);
  return {
    // `finalizeEvent` sets the pubkey from the key, so the event is always the account's. It
    // writes into the object it is given, so it is given a copy and the caller's event is left as is.
    signEvent: (event) => asPromise(() => finalizeEvent({ ...event }, secretKey())),
    nip04Encrypt: (peer, plaintext) => asPromise(() => nip04.encrypt(secretKey(), peer, plaintext)),
    nip04Decrypt: (peer, ciphertext) =>
      asPromise(() => nip04.decrypt(secretKey(), peer, ciphertext)),
    nip44Encrypt: (peer, plaintext) =>
      asPromise(() => nip44.encrypt(plaintext, nip44.getConversationKey(secretKey(), peer))),
    nip44Decrypt: (peer, ciphertext) =>
      asPromise(() => nip44.decrypt(ciphertext, nip44.getConversationKey(secretKey(), peer))),
  };
}

const sameTags = (a: unknown, b: string[][]): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The remote signer's answer to `sign_event`, accepted only as the event the user approved, signed
 * by the account. Only the event's own fields are passed on.
 */
export function checkRemoteSignedEvent(
  result: string,
  template: UnsignedEvent,
  accountPubkey: string,
): SignedEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    throw new Nip46BadResponseError();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Nip46BadResponseError();
  }
  const event = parsed as Record<string, unknown>;
  const signed = {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: event.sig,
  } as SignedEvent;

  const matchesApproval =
    signed.pubkey === accountPubkey &&
    signed.kind === template.kind &&
    signed.content === template.content &&
    signed.created_at === template.created_at &&
    sameTags(signed.tags, template.tags);
  if (!matchesApproval) {
    throw new Nip46BadResponseError(
      'The remote signer signed a different event from the one approved',
    );
  }
  if (!verifyEvent(signed)) throw new Nip46BadResponseError();
  return signed;
}

/**
 * An encryption result from a remote signer, no larger than a page may send Porwr: a signer cannot
 * hand a page more than the page could have asked with.
 */
async function bounded(result: Promise<string>): Promise<string> {
  const value = await result;
  if (value.length > MAX_PAGE_PAYLOAD_LENGTH) throw new Nip46BadResponseError();
  return value;
}

function remoteSigner(account: RemoteStoredKey, context: SignerContext): AccountSigner {
  const call = async (method: Nip46Method, params: string[]): Promise<string> => {
    const withdraw: Array<() => void> = [];
    try {
      return await nip46Client.request(account.account.nip46, method, params, {
        onAuthUrl: (url) =>
          withdraw.push(
            addAuthChallenge({ origin: context.origin, accountPubkey: account.id, url }),
          ),
      });
    } finally {
      for (const remove of withdraw) remove();
    }
  };

  return {
    signEvent: async (event) => {
      // NIP-46 signs exactly these four fields. A page that left out the timestamp or tags gets
      // what a local signature would use, so the answer can still be compared with the request.
      const template: UnsignedEvent = {
        kind: event.kind,
        content: event.content,
        tags: Array.isArray(event.tags) ? event.tags : [],
        created_at: Number.isInteger(event.created_at)
          ? event.created_at
          : Math.floor(Date.now() / 1000),
      };
      const result = await call('sign_event', [JSON.stringify(template)]);
      return checkRemoteSignedEvent(result, template, account.id);
    },
    nip04Encrypt: (peer, plaintext) => bounded(call('nip04_encrypt', [peer, plaintext])),
    nip04Decrypt: (peer, ciphertext) => bounded(call('nip04_decrypt', [peer, ciphertext])),
    nip44Encrypt: (peer, plaintext) => bounded(call('nip44_encrypt', [peer, plaintext])),
    nip44Decrypt: (peer, ciphertext) => bounded(call('nip44_decrypt', [peer, ciphertext])),
  };
}

export function signerFor(account: StoredKey, context: SignerContext): AccountSigner {
  return isRemoteAccount(account) ? remoteSigner(account, context) : localSigner(account);
}
