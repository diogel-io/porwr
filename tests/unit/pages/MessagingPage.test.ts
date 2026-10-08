import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import type { DirectMessage } from '@/types/messaging';

const ME = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const STRANGER = 'd'.repeat(64);

const mocks = vi.hoisted(() => ({
  fetchMessages: vi.fn(),
  sendMessage: vi.fn(),
  getReadState: vi.fn(),
  markConversationRead: vi.fn(),
  fetchContactList: vi.fn(),
  fetchContactProfiles: vi.fn(),
  notify: vi.fn(),
  getKeys: vi.fn(),
  setActiveKey: vi.fn(),
  store: {
    activeKey: 'alice' as string | undefined,
    hasNoAccounts: false,
    activeAccountOrFirst: { id: 'a'.repeat(64), alias: 'alice', createdAt: '', account: { privkey: '' } } as unknown,
  },
}));

vi.mock('@/services/messaging-service', () => ({
  fetchMessages: mocks.fetchMessages,
  sendMessage: mocks.sendMessage,
  getReadState: mocks.getReadState,
  markConversationRead: mocks.markConversationRead,
}));

vi.mock('@/services/contact-list-service', () => ({
  fetchContactList: mocks.fetchContactList,
  fetchContactProfiles: mocks.fetchContactProfiles,
  getContactDisplayName: (contact: { pubkey: string; petname: string }, profile?: { name: string }) =>
    profile?.name || contact.petname || `npub-${contact.pubkey.slice(0, 4)}`,
}));

vi.mock('@/stores/account-store', () => ({
  default: () => ({
    get activeKey() {
      return mocks.store.activeKey;
    },
    get hasNoAccounts() {
      return mocks.store.hasNoAccounts;
    },
    get activeAccountOrFirst() {
      return mocks.store.activeAccountOrFirst;
    },
    getKeys: mocks.getKeys,
    setActiveKey: mocks.setActiveKey,
  }),
}));

vi.mock('quasar', () => ({ useQuasar: () => ({ notify: mocks.notify }) }));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

import MessagingPage from '@/pages/dashboard/MessagingPage.vue';

// Each mounted page registers a document visibility listener; leaving one mounted would let it poll
// in the next test.
enableAutoUnmount(afterEach);

const msg = (id: string, peer: string, from: string, created_at: number, content = id): DirectMessage => ({
  id,
  peer,
  pubkey: from,
  created_at,
  content,
});

const stubs = {
  'q-page': { template: '<div><slot /></div>' },
  'q-card': { template: '<div><slot /></div>' },
  'q-banner': { template: '<div class="q-banner" v-bind="$attrs"><slot /><slot name="action" /></div>' },
  'q-btn': {
    template: '<button :disabled="disable" :aria-label="ariaLabel || label" @click="$emit(\'click\')">{{ label }}</button>',
    props: ['label', 'ariaLabel', 'disable', 'to'],
    emits: ['click'],
  },
  'q-input': {
    template:
      '<textarea :value="modelValue" :disabled="disable" @input="$emit(\'update:modelValue\', $event.target.value)" @keydown="$emit(\'keydown\', $event)" />',
    props: ['modelValue', 'disable'],
    emits: ['update:modelValue', 'keydown'],
  },
  'q-list': { template: '<ul><slot /></ul>' },
  'q-item': { template: '<li class="conversation" :data-peer="$attrs[\'data-peer\']" @click="$emit(\'click\')"><slot /></li>', emits: ['click'] },
  'q-item-section': { template: '<div><slot /></div>' },
  'q-item-label': { template: '<span><slot /></span>' },
  'q-avatar': { template: '<span><slot /></span>' },
  'q-badge': { template: '<span class="unread">{{ label }}</span>', props: ['label'] },
};

const mountPage = async () => {
  const wrapper = mount(MessagingPage, { global: { stubs } });
  await flushPromises();
  return wrapper;
};

const openConversation = async (wrapper: Awaited<ReturnType<typeof mountPage>>, peer: string) => {
  await wrapper.find(`li[data-peer="${peer}"]`).trigger('click');
  await flushPromises();
};

const typeAndSend = async (wrapper: Awaited<ReturnType<typeof mountPage>>, text: string) => {
  await wrapper.find('textarea').setValue(text);
  await wrapper.find('textarea').trigger('keydown', { key: 'Enter' });
  await flushPromises();
};

let uuid = 0;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  uuid = 0;
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value: () => `uuid-${++uuid}`, configurable: true });
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  mocks.store.activeKey = 'alice';
  mocks.store.hasNoAccounts = false;
  mocks.store.activeAccountOrFirst = { id: ME, alias: 'alice', createdAt: '', account: { privkey: '' } };
  mocks.getKeys.mockResolvedValue(undefined);
  mocks.fetchContactList.mockResolvedValue({ contacts: [{ pubkey: BOB, relayUrl: '', petname: 'Bob' }] });
  mocks.fetchContactProfiles.mockResolvedValue({});
  mocks.getReadState.mockResolvedValue({});
  mocks.markConversationRead.mockImplementation((peer: string, readAt: number) => Promise.resolve({ [peer]: readAt }));
  mocks.fetchMessages.mockResolvedValue({ inbox: 'ready', messages: [], dropped: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MessagingPage', () => {
  it('lists contacts and message requests with unread counts', async () => {
    mocks.fetchMessages.mockResolvedValue({
      inbox: 'ready',
      messages: [msg('1', BOB, BOB, 10, 'hi from bob'), msg('2', STRANGER, STRANGER, 20, 'who dis')],
      dropped: 0,
    });

    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="conversation-section-contacts"]').text()).toContain('Bob');
    expect(wrapper.find('[data-testid="conversation-section-requests"]').text()).toContain('who dis');
    expect(wrapper.findAll('.unread').map((el) => el.text())).toEqual(['1', '1']);
  });

  it('shows a conversation and marks it read up to the newest message from the peer', async () => {
    mocks.fetchMessages.mockResolvedValue({
      inbox: 'ready',
      messages: [msg('1', BOB, BOB, 10, 'hello alice'), msg('2', BOB, ME, 15, 'hello bob')],
      dropped: 0,
    });
    const wrapper = await mountPage();

    await openConversation(wrapper, BOB);

    expect(wrapper.text()).toContain('hello alice');
    expect(wrapper.text()).toContain('hello bob');
    expect(mocks.markConversationRead).toHaveBeenCalledWith(BOB, 10);
    expect(wrapper.findAll('.unread')).toHaveLength(0);
  });

  it('sends a message and shows it once the background confirms', async () => {
    mocks.sendMessage.mockResolvedValue({
      status: 'sent',
      message: msg('sent-1', BOB, ME, 30, 'are you there?'),
      accepted: ['wss://bob.inbox'],
      rejected: [],
      selfCopy: 'stored',
    });
    const wrapper = await mountPage();
    await openConversation(wrapper, BOB);

    await typeAndSend(wrapper, 'are you there?');

    expect(mocks.sendMessage).toHaveBeenCalledWith({ clientMessageId: 'uuid-1', recipient: BOB, content: 'are you there?' });
    expect(wrapper.find('[data-from="me"]').text()).toContain('are you there?');
    expect(wrapper.find('[data-status]').exists()).toBe(false);
  });

  it('keeps a failed message and retries it with the same id', async () => {
    mocks.sendMessage.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({
      status: 'sent',
      message: msg('sent-1', BOB, ME, 30, 'retry me'),
      accepted: ['wss://bob.inbox'],
      rejected: [],
      selfCopy: 'stored',
    });
    const wrapper = await mountPage();
    await openConversation(wrapper, BOB);

    await typeAndSend(wrapper, 'retry me');
    expect(wrapper.find('[data-status="failed"]').exists()).toBe(true);

    await wrapper.find('[data-status="failed"] button').trigger('click');
    await flushPromises();

    expect(mocks.sendMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ clientMessageId: 'uuid-1' }));
    expect(wrapper.find('[data-status]').exists()).toBe(false);
    expect(wrapper.find('[data-from="me"]').text()).toContain('retry me');
  });

  it('warns when the contact cannot receive private messages', async () => {
    mocks.sendMessage.mockResolvedValue({ status: 'recipient-not-ready' });
    const wrapper = await mountPage();
    await openConversation(wrapper, BOB);

    await typeAndSend(wrapper, 'hello?');

    expect(wrapper.find('[data-testid="recipient-not-ready"]').exists()).toBe(true);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
  });

  it('tells an account with no inbox how to start receiving', async () => {
    mocks.fetchMessages.mockResolvedValue({ inbox: 'none', messages: [], dropped: 0 });
    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="no-inbox"]').text()).toContain('messaging.noInbox');
  });

  it('checks for new messages while visible, overlapping the last fetch, and stops when left', async () => {
    mocks.fetchMessages.mockResolvedValueOnce({ inbox: 'ready', messages: [msg('1', BOB, BOB, 1_000)], dropped: 0 });
    const wrapper = await mountPage();
    expect(mocks.fetchMessages).toHaveBeenCalledWith(undefined);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.fetchMessages).toHaveBeenLastCalledWith(1_000 - 600);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.fetchMessages).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(mocks.fetchMessages).toHaveBeenCalledTimes(3);

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.fetchMessages).toHaveBeenCalledTimes(3);
  });

  it('shows a notice when checking for messages fails', async () => {
    mocks.fetchMessages.mockRejectedValue(new Error('Vault is locked'));
    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="load-failed"]').exists()).toBe(true);
  });

  it('starts over when the active account changes', async () => {
    const wrapper = await mountPage();
    expect(mocks.fetchContactList).toHaveBeenCalledTimes(1);

    mocks.store.activeAccountOrFirst = { id: STRANGER, alias: 'other', createdAt: '', account: { privkey: '' } };
    // The store is not reactive in this test; re-mounting stands in for the switch the watcher covers.
    wrapper.unmount();
    await mountPage();

    expect(mocks.fetchContactList).toHaveBeenLastCalledWith(expect.objectContaining({ alias: 'other' }));
  });

  it('asks for an account when there is none', async () => {
    mocks.store.hasNoAccounts = true;
    mocks.store.activeAccountOrFirst = undefined;
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('account.noAccounts');
    expect(mocks.fetchMessages).not.toHaveBeenCalled();
  });
});
