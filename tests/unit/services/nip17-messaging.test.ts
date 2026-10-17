import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  getPublicKey,
  nip19,
  nip44,
  nip59,
} from 'nostr-tools';
import type { Event, Filter, SimplePool } from 'nostr-tools';

import example from '../fixtures/nip17-example.json';
import {
  Nip17Messaging,
  authSigner,
  conversationPeer,
  openGiftWrap,
} from '@/../src-bex/services/nip17-messaging';
import type { MessagingRelays } from '@/../src-bex/services/messaging-relays';
import type { DmRelayList } from '@/types/messaging';

const secretOf = (nsec: string) => nip19.decode(nsec).data as Uint8Array;

const alice = generateSecretKey();
const bob = generateSecretKey();
const ALICE = getPublicKey(alice);
const BOB = getPublicKey(bob);

/** Wraps a kind 14 from `from` to `to` exactly as a NIP-17 client would. */
function wrapMessage(
  from: Uint8Array,
  to: string,
  content: string,
  createdAt = 1_700_000_000,
): Event[] {
  return nip59.wrapManyEvents(
    { kind: 14, created_at: createdAt, tags: [['p', to]], content },
    from,
    [to],
  );
}

describe('openGiftWrap', () => {
  it('opens the NIP-17 specification example for the receiver', () => {
    const rumor = openGiftWrap(example.wrapToReceiver as Event, secretOf(example.receiverNsec));

    expect(rumor?.content).toBe(example.message);
    expect(rumor?.kind).toBe(14);
    expect(rumor?.pubkey).toBe(getPublicKey(secretOf(example.senderNsec)));
  });

  it("opens the specification example's copy for the sender", () => {
    const rumor = openGiftWrap(example.wrapToSender as Event, secretOf(example.senderNsec));

    expect(rumor?.content).toBe(example.message);
  });

  it('cannot open a wrap addressed to someone else', () => {
    expect(openGiftWrap(example.wrapToReceiver as Event, generateSecretKey())).toBeNull();
  });

  it('rejects a rumor whose author is not the seal signer, which is how a sender is impersonated', () => {
    const mallory = generateSecretKey();
    const rumor = {
      kind: 14,
      created_at: 1_700_000_000,
      tags: [['p', BOB]],
      content: 'from alice, honest',
      pubkey: ALICE,
    };
    const forgedRumor = { ...rumor, id: getEventHash(rumor) };
    const seal = finalizeEvent(
      {
        kind: 13,
        created_at: 1_700_000_000,
        tags: [],
        content: nip44.encrypt(JSON.stringify(forgedRumor), nip44.getConversationKey(mallory, BOB)),
      },
      mallory,
    );
    const wrap = nip59.createWrap(seal, BOB);

    expect(openGiftWrap(wrap, bob)).toBeNull();
  });

  it('rejects a seal with a broken signature', () => {
    const [, toBob] = wrapMessage(alice, BOB, 'hi');
    const seal = JSON.parse(
      nip44.decrypt(toBob!.content, nip44.getConversationKey(bob, toBob!.pubkey)),
    ) as Event;
    const tampered = { ...seal, sig: '0'.repeat(128) };
    const wrap = nip59.createWrap(tampered as Event, BOB);

    expect(openGiftWrap(wrap, bob)).toBeNull();
  });

  it('ignores anything that is not a kind 14 chat message', () => {
    const [, toBob] = nip59.wrapManyEvents(
      { kind: 7, created_at: 1, tags: [['p', BOB]], content: '+' },
      alice,
      [BOB],
    );
    expect(openGiftWrap(toBob!, bob)).toBeNull();
  });
});

describe('conversationPeer', () => {
  it('is the other person in a one-to-one message, from either side', () => {
    expect(conversationPeer({ pubkey: ALICE, tags: [['p', BOB]] }, BOB)).toBe(ALICE);
    expect(conversationPeer({ pubkey: ALICE, tags: [['p', BOB]] }, ALICE)).toBe(BOB);
  });

  it('is null for a group message, a note to self, or a message not involving me', () => {
    const carol = getPublicKey(generateSecretKey());
    expect(
      conversationPeer(
        {
          pubkey: ALICE,
          tags: [
            ['p', BOB],
            ['p', carol],
          ],
        },
        BOB,
      ),
    ).toBeNull();
    expect(conversationPeer({ pubkey: ALICE, tags: [['p', ALICE]] }, ALICE)).toBeNull();
    expect(conversationPeer({ pubkey: ALICE, tags: [['p', carol]] }, BOB)).toBeNull();
  });
});

describe('authSigner', () => {
  it('signs a NIP-42 AUTH event', async () => {
    const event = await authSigner(alice)({
      kind: 22242,
      created_at: 1,
      tags: [['challenge', 'c']],
      content: '',
    });
    expect(event.pubkey).toBe(ALICE);
  });

  it('refuses to sign any other kind for a relay', async () => {
    await expect(
      authSigner(alice)({ kind: 1, created_at: 1, tags: [], content: 'gotcha' }),
    ).rejects.toThrow('Refusing to sign kind 1');
  });
});

describe('Nip17Messaging', () => {
  const INBOX: Record<string, DmRelayList> = {
    [ALICE]: { relays: ['wss://alice.inbox'], updatedAt: 1 },
    [BOB]: { relays: ['wss://bob.inbox'], updatedAt: 1 },
  };
  let inboxes: Record<string, DmRelayList>;
  let stored: Event[];
  /** Event ids each relay keeps, as read back after a send. */
  let heldOn: Map<string, Set<string>>;
  /** Relays that reply OK to a gift wrap and throw it away, like relay.damus.io (#276). */
  let drops: Set<string>;
  /** Relays that close a read-back with this reason instead of answering it. */
  let refusals: Map<string, string>;
  /** Relays that never answer a read-back. */
  let silent: Set<string>;
  let publish: ReturnType<typeof vi.fn>;
  let subscribeEose: ReturnType<typeof vi.fn>;
  let relays: MessagingRelays;
  let clock: number;
  let pools: {
    publish: typeof publish;
    subscribeEose: typeof subscribeEose;
    destroy: ReturnType<typeof vi.fn>;
  }[];

  const service = () =>
    new Nip17Messaging(
      () => {
        const pool = { publish, subscribeEose, destroy: vi.fn() };
        pools.push(pool);
        return pool as unknown as SimplePool;
      },
      relays,
      () => clock,
    );

  beforeEach(() => {
    inboxes = { ...INBOX };
    stored = [];
    heldOn = new Map();
    drops = new Set();
    refusals = new Map();
    silent = new Set();
    pools = [];
    clock = 1_800_000_000_000;
    publish = vi.fn((targets: string[], event: Event) => {
      stored.push(event);
      for (const url of targets) {
        if (drops.has(url)) continue;
        heldOn.set(url, new Set([...(heldOn.get(url) ?? []), event.id]));
      }
      return targets.map(() => Promise.resolve(''));
    });
    type ReadParams = {
      onevent: (e: Event) => void;
      onclose: (reasons: { url: string; reason: string }[]) => void;
    };
    subscribeEose = vi.fn((targets: string[], filter: Filter, params: ReadParams) => {
      if (filter.ids) {
        const url = targets[0]!;
        if (silent.has(url)) return { close: vi.fn() };
        const refusal = refusals.get(url);
        if (refusal) {
          params.onclose([{ url, reason: refusal }]);
          return { close: vi.fn() };
        }
        stored
          .filter((event) => filter.ids!.includes(event.id) && heldOn.get(url)?.has(event.id))
          .forEach((event) => params.onevent(event));
        params.onclose([{ url, reason: 'closed automatically on eose' }]);
        return { close: vi.fn() };
      }
      stored
        .filter((event) => event.kind === filter.kinds?.[0])
        .filter((event) =>
          event.tags.some((tag) => tag[0] === 'p' && filter['#p']?.includes(tag[1]!)),
        )
        .filter((event) => filter.since === undefined || event.created_at >= filter.since)
        .forEach((event) => params.onevent(event));
      params.onclose([]);
      return { close: vi.fn() };
    });
    relays = {
      lookupDmRelays: vi.fn((pubkey: string) =>
        Promise.resolve(inboxes[pubkey] ?? { relays: [], updatedAt: null }),
      ),
      clearCache: vi.fn(),
    } as unknown as MessagingRelays;
  });

  it('refuses to send to someone with no direct message relays, as NIP-17 requires', async () => {
    delete inboxes[BOB];

    await expect(
      service().send(alice, { clientMessageId: 'm1', recipient: BOB, content: 'hi' }),
    ).resolves.toEqual({
      status: 'recipient-not-ready',
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it("delivers one copy to the recipient's inbox and one to the sender's, carrying the same message", async () => {
    const result = await service().send(alice, {
      clientMessageId: 'm1',
      recipient: BOB,
      content: 'hello bob',
    });

    expect(result).toMatchObject({
      status: 'sent',
      accepted: ['wss://bob.inbox'],
      unverified: [],
      selfCopy: 'stored',
    });
    const [toBob, toAlice] = [
      publish.mock.calls.find(([targets]) => targets[0] === 'wss://bob.inbox')![1] as Event,
      publish.mock.calls.find(([targets]) => targets[0] === 'wss://alice.inbox')![1] as Event,
    ];

    const bobSees = openGiftWrap(toBob, bob);
    const aliceSees = openGiftWrap(toAlice, alice);
    expect(bobSees?.content).toBe('hello bob');
    expect(bobSees?.pubkey).toBe(ALICE);
    expect(aliceSees?.id).toBe(bobSees?.id);
    if (result.status === 'sent') expect(result.message.id).toBe(bobSees?.id);

    // The wraps give nothing away: signed by throwaway keys, timestamps pushed into the past.
    expect(toBob.pubkey).not.toBe(ALICE);
    expect(toBob.created_at).toBeLessThanOrEqual(Math.floor(clock / 1000));
  });

  it('sends a retried message only once', async () => {
    const messaging = service();
    const first = messaging.send(alice, { clientMessageId: 'm1', recipient: BOB, content: 'once' });
    const retry = messaging.send(alice, { clientMessageId: 'm1', recipient: BOB, content: 'once' });

    expect(await retry).toEqual(await first);
    expect(publish).toHaveBeenCalledTimes(2); // one recipient copy, one sender copy
  });

  it('lets a failed send be tried again', async () => {
    const messaging = service();
    publish.mockImplementationOnce((targets: string[]) =>
      targets.map(() => Promise.reject(new Error('down'))),
    );

    await expect(
      messaging.send(alice, { clientMessageId: 'm1', recipient: BOB, content: 'x' }),
    ).rejects.toThrow('No relay accepted the message');
    await expect(
      messaging.send(alice, { clientMessageId: 'm1', recipient: BOB, content: 'x' }),
    ).resolves.toMatchObject({
      status: 'sent',
    });
  });

  it('reports a message as not sent when the only relay that said OK did not keep it (#276)', async () => {
    drops.add('wss://bob.inbox');

    await expect(
      service().send(alice, { clientMessageId: 'm1', recipient: BOB, content: 'x' }),
    ).rejects.toThrow('No relay kept the message');
  });

  it('lists only the relays that keep the message', async () => {
    inboxes[BOB] = { relays: ['wss://damus.example', 'wss://keeps.example'], updatedAt: 1 };
    drops.add('wss://damus.example');

    const result = await service().send(alice, {
      clientMessageId: 'm1',
      recipient: BOB,
      content: 'x',
    });

    expect(result).toMatchObject({
      status: 'sent',
      accepted: ['wss://keeps.example'],
      unverified: [],
      rejected: [{ url: 'wss://damus.example', reason: 'accepted but not stored' }],
    });
  });

  it('reads the wrap back by id, authenticating as the sender, from each relay on its own', async () => {
    inboxes[BOB] = { relays: ['wss://one.example', 'wss://two.example'], updatedAt: 1 };

    await service().send(alice, { clientMessageId: 'm1', recipient: BOB, content: 'x' });

    const toBob = publish.mock.calls.find(
      ([targets]) => targets[0] === 'wss://one.example',
    )![1] as Event;
    const reads = subscribeEose.mock.calls.filter(([, filter]) =>
      (filter as Filter).ids?.includes(toBob.id),
    );
    expect(reads.map(([targets]) => targets)).toEqual([
      ['wss://one.example'],
      ['wss://two.example'],
    ]);
    for (const [, , params] of reads)
      expect((params as { onauth?: unknown }).onauth).toBeTypeOf('function');
  });

  it.each([
    'restricted: gift wraps are only served to their recipient',
    'auth-required: sign in first',
  ])(
    'counts an inbox that will not show the sender the wrap as delivered, unverified (%s)',
    async (reason) => {
      refusals.set('wss://bob.inbox', reason);

      await expect(
        service().send(alice, { clientMessageId: 'm1', recipient: BOB, content: 'x' }),
      ).resolves.toMatchObject({
        status: 'sent',
        accepted: ['wss://bob.inbox'],
        unverified: ['wss://bob.inbox'],
      });
    },
  );

  it('does not count a relay it could not reach while reading back', async () => {
    refusals.set('wss://bob.inbox', 'connection failure');

    await expect(
      service().send(alice, { clientMessageId: 'm1', recipient: BOB, content: 'x' }),
    ).rejects.toThrow('No relay kept the message');
  });

  it('does not count a relay it could not connect to when sending', async () => {
    publish.mockImplementationOnce((targets: string[]) =>
      targets.map(() => Promise.reject('connection failure: refused')),
    );

    await expect(
      service().send(alice, { clientMessageId: 'm1', recipient: BOB, content: 'x' }),
    ).rejects.toThrow('No relay accepted the message');
  });

  it("keeps no copy for the sender when the recipient's relays did not keep theirs", async () => {
    drops.add('wss://bob.inbox');

    await expect(
      service().send(alice, { clientMessageId: 'm1', recipient: BOB, content: 'x' }),
    ).rejects.toThrow();
    // Otherwise the sender's next load would show the lost message as sent.
    expect(publish.mock.calls.map(([targets]) => targets)).toEqual([['wss://bob.inbox']]);
  });

  it("reports the sender's own copy as failed when none of their relays keep it", async () => {
    drops.add('wss://alice.inbox');

    await expect(
      service().send(alice, { clientMessageId: 'm1', recipient: BOB, content: 'x' }),
    ).resolves.toMatchObject({
      status: 'sent',
      selfCopy: 'failed',
    });
  });

  it('finishes inside the deadline when a relay never answers the read-back', async () => {
    vi.useFakeTimers();
    try {
      inboxes[BOB] = { relays: ['wss://keeps.example', 'wss://silent.example'], updatedAt: 1 };
      silent.add('wss://silent.example');

      const result = service().send(alice, { clientMessageId: 'm1', recipient: BOB, content: 'x' });
      await vi.advanceTimersByTimeAsync(4_000);

      await expect(result).resolves.toMatchObject({
        status: 'sent',
        accepted: ['wss://keeps.example'],
        rejected: [
          { url: 'wss://silent.example', reason: 'could not confirm the relay stored it' },
        ],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up on a publish that runs past its share of the deadline', async () => {
    vi.useFakeTimers();
    try {
      publish.mockImplementationOnce((targets: string[]) =>
        targets.map(() => new Promise(() => {})),
      );

      const result = service().send(alice, { clientMessageId: 'm1', recipient: BOB, content: 'x' });
      const settled = expect(result).rejects.toThrow('No relay accepted the message');
      await vi.advanceTimersByTimeAsync(1_500);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('notes when the sender has no inbox to keep their own copy', async () => {
    delete inboxes[ALICE];

    await expect(
      service().send(alice, { clientMessageId: 'm1', recipient: BOB, content: 'x' }),
    ).resolves.toMatchObject({
      status: 'sent',
      selfCopy: 'no-inbox',
    });
  });

  it("reads and decrypts the account's messages, oldest first, from both sides of a conversation", async () => {
    stored.push(...wrapMessage(alice, BOB, 'first', 1_700_000_000));
    stored.push(...wrapMessage(bob, ALICE, 'reply', 1_700_000_100));

    const result = await service().fetch(bob, {});

    expect(result.inbox).toBe('ready');
    expect(result.messages.map((m) => [m.content, m.pubkey, m.peer])).toEqual([
      ['first', ALICE, ALICE],
      ['reply', BOB, ALICE],
    ]);
    expect(subscribeEose.mock.calls[0]![0]).toEqual(['wss://bob.inbox']);
    expect(subscribeEose.mock.calls[0]![1]).toEqual({ kinds: [1059], '#p': [BOB] });
  });

  it('asks for wraps from two days before `since`, because wrap timestamps are randomised backwards', async () => {
    await service().fetch(bob, { since: 1_700_000_000 });

    expect(subscribeEose.mock.calls[0]![1]).toEqual({
      kinds: [1059],
      '#p': [BOB],
      since: 1_700_000_000 - 2 * 24 * 60 * 60,
    });
  });

  it('returns only messages newer than `since`', async () => {
    stored.push(...wrapMessage(alice, BOB, 'old', 1_700_000_000));
    stored.push(...wrapMessage(alice, BOB, 'new', 1_700_000_500));

    const result = await service().fetch(bob, { since: 1_700_000_000 });

    expect(result.messages.map((m) => m.content)).toEqual(['new']);
  });

  it('counts, and does not show, wraps it cannot trust', async () => {
    const carol = generateSecretKey();
    stored.push(
      ...nip59.wrapManyEvents(
        {
          kind: 14,
          created_at: 1,
          tags: [
            ['p', BOB],
            ['p', getPublicKey(carol)],
          ],
          content: 'group',
        },
        alice,
        [BOB],
      ),
    );
    stored.push(
      nip59.createWrap(
        finalizeEvent({ kind: 13, created_at: 1, tags: [], content: 'garbage' }, carol),
        BOB,
      ),
    );

    const result = await service().fetch(bob, {});

    expect(result.messages).toEqual([]);
    expect(result.dropped).toBe(2);
  });

  it('reports an account with no inbox instead of querying nothing', async () => {
    delete inboxes[BOB];

    await expect(service().fetch(bob, {})).resolves.toEqual({
      inbox: 'none',
      messages: [],
      dropped: 0,
    });
    expect(subscribeEose).not.toHaveBeenCalled();
  });

  it('authenticates to inbox relays with NIP-42 when they ask', async () => {
    await service().fetch(bob, {});

    const { onauth } = subscribeEose.mock.calls[0]![2] as {
      onauth: (t: {
        kind: number;
        created_at: number;
        tags: string[][];
        content: string;
      }) => Promise<Event>;
    };
    const auth = await onauth({
      kind: 22242,
      created_at: 1,
      tags: [['challenge', 'c']],
      content: '',
    });
    expect(auth.pubkey).toBe(BOB);
  });

  it('forgets decrypted messages when cleared, as on vault lock', async () => {
    const messaging = service();
    stored.push(...wrapMessage(alice, BOB, 'secret'));
    await messaging.fetch(bob, {});

    messaging.clear();
    stored.length = 0;

    await expect(messaging.fetch(bob, {})).resolves.toMatchObject({ messages: [] });
    expect(relays.clearCache).toHaveBeenCalled();
  });

  it("keeps one account's messages at a time", async () => {
    const messaging = service();
    stored.push(...wrapMessage(alice, BOB, 'for bob'));
    await messaging.fetch(bob, {});
    stored.length = 0;

    await messaging.fetch(alice, {});
    const again = await messaging.fetch(bob, {});

    expect(again.messages).toEqual([]);
  });

  it('opens a separate relay pool per account and closes the old one on switching', async () => {
    const messaging = service();

    await messaging.fetch(bob, {});
    await messaging.fetch(bob, {});
    expect(pools).toHaveLength(1);

    await messaging.fetch(alice, {});
    expect(pools).toHaveLength(2);
    expect(pools[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(pools[1]!.destroy).not.toHaveBeenCalled();
  });

  it('closes every relay connection when cleared', async () => {
    const messaging = service();
    await messaging.fetch(bob, {});

    messaging.clear();

    expect(pools[0]!.destroy).toHaveBeenCalledTimes(1);
  });
});
