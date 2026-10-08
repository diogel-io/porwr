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
    template: '<button :disabled="disable" :aria-label="ariaLabel || label" @click="$emit(\'click\')">{{ label }}</button>',
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

describe('ConversationList', () => {
  const conversations: ConversationSummary[] = [
    { peer: STRANGER, unread: 1, isContact: false, lastMessage: { id: '2', peer: STRANGER, pubkey: STRANGER, created_at: 2, content: 'hey there' } },
    { peer: BOB, unread: 0, isContact: true },
  ];
  const mountList = () =>
    mount(ConversationList, {
      props: { conversations, selectedPeer: undefined, nameOf: (p: string) => (p === BOB ? 'Bob' : 'Stranger'), pictureOf: () => undefined },
      global: { stubs },
    });

  it('keeps contacts and message requests apart', () => {
    const wrapper = mountList();

    expect(wrapper.find('[data-testid="conversation-section-contacts"]').text()).toContain('Bob');
    expect(wrapper.find('[data-testid="conversation-section-requests"]').text()).toContain('Stranger');
  });

  it('shows the last message, or that there is none, and an unread count', () => {
    const wrapper = mountList();

    expect(wrapper.text()).toContain('hey there');
    expect(wrapper.text()).toContain('messaging.list.noMessages');
    expect(wrapper.find('.unread').text()).toBe('1');
  });

  it('selects a conversation', async () => {
    const wrapper = mountList();
    await wrapper.find(`li[data-peer="${BOB}"]`).trigger('click');

    expect(wrapper.emitted('select')).toEqual([[BOB]]);
  });

  it('says when there is nothing to list', () => {
    const wrapper = mount(ConversationList, {
      props: { conversations: [], nameOf: () => '', pictureOf: () => undefined },
      global: { stubs },
    });
    expect(wrapper.text()).toContain('messaging.list.empty');
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
