import { describe, it, expect, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';

import type { SendMessageResult } from '@/types/messaging';

const sendMessage = vi.hoisted(() => vi.fn());
const fetchMessages = vi.hoisted(() => vi.fn());

vi.mock('@/services/messaging-service', () => ({
  fetchMessages,
  getReadState: vi.fn(),
  markConversationRead: vi.fn(),
  sendMessage,
}));

import { useDirectMessages } from '@/composables/useDirectMessages';

function withComposable() {
  let api!: ReturnType<typeof useDirectMessages>;
  mount(
    defineComponent({
      setup() {
        api = useDirectMessages({ hasAccount: () => true });
        return () => h('div');
      },
    }),
  );
  return api;
}

const PEER = 'b'.repeat(64);
let uuid = 0;
globalThis.crypto.randomUUID = vi.fn(
  () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`,
) as typeof crypto.randomUUID;

describe('useDirectMessages send after an account switch (diogel-io/workspace#142)', () => {
  it("drops a send result that arrives after reset, so it never joins the new account's messages", async () => {
    let finish: (result: SendMessageResult) => void = () => undefined;
    sendMessage.mockImplementationOnce(
      () => new Promise<SendMessageResult>((resolve) => (finish = resolve)),
    );
    const dm = withComposable();

    dm.send(PEER, 'from the old account');
    dm.reset();
    finish({
      status: 'sent',
      message: {
        id: 'm1',
        pubkey: 'a'.repeat(64),
        peer: PEER,
        created_at: 1,
        content: 'from the old account',
      },
      accepted: [],
      unverified: [],
      rejected: [],
    } as unknown as SendMessageResult);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());
    await Promise.resolve();

    expect(dm.messages.value.size).toBe(0);
    expect(dm.pending.value).toEqual([]);
  });

  it('still merges a send that completes for the same account', async () => {
    sendMessage.mockResolvedValueOnce({
      status: 'sent',
      message: { id: 'm2', pubkey: 'a'.repeat(64), peer: PEER, created_at: 2, content: 'hi' },
      accepted: [],
      unverified: [],
      rejected: [],
    });
    const dm = withComposable();

    dm.send(PEER, 'hi');

    await vi.waitFor(() => expect(dm.messages.value.size).toBe(1));
  });
});

describe('useDirectMessages poll after an account switch (diogel-io/workspace#142)', () => {
  const message = (id: string, content: string) => ({
    id,
    pubkey: PEER,
    peer: PEER,
    created_at: 1,
    content,
  });

  it('ignores a poll that resolves after reset, and polls for the new account straight away', async () => {
    let finishOld: (value: unknown) => void = () => undefined;
    fetchMessages
      .mockImplementationOnce(() => new Promise((resolve) => (finishOld = resolve)))
      .mockResolvedValueOnce({
        inbox: 'ready',
        messages: [message('new', 'for carol')],
        dropped: 0,
      });
    const dm = withComposable();

    const oldPoll = dm.poll();
    dm.reset();
    await dm.poll();
    finishOld({ inbox: 'none', messages: [message('old', 'for bob')], dropped: 0 });
    await oldPoll;

    expect(fetchMessages).toHaveBeenCalledTimes(2);
    expect([...dm.messages.value.keys()]).toEqual(['new']);
    expect(dm.inbox.value).toBe('ready');
  });
});

describe('useDirectMessages inbox state (#396)', () => {
  it('returns the inbox to unknown on reset, so the page shows loading for the new account', async () => {
    fetchMessages.mockResolvedValueOnce({ inbox: 'ready', messages: [], dropped: 0 });
    const dm = withComposable();

    expect(dm.inbox.value).toBe('unknown');
    await dm.poll();
    expect(dm.inbox.value).toBe('ready');

    dm.reset();
    expect(dm.inbox.value).toBe('unknown');
  });
});
