import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';
import { finalizeEvent, getPublicKey, nip44, SimplePool, verifyEvent } from 'nostr-tools';
import type { Event } from 'nostr-tools';

import { LogLevel, logService } from '@/services/log-service';
import { normalizeRelayUrl } from '@/services/relay-url';
import type { RemoteSignerConnection } from '@/types';

/**
 * A NIP-46 client for remote-signer accounts (diogel-io/workspace#138).
 *
 * Requests are kind 24133 events signed by the connection's client key, NIP-44 encrypted to the
 * remote signer and `p`-tagged to it. A response is used only when the remote signer's own key
 * signed it, it `p`-tags this client, it decrypts under that pair, and it answers a request still
 * waiting here. A relay is not trusted to have applied the subscription's filter (T39), and every
 * other event is ignored while the wait goes on. Each request is answered once, and fails rather
 * than being sent again when the signer refuses it, stops answering, or cannot be reached.
 *
 * Nothing about a request's params or result is logged: the method and outcome only.
 */

export const NIP46_KIND = 24133;

/** Long enough for a phone signer to ask its user, short enough that a request does not hang. */
export const NIP46_REQUEST_TIMEOUT_MS = 60_000;

const PUBLISH_MAX_WAIT_MS = 5000;

/** How far back a response may be dated, for a signer whose clock runs a little behind. */
const SINCE_SKEW_SECONDS = 10;

/** The longest `auth_url` accepted, so a signer cannot fill the panel. */
const MAX_AUTH_URL_LENGTH = 2048;

export type Nip46Method =
  | 'connect'
  | 'get_public_key'
  | 'sign_event'
  | 'nip04_encrypt'
  | 'nip04_decrypt'
  | 'nip44_encrypt'
  | 'nip44_decrypt'
  | 'switch_relays';

export class Nip46TimeoutError extends Error {
  constructor() {
    super('The remote signer did not answer in time');
    this.name = 'Nip46TimeoutError';
  }
}

/** The signer answered with an error. Its own message is not passed on: it is the signer's text. */
export class Nip46RefusedError extends Error {
  constructor() {
    super('The remote signer refused the request');
    this.name = 'Nip46RefusedError';
  }
}

export class Nip46BadResponseError extends Error {
  constructor(detail = 'The remote signer sent an answer Porwr could not accept') {
    super(detail);
    this.name = 'Nip46BadResponseError';
  }
}

export class Nip46UnreachableError extends Error {
  constructor() {
    super('The remote signer could not be reached on any of its relays');
    this.name = 'Nip46UnreachableError';
  }
}

export interface Nip46RequestOptions {
  /** Overrides `NIP46_REQUEST_TIMEOUT_MS`, for tests. */
  timeoutMs?: number;
  /**
   * Called when the signer asks the user to authorise this client at a URL first. The URL is
   * already checked to be `https:`. The request keeps waiting, under the same timeout.
   */
  onAuthUrl?: (url: string) => void;
}

/**
 * The connection's relays Porwr may connect to, each once. A connection with none makes no
 * request.
 */
export function allowedSignerRelays(connection: Pick<RemoteSignerConnection, 'relays'>): string[] {
  const relays = Array.from(
    new Set(
      connection.relays.flatMap((relay) => {
        const result = normalizeRelayUrl(relay);
        return result.valid && result.url ? [result.url] : [];
      }),
    ),
  );
  if (relays.length === 0) throw new Nip46UnreachableError();
  return relays;
}

/** An `auth_url` the panel may show and open: `https:` only, and of bounded length. */
export function acceptableAuthUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_AUTH_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname ? url.toString() : null;
  } catch {
    return null;
  }
}

interface Nip46Response {
  id: string;
  result?: unknown;
  error?: unknown;
}

function parseResponse(plaintext: string): Nip46Response | null {
  try {
    const parsed = JSON.parse(plaintext) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    return typeof record.id === 'string' ? (record as unknown as Nip46Response) : null;
  } catch {
    return null;
  }
}

interface Pending {
  reject: (error: Error) => void;
}

export class Nip46Client {
  /** Opened on first use and dropped by `close()`, which locking the vault calls. */
  private activePool: SimplePool | null = null;

  private readonly pending = new Set<Pending>();

  private get pool(): SimplePool {
    return (this.activePool ??= new SimplePool());
  }

  /**
   * Send one request and wait for its answer.
   *
   * @returns The response's `result`, which NIP-46 defines as a string for every method.
   * @throws {Nip46TimeoutError} When no acceptable answer arrives in time.
   * @throws {Nip46RefusedError} When the signer answers with an error.
   * @throws {Nip46UnreachableError} When no relay accepts the request.
   */
  async request(
    connection: RemoteSignerConnection,
    method: Nip46Method,
    params: string[],
    options: Nip46RequestOptions = {},
  ): Promise<string> {
    const relays = allowedSignerRelays(connection);
    const clientSecret = hexToBytes(connection.clientSecret);
    const clientPubkey = getPublicKey(clientSecret);
    const signerPubkey = connection.remoteSignerPubkey;
    const conversationKey = nip44.getConversationKey(clientSecret, signerPubkey);
    const requestId = bytesToHex(randomBytes(16));
    const now = Math.floor(Date.now() / 1000);

    const event = finalizeEvent(
      {
        kind: NIP46_KIND,
        created_at: now,
        tags: [['p', signerPubkey]],
        content: nip44.encrypt(JSON.stringify({ id: requestId, method, params }), conversationKey),
      },
      clientSecret,
    );

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closer: { close: (reason?: string) => void } | undefined;
    let cancel: (error: Error) => void = () => undefined;
    const shownAuthUrls = new Set<string>();

    const answer = new Promise<string>((resolve, reject) => {
      const entry: Pending = {
        reject: (error) => finish(() => reject(error)),
      };
      cancel = entry.reject;
      const finish = (settle: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pending.delete(entry);
        closer?.close('nip46 request settled');
        settle();
      };
      this.pending.add(entry);

      timer = setTimeout(
        () => finish(() => reject(new Nip46TimeoutError())),
        options.timeoutMs ?? NIP46_REQUEST_TIMEOUT_MS,
      );

      closer = this.pool.subscribe(
        relays,
        {
          kinds: [NIP46_KIND],
          authors: [signerPubkey],
          '#p': [clientPubkey],
          since: now - SINCE_SKEW_SECONDS,
        },
        {
          onevent: (incoming: Event) => {
            if (settled) return;
            // The relay's filter is not relied on: only the signer's own, valid event for this
            // client is read, and only an answer to this request settles it.
            const isForThisClient =
              incoming.kind === NIP46_KIND &&
              incoming.pubkey === signerPubkey &&
              incoming.tags.some((tag) => tag[0] === 'p' && tag[1] === clientPubkey) &&
              verifyEvent(incoming);
            if (!isForThisClient) return;

            let response: Nip46Response | null;
            try {
              response = parseResponse(nip44.decrypt(incoming.content, conversationKey));
            } catch {
              return;
            }
            if (!response || response.id !== requestId) return;

            if (response.result === 'auth_url') {
              const url = acceptableAuthUrl(response.error);
              if (url && !shownAuthUrls.has(url)) {
                shownAuthUrls.add(url);
                options.onAuthUrl?.(url);
              }
              // The signer answers again once the user has authorised, or the timeout ends it.
              return;
            }
            if (typeof response.error === 'string' && response.error.length > 0) {
              finish(() => reject(new Nip46RefusedError()));
              return;
            }
            if (typeof response.result !== 'string') {
              finish(() => reject(new Nip46BadResponseError()));
              return;
            }
            const result = response.result;
            finish(() => resolve(result));
          },
          onclose: () => undefined,
        },
      );
    });

    try {
      await Promise.any(this.pool.publish(relays, event, { maxWait: PUBLISH_MAX_WAIT_MS }));
    } catch {
      // No relay took the request: stop waiting for an answer to it, without an unhandled rejection.
      cancel(new Nip46UnreachableError());
      void answer.catch(() => undefined);
      logService.log(LogLevel.WARN, '[Nip46] Request could not be published', { method });
      throw new Nip46UnreachableError();
    }

    try {
      const result = await answer;
      logService.log(LogLevel.INFO, '[Nip46] Remote signer answered', { method });
      return result;
    } catch (error: unknown) {
      logService.log(LogLevel.WARN, '[Nip46] Remote signer request failed', {
        method,
        reason: error instanceof Error ? error.name : 'unknown',
      });
      throw error;
    }
  }

  /** Stop every request still waiting and close the relay connections. Locking the vault calls it. */
  close(): void {
    for (const entry of [...this.pending]) {
      entry.reject(new Error('The vault was locked before the remote signer answered'));
    }
    this.activePool?.destroy();
    this.activePool = null;
  }
}

export const nip46Client = new Nip46Client();
