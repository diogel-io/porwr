import { generateSecretKey, getPublicKey, nip59, SimplePool } from 'nostr-tools';

import { CHAT_MESSAGE_KIND } from '@/types/messaging';
import type { DmRelayCheck, DmRelayCheckResult } from '@/types/messaging';
import { checkStored } from './gift-wrap-storage';
import { withDeadline } from './messaging-relays';
import { authSigner } from './relay-auth';

/** The whole check, every relay at once. It leaves about a second of the page's 5 s for the reply. */
const CHECK_DEADLINE_MS = 4_000;

/** Publishing gives up by then, so a slow publish cannot use the time kept for reading back. */
const PUBLISH_WAIT_MS = 1_500;
const CONFIRM_WAIT_MS = 750;

/** How long a relay's answer is trusted, so saving again soon does not publish another test wrap. */
const CHECK_MEMORY_MS = 10 * 60 * 1000;

/**
 * NIP-01 refusals that say the relay will not take the event, so a sender could not reach the user
 * there either. Any other failure, such as `rate-limited:`, `auth-required:`, `error:` or a timeout,
 * says nothing about gift wraps and leaves the relay unchecked.
 */
const REFUSES_EVENT = /^(blocked|restricted|invalid|pow|mute):/;

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Tests whether relays keep NIP-59 gift wraps, before the user names them as their inbox (#277).
 *
 * Each relay gets a gift wrap from a new throwaway key to itself, then is asked for it back by id,
 * authenticating as that key where the relay asks (NIP-42). Inbox relays serve a wrap only to its
 * recipient, and the throwaway key is the recipient. Nothing is signed by the user's account: the
 * probe never sees its key.
 */
export class DmRelayProbe {
  private readonly answers = new Map<string, { check: DmRelayCheck; at: number }>();

  constructor(
    private readonly createPool: () => SimplePool = () => new SimplePool(),
    private readonly now: () => number = Date.now,
  ) {}

  async check(relays: readonly string[]): Promise<DmRelayCheckResult> {
    const deadlineAt = this.now() + CHECK_DEADLINE_MS;
    const checks = await Promise.all(
      relays.map((url) => {
        const known = this.recalled(url);
        return known ? Promise.resolve(known) : this.probe(url, deadlineAt);
      }),
    );
    return { checks };
  }

  clear(): void {
    this.answers.clear();
  }

  private recalled(url: string): DmRelayCheck | undefined {
    const answer = this.answers.get(url);
    if (!answer) return undefined;
    if (this.now() - answer.at > CHECK_MEMORY_MS) {
      this.answers.delete(url);
      return undefined;
    }
    return answer.check;
  }

  private async probe(url: string, deadlineAt: number): Promise<DmRelayCheck> {
    const check = await this.test(url, deadlineAt);
    // A relay that could not be checked is asked again next time.
    if (check.status !== 'unchecked') this.answers.set(url, { check, at: this.now() });
    return check;
  }

  private async test(url: string, deadlineAt: number): Promise<DmRelayCheck> {
    const secretKey = generateSecretKey();
    const pubkey = getPublicKey(secretKey);
    const wrap = nip59.wrapEvent(
      { kind: CHAT_MESSAGE_KIND, content: '', tags: [['p', pubkey]] },
      secretKey,
      pubkey,
    );

    // A pool of its own: the connection authenticates as the throwaway key and dies with it.
    const pool = this.createPool();
    const abort = new AbortController();
    try {
      const publishBy = Math.min(this.now() + PUBLISH_WAIT_MS, deadlineAt - CONFIRM_WAIT_MS);
      const [publish] = pool.publish([url], wrap, {
        maxWait: Math.max(0, publishBy - this.now()),
        abort: abort.signal,
        onauth: authSigner(secretKey),
      });

      try {
        // nostr-tools' own waits run past `maxWait`, so only ours decides (#265). A relay it could not
        // connect to rejects with "connection failure: …", which leaves the relay unchecked.
        await withDeadline(
          publish!,
          publishBy,
          () => Promise.reject(new Error('timed out')),
          this.now,
        );
      } catch (error) {
        const reason = reasonOf(error);
        return { url, status: REFUSES_EVENT.test(reason) ? 'drops' : 'unchecked', reason };
      }

      const stored = await checkStored(pool, secretKey, url, wrap.id, deadlineAt, this.now);
      switch (stored.storage) {
        case 'held':
          return { url, status: 'keeps' };
        case 'missing':
          return { url, status: 'drops', reason: stored.reason };
        case 'refused':
          return { url, status: 'unchecked', reason: 'would not serve the test message back' };
        case 'unanswered':
          return { url, status: 'unchecked', reason: stored.reason };
      }
    } finally {
      abort.abort();
      pool.destroy();
    }
  }
}

export const dmRelayProbe = new DmRelayProbe();
