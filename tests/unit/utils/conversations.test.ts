import { describe, it, expect } from 'vitest';

import { buildConversations, conversationMessages, mergeMessages, newestFrom } from '@/utils/conversations';
import type { DirectMessage } from '@/types/messaging';

const ME = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const CAROL = 'c'.repeat(64);
const STRANGER = 'd'.repeat(64);

const msg = (id: string, peer: string, from: string, created_at: number, content = id): DirectMessage => ({
  id,
  peer,
  pubkey: from,
  created_at,
  content,
});

describe('mergeMessages', () => {
  it('adds new messages by id and ignores ones already held', () => {
    const known = new Map([['1', msg('1', BOB, BOB, 10)]]);
    const next = mergeMessages(known, [msg('1', BOB, BOB, 10), msg('2', BOB, ME, 11)]);

    expect([...next.keys()]).toEqual(['1', '2']);
    expect(known.size).toBe(1);
  });

  it('returns the same map when nothing is new', () => {
    const known = new Map([['1', msg('1', BOB, BOB, 10)]]);
    expect(mergeMessages(known, [msg('1', BOB, BOB, 10)])).toBe(known);
  });
});

describe('conversationMessages', () => {
  it("returns one peer's messages, oldest first", () => {
    const all = [msg('3', BOB, ME, 30), msg('1', BOB, BOB, 10), msg('2', CAROL, CAROL, 20)];
    expect(conversationMessages(all, BOB).map((m) => m.id)).toEqual(['1', '3']);
  });
});

describe('buildConversations', () => {
  it('lists every contact, plus anyone else who wrote, newest conversation first', () => {
    const result = buildConversations(
      [msg('1', CAROL, CAROL, 10), msg('2', STRANGER, STRANGER, 20)],
      [BOB, CAROL],
      {},
    );

    expect(result.map((c) => [c.peer, c.isContact])).toEqual([
      [STRANGER, false],
      [CAROL, true],
      [BOB, true],
    ]);
  });

  it('counts only messages from the peer that are newer than what was read', () => {
    const [bob] = buildConversations(
      [msg('1', BOB, BOB, 10), msg('2', BOB, BOB, 20), msg('3', BOB, ME, 30), msg('4', BOB, BOB, 40)],
      [BOB],
      { [BOB]: 20 },
    );

    expect(bob!.unread).toBe(1);
    expect(bob!.lastMessage?.id).toBe('4');
  });

  it('keeps contacts without messages in contact-list order', () => {
    expect(buildConversations([], [CAROL, BOB], {}).map((c) => c.peer)).toEqual([CAROL, BOB]);
  });
});

describe('newestFrom', () => {
  it("is the newest message the peer sent, ignoring the account's own", () => {
    expect(newestFrom([msg('1', BOB, BOB, 10), msg('2', BOB, ME, 30)], BOB)).toBe(10);
    expect(newestFrom([msg('2', BOB, ME, 30)], BOB)).toBeUndefined();
  });
});
