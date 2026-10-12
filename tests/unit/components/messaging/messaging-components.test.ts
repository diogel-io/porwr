import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

import MessageComposer from '@/components/dashboard/messaging/MessageComposer.vue';
import ConversationList from '@/components/dashboard/messaging/ConversationList.vue';
import ConversationView from '@/components/dashboard/messaging/ConversationView.vue';
import type { ConversationSummary } from '@/utils/conversations';

const ME = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const STRANGER = 'd'.repeat(64);

const stubs = {
  'q-input': {
    template:
      '<textarea :value="modelValue" :disabled="disable" @input="$emit(\'update:modelValue\', $event.target.value)" @keydown="$emit(\'keydown\', $event)" />',
    props: ['modelValue', 'disable'],
    emits: ['update:modelValue', 'keydown'],
  },
  'q-btn': {
    template: '<button :disabled="disable" :aria-label="ariaLabel || label" @click="$emit(\'click\', $event)">{{ label }}</button>',
    props: ['label', 'ariaLabel', 'disable'],
    emits: ['click'],
  },
  'q-list': { template: '<ul><slot /></ul>' },
  'q-item': { template: '<li class="conversation" :data-peer="$attrs[\'data-peer\']" @click="$emit(\'click\')"><slot /></li>', emits: ['click'] },
  'q-item-section': { template: '<div><slot /></div>' },
  'q-item-label': { template: '<span><slot /></span>' },
  'q-avatar': { template: '<span class="avatar"><slot /></span>' },
  'q-badge': { template: '<span class="unread">{{ label }}</span>', props: ['label'] },
  'q-banner': { template: '<div class="q-banner"><slot /></div>' },
  'q-tabs': { template: '<div role="tablist"><slot /></div>' },
  'q-tab': { template: '<button role="tab" @click="$emit(\'click\', $event)"><slot /></button>', emits: ['click'] },
};

describe('MessageComposer', () => {
  const mountComposer = (props: { disabled?: boolean } = {}) => mount(MessageComposer, { props, global: { stubs } });

  it('sends on Enter and clears the draft', async () => {
    const wrapper = mountComposer();
    const input = wrapper.find('textarea');
    await input.setValue('  hello  ');
    await input.trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('send')).toEqual([['hello']]);
    expect((input.element as HTMLTextAreaElement).value).toBe('');
  });

  it('keeps Shift+Enter for a new line', async () => {
    const wrapper = mountComposer();
    await wrapper.find('textarea').setValue('line');
    await wrapper.find('textarea').trigger('keydown', { key: 'Enter', shiftKey: true });

    expect(wrapper.emitted('send')).toBeUndefined();
  });

  it('sends with the button, and never sends an empty draft', async () => {
    const wrapper = mountComposer();
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('send')).toBeUndefined();

    await wrapper.find('textarea').setValue('hi');
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('send')).toEqual([['hi']]);
  });

  it('does not send while disabled', async () => {
    const wrapper = mountComposer({ disabled: true });
    await wrapper.find('textarea').setValue('hi');
    await wrapper.find('textarea').trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('send')).toBeUndefined();
  });
});

describe('ConversationList (#258, Concept C)', () => {
  const CAROL = 'c'.repeat(64);
  const DANA = 'e'.repeat(64);
  const names: Record<string, string> = { [BOB]: 'Bob', [STRANGER]: 'Stranger', [CAROL]: 'Carol', [DANA]: 'Dana' };
  const conversations: ConversationSummary[] = [
    { peer: STRANGER, unread: 1, isRequest: true, removable: false, lastMessage: { id: '2', peer: STRANGER, pubkey: STRANGER, created_at: 2, content: 'hey there' } },
    { peer: BOB, unread: 2, isRequest: false, removable: false, lastMessage: { id: '1', peer: BOB, pubkey: ME, created_at: 1, content: 'see you' } },
    { peer: CAROL, unread: 0, isRequest: false, removable: true },
  ];
  const mountList = (props: Partial<InstanceType<typeof ConversationList>['$props']> = {}) =>
    mount(ConversationList, {
      props: {
        conversations,
        selectedPeer: undefined,
        nameOf: (p: string) => names[p] ?? p,
        pictureOf: () => undefined,
        detailOf: (p: string) => `detail-${names[p]}`,
        findContacts: (q: string) => Object.keys(names).filter((p) => names[p]!.toLowerCase().includes(q.toLowerCase()) && p !== STRANGER),
        ...props,
      },
      global: { stubs },
    });

  it('shows chats in the Chats tab and requests only in the Requests tab', async () => {
    const wrapper = mountList();

    expect(wrapper.find('[data-testid="conversation-list-chats"]').text()).toContain('Bob');
    expect(wrapper.find('[data-testid="conversation-list-chats"]').text()).not.toContain('Stranger');

    await wrapper.find('[data-testid="conversation-tab-requests"]').trigger('click');

    expect(wrapper.find('[data-testid="conversation-list-requests"]').text()).toContain('Stranger');
    expect(wrapper.find('[data-testid="conversation-list-chats"]').exists()).toBe(false);
  });

  it('shows each tab’s unread total and each conversation’s count', () => {
    const wrapper = mountList();

    expect(wrapper.find('[data-testid="conversation-tab-chats"] .unread').text()).toBe('2');
    expect(wrapper.find('[data-testid="conversation-tab-requests"] .unread').text()).toBe('1');
    expect(wrapper.find(`li[data-peer="${BOB}"] .unread`).text()).toBe('2');
  });

  it('marks the account’s own last message, and says when there is none', () => {
    const wrapper = mountList();

    expect(wrapper.find(`li[data-peer="${BOB}"]`).text()).toContain('messaging.list.fromMe:see you');
    expect(wrapper.find(`li[data-peer="${CAROL}"]`).text()).toContain('messaging.list.noMessages');
  });

  it('selects a conversation', async () => {
    const wrapper = mountList();
    await wrapper.find(`li[data-peer="${BOB}"]`).trigger('click');

    expect(wrapper.emitted('select')).toEqual([[BOB]]);
  });

  it('offers to remove only an added conversation with no messages', async () => {
    const wrapper = mountList();

    expect(wrapper.findAll('[data-testid="conversation-remove"]')).toHaveLength(1);
    await wrapper.find(`li[data-peer="${CAROL}"] [data-testid="conversation-remove"]`).trigger('click');

    expect(wrapper.emitted('remove')).toEqual([[CAROL]]);
    expect(wrapper.emitted('select')).toBeUndefined();
  });

  it('searching narrows chats and offers matching contacts to start a conversation with', async () => {
    const wrapper = mountList();

    await wrapper.find('[data-testid="conversation-search"]').setValue('a');

    expect(wrapper.find('[data-testid="conversation-list-chats"]').text()).toContain('Carol');
    expect(wrapper.find('[data-testid="conversation-list-chats"]').text()).not.toContain('Bob');
    const results = wrapper.find('[data-testid="conversation-search-results"]');
    expect(results.text()).toContain('Dana');
    expect(results.text()).toContain('detail-Dana');
    // Carol already has a row, so she is not offered again.
    expect(results.text()).not.toContain('Carol');
  });

  it('starts a conversation from a search result and clears the search', async () => {
    const wrapper = mountList();
    await wrapper.find('[data-testid="conversation-search"]').setValue('dana');

    await wrapper.find(`[data-testid="conversation-search-results"] li[data-peer="${DANA}"]`).trigger('click');

    expect(wrapper.emitted('start')).toEqual([[DANA]]);
    expect(wrapper.find('[data-testid="conversation-search-results"]').exists()).toBe(false);
  });

  it('says when a search matches nobody', async () => {
    const wrapper = mountList();

    await wrapper.find('[data-testid="conversation-search"]').setValue('zzz');

    expect(wrapper.find('[data-testid="conversation-search-empty"]').text()).toContain('messaging.list.noMatches:zzz');
  });

  it('points to search when there are no chats, and says when there are no requests', async () => {
    const wrapper = mountList({ conversations: [] });

    expect(wrapper.find('[data-testid="conversation-list-empty"]').text()).toContain('messaging.list.noChatsHint');

    await wrapper.find('[data-testid="conversation-tab-requests"]').trigger('click');
    expect(wrapper.find('[data-testid="conversation-requests-empty"]').exists()).toBe(true);
  });

  it('shows the loading state, not the empty one, before contacts arrive', () => {
    const wrapper = mountList({ conversations: [], loading: true });

    expect(wrapper.find('[data-testid="conversation-list-loading"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="conversation-list-empty"]').exists()).toBe(false);
  });

  it('follows a request to Chats once it has been answered', async () => {
    const wrapper = mountList({ selectedPeer: STRANGER });
    await wrapper.find('[data-testid="conversation-tab-requests"]').trigger('click');

    await wrapper.setProps({
      conversations: [{ ...conversations[0]!, isRequest: false }, ...conversations.slice(1)],
    });

    expect(wrapper.find('[data-testid="conversation-list-chats"]').text()).toContain('Stranger');
  });
});

describe('ConversationView', () => {
  const mountView = (props: Partial<InstanceType<typeof ConversationView>['$props']> = {}) =>
    mount(ConversationView, {
      props: {
        peerName: 'Bob',
        me: ME,
        messages: [
          { id: '1', peer: BOB, pubkey: BOB, created_at: 1, content: 'hello' },
          { id: '2', peer: BOB, pubkey: ME, created_at: 2, content: 'hi bob' },
        ],
        pending: [],
        ...props,
      },
      global: { stubs },
    });

  it('shows both sides of the conversation', () => {
    const wrapper = mountView();
    const bubbles = wrapper.findAll('[data-from]').map((el) => [el.attributes('data-from'), el.text().split('\n')[0]]);

    expect(bubbles.map(([from]) => from)).toEqual(['peer', 'me']);
    expect(wrapper.text()).toContain('hello');
    expect(wrapper.text()).toContain('hi bob');
  });

  it('shows a message being sent, and lets a failed one be retried', async () => {
    const wrapper = mountView({
      pending: [
        { clientMessageId: 'p1', peer: BOB, content: 'on its way', status: 'sending' },
        { clientMessageId: 'p2', peer: BOB, content: 'lost', status: 'failed' },
      ],
    });

    expect(wrapper.find('[data-status="sending"]').text()).toContain('messaging.view.sending');
    await wrapper.find('[data-status="failed"] button').trigger('click');
    expect(wrapper.emitted('retry')).toEqual([['p2']]);
  });

  it('warns and blocks sending when the peer cannot receive messages', () => {
    const wrapper = mountView({ recipientNotReady: true });

    expect(wrapper.find('[data-testid="recipient-not-ready"]').text()).toContain('messaging.view.recipientNotReady:Bob');
    expect(wrapper.find('textarea').attributes('disabled')).toBeDefined();
  });

  it('passes a typed message up', async () => {
    const wrapper = mountView();
    await wrapper.find('textarea').setValue('new');
    await wrapper.find('textarea').trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('send')).toEqual([['new']]);
  });

  it('says when a conversation has no messages yet', () => {
    expect(mountView({ messages: [] }).text()).toContain('messaging.view.empty');
  });
});
