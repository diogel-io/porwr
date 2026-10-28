import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import type { DirectMessage } from '@/types/messaging';
import { SUPPORT_PUBKEY } from '@/data/support';

const ME = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const STRANGER = 'd'.repeat(64);

const mocks = vi.hoisted(() => ({
  fetchMessages: vi.fn(),
  sendMessage: vi.fn(),
  getReadState: vi.fn(),
  markConversationRead: vi.fn(),
  fetchContactProfiles: vi.fn(),
  requestContactRefresh: vi.fn(),
  getSavedPeers: vi.fn(),
  addSavedPeer: vi.fn(),
  removeSavedPeer: vi.fn(),
  observeContactCache: vi.fn(),
  cachedContacts: {} as Record<
    string,
    { pubkey: string; relayUrl: string; petname: string }[] | undefined
  >,
  notify: vi.fn(),
  getKeys: vi.fn(),
  setActiveKey: vi.fn(),
  store: {
    activeKey: 'alice' as string | undefined,
    hasNoAccounts: false,
    activeAccountOrFirst: {
      id: 'a'.repeat(64),
      alias: 'alice',
      createdAt: '',
      account: { privkey: '' },
    } as unknown,
  },
}));

vi.mock('@/services/messaging-service', () => ({
  fetchMessages: mocks.fetchMessages,
  sendMessage: mocks.sendMessage,
  getReadState: mocks.getReadState,
  markConversationRead: mocks.markConversationRead,
  getSavedPeers: mocks.getSavedPeers,
  addSavedPeer: mocks.addSavedPeer,
  removeSavedPeer: mocks.removeSavedPeer,
}));

vi.mock('@/services/contact-list-service', () => ({
  fetchContactProfiles: mocks.fetchContactProfiles,
  requestContactRefresh: mocks.requestContactRefresh,
  formatContactNpub: (pubkey: string) => `npub1${pubkey}`,
  getContactDisplayName: (
    contact: { pubkey: string; petname: string },
    profile?: { name: string },
  ) => profile?.name || contact.petname || `npub-${contact.pubkey.slice(0, 4)}`,
}));

vi.mock('@/services/contact-cache', () => ({
  observeContactCache: mocks.observeContactCache,
}));

// Reactive, so switching account in a test reaches the page's watcher as the real store would.
vi.mock('@/stores/account-store', async () => {
  const { reactive } = await import('vue');
  mocks.store = reactive(mocks.store);
  return {
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
  };
});

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

const msg = (
  id: string,
  peer: string,
  from: string,
  created_at: number,
  content = id,
): DirectMessage => ({
  id,
  peer,
  pubkey: from,
  created_at,
  content,
});

const stubs = {
  'q-page': { template: '<div><slot /></div>' },
  'q-card': { template: '<div><slot /></div>' },
  'q-banner': {
    template: '<div class="q-banner" v-bind="$attrs"><slot /><slot name="action" /></div>',
  },
  'q-btn': {
    template:
      '<button :disabled="disable" :aria-label="ariaLabel || label" @click="$emit(\'click\', $event)">{{ label }}</button>',
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
  'q-item': {
    template:
      '<li class="conversation" :data-peer="$attrs[\'data-peer\']" @click="$emit(\'click\')"><slot /></li>',
    emits: ['click'],
  },
  'q-item-section': { template: '<div><slot /></div>' },
  'q-item-label': { template: '<span><slot /></span>' },
  'q-avatar': { template: '<span><slot /></span>' },
  'q-badge': { template: '<span class="unread">{{ label }}</span>', props: ['label'] },
  'q-tabs': { template: '<div role="tablist"><slot /></div>' },
  'q-tab': {
    template: '<button role="tab" @click="$emit(\'click\', $event)"><slot /></button>',
    emits: ['click'],
  },
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
  // The search field is a q-input too; type into the composer's.
  await wrapper.find('.message-composer textarea').setValue(text);
  await wrapper.find('.message-composer textarea').trigger('keydown', { key: 'Enter' });
  await flushPromises();
};

let uuid = 0;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  uuid = 0;
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => `uuid-${++uuid}`,
    configurable: true,
  });
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  mocks.store.activeKey = 'alice';
  mocks.store.hasNoAccounts = false;
  mocks.store.activeAccountOrFirst = {
    id: ME,
    alias: 'alice',
    createdAt: '',
    account: { privkey: '' },
  };
  mocks.getKeys.mockResolvedValue(undefined);
  mocks.cachedContacts = { [ME]: [{ pubkey: BOB, relayUrl: '', petname: 'Bob' }] };
  mocks.observeContactCache.mockImplementation(
    (accountPubkey: string, onChange: (snapshot: unknown) => void) => {
      const contacts = mocks.cachedContacts[accountPubkey];
      onChange({
        list: contacts ? { accountPubkey, contacts, fetchedAt: 1 } : undefined,
        profiles: {},
      });
      return () => undefined;
    },
  );
  mocks.requestContactRefresh.mockResolvedValue(undefined);
  mocks.fetchContactProfiles.mockResolvedValue({});
  mocks.getReadState.mockResolvedValue({});
  // Bob was added through search, so his conversation is listed before any message (#258).
  mocks.getSavedPeers.mockResolvedValue([BOB]);
  mocks.addSavedPeer.mockImplementation((peer: string) => Promise.resolve([BOB, peer]));
  mocks.removeSavedPeer.mockResolvedValue([]);
  mocks.markConversationRead.mockImplementation((peer: string, readAt: number) =>
    Promise.resolve({ [peer]: readAt }),
  );
  mocks.fetchMessages.mockResolvedValue({ inbox: 'ready', messages: [], dropped: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MessagingPage', () => {
  it('keeps the support conversation on the Support page when support is not a contact (#228)', async () => {
    mocks.fetchMessages.mockResolvedValue({
      inbox: 'ready',
      messages: [
        msg('s', SUPPORT_PUBKEY, SUPPORT_PUBKEY, 30, 'support reply'),
        msg('1', BOB, BOB, 10, 'hi from bob'),
      ],
      dropped: 0,
    });

    const wrapper = await mountPage();
    expect(wrapper.find(`li[data-peer="${BOB}"]`).exists()).toBe(true);
    expect(wrapper.find('[data-testid="conversation-tab-requests"] .unread').exists()).toBe(false);

    await wrapper.find('[data-testid="conversation-tab-requests"]').trigger('click');

    expect(wrapper.find(`li[data-peer="${SUPPORT_PUBKEY}"]`).exists()).toBe(false);
    expect(wrapper.text()).not.toContain('support reply');
  });

  it('lists the support conversation when support is one of the contacts (#228)', async () => {
    mocks.cachedContacts = {
      [ME]: [
        { pubkey: BOB, relayUrl: '', petname: 'Bob' },
        { pubkey: SUPPORT_PUBKEY, relayUrl: '', petname: 'Diogel' },
      ],
    };
    mocks.fetchMessages.mockResolvedValue({
      inbox: 'ready',
      messages: [msg('s', SUPPORT_PUBKEY, SUPPORT_PUBKEY, 30, 'support reply')],
      dropped: 0,
    });

    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="conversation-list-chats"]').text()).toContain('Diogel');
  });

  it('lists conversations under Chats and non-contacts under Requests, with unread counts', async () => {
    mocks.fetchMessages.mockResolvedValue({
      inbox: 'ready',
      messages: [
        msg('1', BOB, BOB, 10, 'hi from bob'),
        msg('2', STRANGER, STRANGER, 20, 'who dis'),
      ],
      dropped: 0,
    });

    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="conversation-list-chats"]').text()).toContain('Bob');
    expect(wrapper.find('[data-testid="conversation-tab-chats"] .unread').text()).toBe('1');
    expect(wrapper.find('[data-testid="conversation-tab-requests"] .unread').text()).toBe('1');

    await wrapper.find('[data-testid="conversation-tab-requests"]').trigger('click');
    expect(wrapper.find('[data-testid="conversation-list-requests"]').text()).toContain('who dis');
  });

  it('does not list a contact with no messages who was never added (#258)', async () => {
    mocks.getSavedPeers.mockResolvedValue([]);

    const wrapper = await mountPage();

    expect(wrapper.find(`li[data-peer="${BOB}"]`).exists()).toBe(false);
    expect(wrapper.find('[data-testid="conversation-list-empty"]').exists()).toBe(true);
  });

  it('finds a contact by searching the cache, adds them and opens the conversation (#258)', async () => {
    mocks.getSavedPeers.mockResolvedValue([]);
    const wrapper = await mountPage();

    await wrapper.find('[data-testid="conversation-search"]').setValue('bob');
    await flushPromises();
    await wrapper
      .find(`[data-testid="conversation-search-results"] li[data-peer="${BOB}"]`)
      .trigger('click');
    await flushPromises();

    expect(mocks.addSavedPeer).toHaveBeenCalledWith(BOB);
    expect(mocks.fetchContactProfiles).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="conversation-list-chats"]').text()).toContain('Bob');
    expect(wrapper.find('.message-composer').exists()).toBe(true);
  });

  it('takes the added contact back off if saving fails', async () => {
    mocks.getSavedPeers.mockResolvedValue([]);
    mocks.addSavedPeer.mockRejectedValue(new Error('Vault is locked'));
    const wrapper = await mountPage();

    await wrapper.find('[data-testid="conversation-search"]').setValue('bob');
    await flushPromises();
    await wrapper
      .find(`[data-testid="conversation-search-results"] li[data-peer="${BOB}"]`)
      .trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="conversation-list-chats"]').exists()).toBe(false);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
  });

  it('removes an added conversation that has no messages', async () => {
    const wrapper = await mountPage();

    await wrapper
      .find(`li[data-peer="${BOB}"] [data-testid="conversation-remove"]`)
      .trigger('click');
    await flushPromises();

    expect(mocks.removeSavedPeer).toHaveBeenCalledWith(BOB);
    expect(wrapper.find(`li[data-peer="${BOB}"]`).exists()).toBe(false);
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

    expect(mocks.sendMessage).toHaveBeenCalledWith({
      clientMessageId: 'uuid-1',
      recipient: BOB,
      content: 'are you there?',
    });
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

    expect(mocks.sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ clientMessageId: 'uuid-1' }),
    );
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
    mocks.fetchMessages.mockResolvedValueOnce({
      inbox: 'ready',
      messages: [msg('1', BOB, BOB, 1_000)],
      dropped: 0,
    });
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

  it('shows a loading indicator, not "no contacts", before contacts are cached (#257)', async () => {
    mocks.cachedContacts = {};

    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="conversation-list-loading"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('messaging.list.empty');
  });

  it('shows cached contacts without asking relays for the contact list (#257)', async () => {
    // Bob is listed as an added conversation; his name comes from the cached contact list.
    const wrapper = await mountPage();

    expect(wrapper.find(`li[data-peer="${BOB}"]`).exists()).toBe(true);
    expect(mocks.requestContactRefresh).toHaveBeenCalled();
    // Contacts' profiles come from the cache; nothing to look up when nobody else wrote.
    expect(mocks.fetchContactProfiles).not.toHaveBeenCalled();
  });

  it('looks up profiles only for writers who are not contacts', async () => {
    mocks.fetchMessages.mockResolvedValue({
      inbox: 'ready',
      messages: [msg('1', BOB, BOB, 10), msg('2', STRANGER, STRANGER, 20)],
      dropped: 0,
    });

    await mountPage();

    expect(mocks.fetchContactProfiles).toHaveBeenCalledWith([STRANGER]);
  });

  it('starts over when the active account changes', async () => {
    const wrapper = await mountPage();
    expect(mocks.observeContactCache).toHaveBeenCalledTimes(1);

    mocks.store.activeAccountOrFirst = {
      id: STRANGER,
      alias: 'other',
      createdAt: '',
      account: { privkey: '' },
    };
    // The store is not reactive in this test; re-mounting stands in for the switch the watcher covers.
    wrapper.unmount();
    const next = await mountPage();

    expect(mocks.observeContactCache).toHaveBeenLastCalledWith(
      STRANGER,
      expect.any(Function),
      expect.any(Function),
    );
    // The other account has no cached contacts, so Bob must not appear under it.
    expect(next.find(`li[data-peer="${BOB}"]`).exists()).toBe(false);
  });

  it('asks for an account when there is none', async () => {
    mocks.store.hasNoAccounts = true;
    mocks.store.activeAccountOrFirst = undefined;
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('account.noAccounts');
    expect(mocks.fetchMessages).not.toHaveBeenCalled();
  });

  describe('while the first fetch runs (#396)', () => {
    let finishFetch: (value: unknown) => void;
    let failFetch: (reason: unknown) => void;

    beforeEach(() => {
      // Nothing listed yet, so the list is empty until the fetch says otherwise.
      mocks.getSavedPeers.mockResolvedValue([]);
      mocks.fetchMessages.mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            finishFetch = resolve;
            failFetch = reject;
          }),
      );
    });

    it('shows the loading indicator, not "No conversations yet", once contacts are cached', async () => {
      const wrapper = await mountPage();

      expect(wrapper.find('[data-testid="conversation-list-loading"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="conversation-list-empty"]').exists()).toBe(false);
    });

    it('shows "No conversations yet" when the fetch finds none', async () => {
      const wrapper = await mountPage();

      finishFetch({ inbox: 'ready', messages: [], dropped: 0 });
      await flushPromises();

      expect(wrapper.find('[data-testid="conversation-list-loading"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="conversation-list-empty"]').exists()).toBe(true);
    });

    it('shows the conversations the fetch finds', async () => {
      const wrapper = await mountPage();

      finishFetch({ inbox: 'ready', messages: [msg('m', BOB, BOB, 10, 'hi')], dropped: 0 });
      await flushPromises();

      expect(wrapper.find('[data-testid="conversation-list-loading"]').exists()).toBe(false);
      expect(wrapper.find(`li[data-peer="${BOB}"]`).exists()).toBe(true);
    });

    it('stops loading and shows the notice when the fetch fails', async () => {
      const wrapper = await mountPage();

      failFetch(new Error('Vault is locked'));
      await flushPromises();

      expect(wrapper.find('[data-testid="conversation-list-loading"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="load-failed"]').exists()).toBe(true);
    });

    it('shows loading again after an account switch until the new account is fetched', async () => {
      const CAROL = 'c'.repeat(64);
      mocks.cachedContacts[CAROL] = [{ pubkey: BOB, relayUrl: '', petname: 'Bob' }];
      const wrapper = await mountPage();
      finishFetch({ inbox: 'ready', messages: [], dropped: 0 });
      await flushPromises();
      expect(wrapper.find('[data-testid="conversation-list-loading"]').exists()).toBe(false);

      mocks.store.activeAccountOrFirst = {
        id: CAROL,
        alias: 'carol',
        createdAt: '',
        account: { privkey: '' },
      };
      await flushPromises();

      expect(mocks.fetchMessages).toHaveBeenCalledTimes(2);
      expect(wrapper.find('[data-testid="conversation-list-loading"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="conversation-list-empty"]').exists()).toBe(false);

      finishFetch({ inbox: 'ready', messages: [], dropped: 0 });
      await flushPromises();

      expect(wrapper.find('[data-testid="conversation-list-loading"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="conversation-list-empty"]').exists()).toBe(true);
    });

    it("clears an earlier account's failure notice when switching account", async () => {
      const CAROL = 'c'.repeat(64);
      mocks.cachedContacts[CAROL] = [{ pubkey: BOB, relayUrl: '', petname: 'Bob' }];
      const wrapper = await mountPage();
      failFetch(new Error('Vault is locked'));
      await flushPromises();
      expect(wrapper.find('[data-testid="load-failed"]').exists()).toBe(true);

      mocks.store.activeAccountOrFirst = {
        id: CAROL,
        alias: 'carol',
        createdAt: '',
        account: { privkey: '' },
      };
      await flushPromises();

      expect(wrapper.find('[data-testid="load-failed"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="conversation-list-loading"]').exists()).toBe(true);
    });
  });
});
