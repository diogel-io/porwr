import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import type { DirectMessage } from '@/types/messaging';
import { SUPPORT_PUBKEY } from '@/data/support';

const ME = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

const mocks = vi.hoisted(() => ({
  fetchMessages: vi.fn(),
  sendMessage: vi.fn(),
  getReadState: vi.fn(),
  markConversationRead: vi.fn(),
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

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

import SupportPage from '@/pages/dashboard/SupportPage.vue';

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
    template: '<button :disabled="disable" @click="$emit(\'click\', $event)">{{ label }}</button>',
    props: ['label', 'ariaLabel', 'disable', 'to'],
    emits: ['click'],
  },
  'q-input': {
    template:
      '<textarea :value="modelValue" :disabled="disable" @input="$emit(\'update:modelValue\', $event.target.value)" @keydown="$emit(\'keydown\', $event)" />',
    props: ['modelValue', 'disable'],
    emits: ['update:modelValue', 'keydown'],
  },
};

const mountPage = async () => {
  const wrapper = mount(SupportPage, { global: { stubs } });
  await flushPromises();
  return wrapper;
};

const typeAndSend = async (wrapper: Awaited<ReturnType<typeof mountPage>>, text: string) => {
  await wrapper.find('.message-composer textarea').setValue(text);
  await wrapper.find('.message-composer textarea').trigger('keydown', { key: 'Enter' });
  await flushPromises();
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  let uuid = 0;
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value: () => `uuid-${++uuid}`, configurable: true });
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  mocks.store.activeKey = 'alice';
  mocks.store.hasNoAccounts = false;
  mocks.store.activeAccountOrFirst = { id: ME, alias: 'alice', createdAt: '', account: { privkey: '' } };
  mocks.getKeys.mockResolvedValue(undefined);
  mocks.getReadState.mockResolvedValue({});
  mocks.markConversationRead.mockImplementation((peer: string, readAt: number) => Promise.resolve({ [peer]: readAt }));
  mocks.fetchMessages.mockResolvedValue({ inbox: 'ready', messages: [], dropped: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SupportPage (#228)', () => {
  it('shows only the support conversation, sent and received together in time order', async () => {
    mocks.fetchMessages.mockResolvedValue({
      inbox: 'ready',
      messages: [
        msg('3', SUPPORT_PUBKEY, SUPPORT_PUBKEY, 30, 'how can we help?'),
        msg('1', SUPPORT_PUBKEY, ME, 10, 'my zap failed'),
        msg('2', BOB, BOB, 20, 'from bob'),
      ],
      dropped: 0,
    });

    const wrapper = await mountPage();

    const shown = wrapper.findAll('.conversation-view__bubble').map((bubble) => bubble.text());
    expect(shown).toEqual(['my zap failed', 'how can we help?']);
    expect(wrapper.text()).toContain('support.peerName');
    expect(wrapper.text()).not.toContain('from bob');
  });

  it('sends to the Diogel support account', async () => {
    mocks.sendMessage.mockResolvedValue({
      status: 'sent',
      message: msg('s1', SUPPORT_PUBKEY, ME, 40, 'hello support'),
      selfCopy: 'stored',
    });
    const wrapper = await mountPage();

    await typeAndSend(wrapper, 'hello support');

    expect(mocks.sendMessage).toHaveBeenCalledWith({
      clientMessageId: 'uuid-1',
      recipient: SUPPORT_PUBKEY,
      content: 'hello support',
    });
    expect(wrapper.findAll('.conversation-view__bubble').map((bubble) => bubble.text())).toEqual(['hello support']);
  });

  it('explains and blocks sending when the account has no direct message relays', async () => {
    mocks.fetchMessages.mockResolvedValue({ inbox: 'none', messages: [], dropped: 0 });

    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="no-inbox"]').text()).toContain('messaging.noInbox');
    expect(wrapper.find('.message-composer textarea').attributes('disabled')).toBeDefined();
  });

  it('says support cannot be reached, and stops sending, when support has no inbox', async () => {
    mocks.sendMessage.mockResolvedValue({ status: 'recipient-not-ready' });
    const wrapper = await mountPage();

    await typeAndSend(wrapper, 'hello?');

    expect(wrapper.find('[data-testid="support-not-reachable"]').text()).toContain('support.notReachable');
    expect(wrapper.find('.message-composer textarea').attributes('disabled')).toBeDefined();
  });

  it('marks the support conversation read when it is shown', async () => {
    mocks.fetchMessages.mockResolvedValue({
      inbox: 'ready',
      messages: [msg('1', SUPPORT_PUBKEY, SUPPORT_PUBKEY, 50, 'reply')],
      dropped: 0,
    });

    await mountPage();

    expect(mocks.markConversationRead).toHaveBeenCalledWith(SUPPORT_PUBKEY, 50);
  });

  it('shows the no-account state when there are no accounts', async () => {
    mocks.store.hasNoAccounts = true;
    mocks.store.activeAccountOrFirst = undefined;

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('account.noAccounts');
    expect(mocks.fetchMessages).not.toHaveBeenCalled();
  });

  it('polls for replies only while visible', async () => {
    await mountPage();
    expect(mocks.fetchMessages).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.fetchMessages).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.fetchMessages).toHaveBeenCalledTimes(2);
  });
});
