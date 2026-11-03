import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils.js';
import { finalizeEvent, generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';
import type { Event, Filter } from 'nostr-tools';

/**
 * The NIP-46 client against a simulated relay and signer (diogel-io/workspace#138, T39).
 *
 * Only the relay pool is replaced. Requests and responses are real kind 24133 events, signed and
 * NIP-44 encrypted, so each test exercises the checks a response must pass: the signer's own key,
 * this client's `p` tag, a valid signature, and the id of a request still waiting.
 */

type Subscription = {
  filter: Filter;
  onevent: (event: Event) => void;
  closed: boolean;
};

const { pool } = vi.hoisted(() => ({
  pool: {
    subscriptions: [] as Subscription[],
    publish: vi.fn(),
    destroy: vi.fn(),
  },
}));

vi.mock('nostr-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools')>();
  return {
    ...actual,
    SimplePool: vi.fn().mockImplementation(function SimplePool() {
      return {
        subscribe: (_relays: string[], filter: Filter, params: { onevent: (e: Event) => void }) => {
          const subscription: Subscription = { filter, onevent: params.onevent, closed: false };
          pool.subscriptions.push(subscription);
          return {
            close: () => {
              subscription.closed = true;
            },
          };
        },
        publish: pool.publish,
        destroy: pool.destroy,
      };
    }),
  };
});

vi.mock('@/services/log-service', () => ({
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
  logService: { log: vi.fn() },
}));

import { logService } from '@/services/log-service';
import {
  acceptableAuthUrl,
  Nip46BadResponseError,
  Nip46Client,
  Nip46RefusedError,
  Nip46TimeoutError,
  Nip46UnreachableError,
} from '@/../src-bex/services/nip46-client';
import type { RemoteSignerConnection } from '@/types';

const signerSecret = generateSecretKey();
const signerPubkey = getPublicKey(signerSecret);
const clientSecret = generateSecretKey();
const clientPubkey = getPublicKey(clientSecret);
const strangerSecret = generateSecretKey();

const connection: RemoteSignerConnection = {
  remoteSignerPubkey: signerPubkey,
  relays: ['wss://relay.example.com'],
  clientSecret: bytesToHex(clientSecret),
};

const conversation = nip44.getConversationKey(signerSecret, clientPubkey);

interface DecodedRequest {
  id: string;
  method: string;
  params: string[];
}

const decode = (event: Event): DecodedRequest =>
  JSON.parse(nip44.decrypt(event.content, conversation)) as DecodedRequest;

/** A response event as a signer sends it, with every field overridable to forge a bad one. */
function response(
  body: Record<string, unknown>,
  options: { secret?: Uint8Array; pTag?: string; tamper?: boolean } = {},
): Event {
  const secret = options.secret ?? signerSecret;
  const key = nip44.getConversationKey(secret, clientPubkey);
  const event = finalizeEvent(
    {
      kind: 24133,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', options.pTag ?? clientPubkey]],
      content: nip44.encrypt(JSON.stringify(body), key),
    },
    secret,
  );
  return options.tamper ? { ...event, pubkey: signerPubkey } : event;
}

/** Make the relay deliver what `answer` returns for each published request, after the publish. */
function signerAnswers(answer: (request: DecodedRequest) => Event[]): void {
  pool.publish.mockImplementation((_relays: string[], event: Event) => {
    const request = decode(event);
    queueMicrotask(() => {
      for (const reply of answer(request)) {
        for (const subscription of pool.subscriptions) {
          if (!subscription.closed) subscription.onevent(reply);
        }
      }
    });
    return [Promise.resolve('ok')];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  pool.subscriptions.length = 0;
});

describe('Nip46Client.request', () => {
  it('sends an encrypted request p-tagged to the signer and returns its answer', async () => {
    let seen: Event | undefined;
    pool.publish.mockImplementation((_relays: string[], event: Event) => {
      seen = event;
      const request = decode(event);
      queueMicrotask(() =>
        pool.subscriptions[0]!.onevent(response({ id: request.id, result: 'pubkey-hex' })),
      );
      return [Promise.resolve('ok')];
    });

    const result = await new Nip46Client().request(connection, 'get_public_key', []);

    expect(result).toBe('pubkey-hex');
    expect(seen?.kind).toBe(24133);
    expect(seen?.pubkey).toBe(clientPubkey);
    expect(seen?.tags).toEqual([['p', signerPubkey]]);
    expect(decode(seen!)).toMatchObject({ method: 'get_public_key', params: [] });
    expect(pool.subscriptions[0]!.filter).toMatchObject({
      kinds: [24133],
      authors: [signerPubkey],
      '#p': [clientPubkey],
    });
    expect(pool.subscriptions[0]!.closed).toBe(true);
  });

  it('ignores a response from the wrong pubkey and waits for the signer', async () => {
    signerAnswers((request) => [
      response({ id: request.id, result: 'forged' }, { secret: strangerSecret }),
      response({ id: request.id, result: 'genuine' }),
    ]);

    await expect(new Nip46Client().request(connection, 'get_public_key', [])).resolves.toBe(
      'genuine',
    );
  });

  it('never settles on a response from the wrong pubkey alone', async () => {
    signerAnswers((request) => [
      response({ id: request.id, result: 'forged' }, { secret: strangerSecret }),
    ]);

    await expect(
      new Nip46Client().request(connection, 'get_public_key', [], { timeoutMs: 30 }),
    ).rejects.toBeInstanceOf(Nip46TimeoutError);
  });

  it('ignores an event that claims the signer but is not signed by it', async () => {
    signerAnswers((request) => [
      response({ id: request.id, result: 'forged' }, { secret: strangerSecret, tamper: true }),
      response({ id: request.id, result: 'genuine' }),
    ]);

    await expect(new Nip46Client().request(connection, 'get_public_key', [])).resolves.toBe(
      'genuine',
    );
  });

  it('ignores a response for another client or another request', async () => {
    signerAnswers((request) => [
      response({ id: request.id, result: 'not-for-me' }, { pTag: 'f'.repeat(64) }),
      response({ id: 'an-old-request', result: 'replayed' }),
      response({ id: request.id, result: 'mine' }),
    ]);

    await expect(new Nip46Client().request(connection, 'get_public_key', [])).resolves.toBe('mine');
  });

  it('answers each request once', async () => {
    signerAnswers((request) => [
      response({ id: request.id, result: 'first' }),
      response({ id: request.id, error: 'second answer' }),
    ]);

    await expect(new Nip46Client().request(connection, 'get_public_key', [])).resolves.toBe(
      'first',
    );
  });

  it('fails a refused request, without retrying it', async () => {
    signerAnswers((request) => [response({ id: request.id, error: 'user said no' })]);

    const failure = new Nip46Client().request(connection, 'sign_event', ['{}']);

    await expect(failure).rejects.toBeInstanceOf(Nip46RefusedError);
    // The signer's own words are not passed on.
    await expect(failure).rejects.not.toThrow('user said no');
    expect(pool.publish).toHaveBeenCalledTimes(1);
  });

  it('fails a timed-out request, without retrying it', async () => {
    pool.publish.mockReturnValue([Promise.resolve('ok')]);

    await expect(
      new Nip46Client().request(connection, 'sign_event', ['{}'], { timeoutMs: 30 }),
    ).rejects.toBeInstanceOf(Nip46TimeoutError);
    expect(pool.publish).toHaveBeenCalledTimes(1);
    expect(pool.subscriptions[0]!.closed).toBe(true);
  });

  it('fails an answer that is not a string', async () => {
    signerAnswers((request) => [response({ id: request.id, result: { not: 'a string' } })]);

    await expect(
      new Nip46Client().request(connection, 'get_public_key', []),
    ).rejects.toBeInstanceOf(Nip46BadResponseError);
  });

  it('shows an https auth_url and keeps waiting for the answer', async () => {
    const onAuthUrl = vi.fn();
    signerAnswers((request) => [
      response({ id: request.id, result: 'auth_url', error: 'https://signer.example/auth/1' }),
      response({ id: request.id, result: 'auth_url', error: 'https://signer.example/auth/1' }),
      response({ id: request.id, result: 'signed' }),
    ]);

    await expect(
      new Nip46Client().request(connection, 'sign_event', ['{}'], { onAuthUrl }),
    ).resolves.toBe('signed');
    // Shown once, however often the signer repeats it.
    expect(onAuthUrl).toHaveBeenCalledTimes(1);
    expect(onAuthUrl).toHaveBeenCalledWith('https://signer.example/auth/1');
  });

  it('never shows an auth_url that is not https', async () => {
    const onAuthUrl = vi.fn();
    signerAnswers((request) => [
      response({ id: request.id, result: 'auth_url', error: 'javascript:alert(1)' }),
      response({ id: request.id, result: 'auth_url', error: 'http://signer.example/auth' }),
      response({ id: request.id, result: 'signed' }),
    ]);

    await new Nip46Client().request(connection, 'sign_event', ['{}'], { onAuthUrl });

    expect(onAuthUrl).not.toHaveBeenCalled();
  });

  it('stops waiting when no relay takes the request', async () => {
    const refused = Promise.reject(new Error('relay down'));
    refused.catch(() => undefined);
    pool.publish.mockReturnValue([refused]);

    await expect(
      new Nip46Client().request(connection, 'get_public_key', []),
    ).rejects.toBeInstanceOf(Nip46UnreachableError);
    expect(pool.subscriptions[0]!.closed).toBe(true);
  });

  it('contacts no relay when the connection has none Porwr may use', async () => {
    await expect(
      new Nip46Client().request(
        { ...connection, relays: ['ws://relay.example.com'] },
        'ping' as never,
        [],
      ),
    ).rejects.toBeInstanceOf(Nip46UnreachableError);
    expect(pool.publish).not.toHaveBeenCalled();
    expect(pool.subscriptions).toHaveLength(0);
  });

  it('ends every waiting request when closed, as locking the vault does', async () => {
    pool.publish.mockReturnValue([Promise.resolve('ok')]);
    const client = new Nip46Client();

    const waiting = client.request(connection, 'sign_event', ['{}']);
    await Promise.resolve();
    client.close();

    await expect(waiting).rejects.toThrow('locked');
    expect(pool.destroy).toHaveBeenCalled();
  });

  it('logs the method and outcome, never params or results', async () => {
    signerAnswers((request) => [response({ id: request.id, result: 'the-plaintext-result' })]);

    await new Nip46Client().request(connection, 'nip44_decrypt', ['peer', 'the-ciphertext-param']);

    const logged = JSON.stringify(vi.mocked(logService.log).mock.calls);
    expect(logged).toContain('nip44_decrypt');
    expect(logged).not.toContain('the-plaintext-result');
    expect(logged).not.toContain('the-ciphertext-param');
    expect(logged).not.toContain(connection.clientSecret);
  });
});

describe('allowedSignerRelays', () => {
  it('keeps each allowed relay once', async () => {
    const { allowedSignerRelays } = await import('@/../src-bex/services/nip46-client');
    expect(
      allowedSignerRelays({
        relays: ['wss://a.example', 'wss://a.example/', 'ws://plain.example', 'wss://b.example'],
      }),
    ).toEqual(['wss://a.example', 'wss://b.example']);
  });
});

describe('acceptableAuthUrl', () => {
  it('accepts only https URLs of bounded length', () => {
    expect(acceptableAuthUrl('https://signer.example/a')).toBe('https://signer.example/a');
    expect(acceptableAuthUrl('http://signer.example/a')).toBeNull();
    expect(acceptableAuthUrl('data:text/html,hi')).toBeNull();
    expect(acceptableAuthUrl(42)).toBeNull();
    expect(acceptableAuthUrl(`https://signer.example/${'a'.repeat(3000)}`)).toBeNull();
  });
});
