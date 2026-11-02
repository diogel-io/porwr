import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import type { Ref } from 'vue';
import type { CachedContactList, ContactProfile } from '@/types/contact-list';

const ME = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const DAVE = 'd'.repeat(64);

const mocks = vi.hoisted(() => ({
  cache: {} as {
    list: Ref<CachedContactList | undefined>;
    profiles: Ref<Record<string, ContactProfile>>;
    status: Ref<'idle' | 'loading' | 'ready'>;
    error: Ref<string>;
    refresh: ReturnType<typeof vi.fn>;
  },
  publishContactList: vi.fn(),
  searchContacts: vi.fn(),
  writeContactList: vi.fn(),
  upsertProfiles: vi.fn(),
  notify: vi.fn(),
  dialog: vi.fn(),
  dialogHide: vi.fn(),
  /** Every dialog the page opened, in order, with its own handlers and whether it was hidden. */
  dialogs: [] as { ok?: () => void; dismiss?: () => void; hidden: boolean }[],
  /** The dismiss handler of the last dialog the page opened, which Quasar runs on OK or Cancel. */
  dialogDismiss: undefined as (() => void) | undefined,
  /** The OK handler of the last dialog the page opened. */
  dialogOk: undefined as (() => void) | undefined,
  account: {} as Ref<{ id: string; alias: string; createdAt: string }>,
  getKeys: vi.fn(),
  setActiveKey: vi.fn(),
}));

vi.mock('@/composables/useContactCache', async () => {
  const { computed, ref } = await import('vue');
  mocks.cache.list = ref(undefined);
  mocks.cache.profiles = ref({});
  mocks.cache.status = ref('loading');
  mocks.cache.error = ref('');
  mocks.cache.refresh = vi.fn();
  const contacts = computed(() => mocks.cache.list.value?.contacts ?? []);
  return { useContactCache: () => ({ ...mocks.cache, contacts }) };
});

// A small contact limit, so a list over it renders quickly.
vi.mock('@/services/contact-fetch', () => ({ MAX_CONTACTS_PER_ACCOUNT: 3 }));

vi.mock('@/services/contact-cache', () => ({
  writeContactList: mocks.writeContactList,
  upsertProfiles: mocks.upsertProfiles,
}));

vi.mock('@/services/contact-list-service', () => ({
  publishContactList: mocks.publishContactList,
  searchContacts: mocks.searchContacts,
  formatContactNpub: (pubkey: string) => `npub-${pubkey.slice(0, 4)}`,
  getContactDisplayName: (
    contact: { pubkey: string; petname: string },
    profile?: { name: string },
  ) => profile?.name || contact.petname || `npub-${contact.pubkey.slice(0, 4)}`,
}));

vi.mock('@/stores/account-store', async () => {
  const { ref } = await import('vue');
  mocks.account = ref({ id: 'a'.repeat(64), alias: 'alice', createdAt: '' });
  return {
    default: () => ({
      activeKey: 'alice',
      get activeAccountOrFirst() {
        return mocks.account.value;
      },
      getKeys: mocks.getKeys,
      setActiveKey: mocks.setActiveKey,
    }),
  };
});

vi.mock('quasar', () => ({
  useQuasar: () => ({ notify: mocks.notify, dialog: mocks.dialog }),
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

import ContactListPage from '@/pages/dashboard/ContactListPage.vue';
import { MAX_CONTACTS_PER_ACCOUNT } from '@/services/contact-fetch';

const slot = { template: '<div><slot /></div>' };
const stubs = {
  'q-page': slot,
  'q-card': slot,
  'q-card-section': slot,
  'q-banner': { template: '<div><slot /><slot name="action" /></div>' },
  'q-chip': slot,
  'q-list': slot,
  'q-item': { template: '<div @click="$emit(\'click\')"><slot /></div>', emits: ['click'] },
  'q-item-section': slot,
  'q-item-label': { template: '<span class="label"><slot /></span>' },
  'q-avatar': slot,
  'q-tooltip': slot,
  'q-slide-transition': slot,
  'q-separator': true,
  'q-icon': true,
  'q-spinner': true,
  'q-input': {
    template:
      '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    props: ['modelValue'],
    emits: ['update:modelValue'],
  },
  'q-btn': {
    template:
      '<button :disabled="disable" :aria-label="ariaLabel || label" :data-icon="icon" @click="$emit(\'click\')">{{ label }}</button>',
    props: ['label', 'ariaLabel', 'disable', 'icon', 'loading', 'to'],
    emits: ['click'],
  },
};

const mountPage = async () => {
  const wrapper = mount(ContactListPage, { global: { stubs } });
  await flushPromises();
  return wrapper;
};

const cachedList = (
  contacts: CachedContactList['contacts'],
  createdAt = 100,
): CachedContactList => ({
  accountPubkey: ME,
  contacts,
  sourceEventId: `event-${createdAt}`,
  sourceCreatedAt: createdAt,
  fetchedAt: 1,
});

const bob = { pubkey: BOB, relayUrl: '', petname: 'Bob' };
const dave = { pubkey: DAVE, relayUrl: '', petname: 'Dave' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.account.value = { id: ME, alias: 'alice', createdAt: '' };
  mocks.dialogOk = undefined;
  mocks.dialogDismiss = undefined;
  mocks.dialogs = [];
  mocks.dialog.mockImplementation(() => {
    // Like Quasar's dialog chain: onOk returns the same object, which can be hidden.
    const record: (typeof mocks.dialogs)[number] = { hidden: false };
    mocks.dialogs.push(record);
    const chain = {
      onOk(handler: () => void) {
        record.ok = handler;
        mocks.dialogOk = handler;
        return chain;
      },
      onDismiss(handler: () => void) {
        record.dismiss = handler;
        mocks.dialogDismiss = handler;
        return chain;
      },
      hide: () => {
        record.hidden = true;
        mocks.dialogHide();
      },
    };
    return chain;
  });
  mocks.cache.list.value = undefined;
  mocks.cache.profiles.value = {};
  mocks.cache.status.value = 'loading';
  mocks.cache.error.value = '';
  mocks.getKeys.mockResolvedValue(undefined);
  mocks.writeContactList.mockResolvedValue(true);
  mocks.upsertProfiles.mockResolvedValue(undefined);
  mocks.publishContactList.mockImplementation((_account: string, contacts: unknown[]) =>
    Promise.resolve({ event: { id: 'event-200', created_at: 200, contacts }, relayResults: [] }),
  );
});

describe('ContactListPage (#257)', () => {
  it('shows a loading indicator, not "no contacts", before the cache has a list', async () => {
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('contacts.loading');
    expect(wrapper.text()).not.toContain('contacts.emptyTitle');
  });

  it('shows cached contacts with their cached profiles at once', async () => {
    mocks.cache.list.value = cachedList([bob]);
    mocks.cache.profiles.value = {
      [BOB]: {
        pubkey: BOB,
        name: 'Bobby',
        displayName: '',
        about: '',
        picture: '',
        nip05: '',
        updatedAt: 1,
      },
    };
    mocks.cache.status.value = 'ready';

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('Bobby');
    expect(wrapper.text()).toContain('contacts.count:1');
  });

  it('picks up a list the background writes later, without a reload', async () => {
    const wrapper = await mountPage();

    mocks.cache.list.value = cachedList([bob, dave]);
    mocks.cache.status.value = 'ready';
    await flushPromises();

    expect(wrapper.text()).toContain('contacts.count:2');
  });

  it('writes a published list to the cache straight away', async () => {
    mocks.cache.list.value = cachedList([bob, dave]);
    mocks.cache.status.value = 'ready';
    const wrapper = await mountPage();

    await wrapper.findAll('button[aria-label="contacts.remove"]')[0]!.trigger('click');
    await wrapper.find('button[data-icon="publish"]').trigger('click');
    await flushPromises();

    expect(mocks.publishContactList).toHaveBeenCalledWith(ME, [dave]);
    expect(mocks.writeContactList).toHaveBeenCalledWith(ME, {
      contacts: [dave],
      sourceEventId: 'event-200',
      sourceCreatedAt: 200,
    });
  });

  it('does not let a background refresh overwrite unpublished edits', async () => {
    mocks.cache.list.value = cachedList([bob]);
    mocks.cache.status.value = 'ready';
    const wrapper = await mountPage();

    await wrapper.find('button[aria-label="contacts.remove"]').trigger('click');
    mocks.cache.list.value = cachedList([bob, dave], 150);
    await flushPromises();

    expect(wrapper.text()).toContain('contacts.count:0');
  });

  it('Refresh discards edits and forces a relay refresh', async () => {
    mocks.cache.list.value = cachedList([bob]);
    mocks.cache.status.value = 'ready';
    const wrapper = await mountPage();

    await wrapper.find('button[aria-label="contacts.remove"]').trigger('click');
    await wrapper.find('button[data-icon="refresh"]').trigger('click');
    await flushPromises();

    expect(mocks.cache.refresh).toHaveBeenCalledWith(true);
    expect(wrapper.text()).toContain('contacts.count:1');
  });
});

describe('ContactListPage truncated list (workspace#182)', () => {
  it('explains a truncated list and will not publish it, which would drop follows', async () => {
    mocks.cache.list.value = { ...cachedList([bob, dave]), truncated: true };
    mocks.cache.status.value = 'ready';
    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="contacts-truncated"]').text()).toBe(
      'contacts.truncatedWarning:3',
    );

    await wrapper.findAll('button[aria-label="contacts.remove"]')[0]!.trigger('click');
    const publish = wrapper.find('button[data-icon="publish"]');
    expect(publish.attributes('disabled')).toBeDefined();

    await publish.trigger('click');
    await flushPromises();
    expect(mocks.publishContactList).not.toHaveBeenCalled();
  });

  it('shows no notice for a list within the limit', async () => {
    mocks.cache.list.value = cachedList([bob]);
    mocks.cache.status.value = 'ready';
    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="contacts-truncated"]').exists()).toBe(false);
  });
});

describe('ContactListPage publish limits (workspace#182 review)', () => {
  const many = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      pubkey: index.toString(16).padStart(64, '0'),
      relayUrl: '',
      petname: '',
    }));

  it('keeps an edited truncated list unpublishable when a newer list reaches the cache', async () => {
    mocks.cache.list.value = { ...cachedList([bob, dave]), truncated: true };
    mocks.cache.status.value = 'ready';
    const wrapper = await mountPage();

    await wrapper.findAll('button[aria-label="contacts.remove"]')[0]!.trigger('click');
    mocks.cache.list.value = cachedList([bob], 150);
    await flushPromises();

    await wrapper.find('button[data-icon="publish"]').trigger('click');
    await flushPromises();
    expect(mocks.publishContactList).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="contacts-truncated"]').exists()).toBe(true);
  });

  it('will not publish an edited list longer than the cache keeps', async () => {
    // Over the limit and not marked truncated: what adding to a full list leaves on the page.
    mocks.cache.list.value = cachedList(many(MAX_CONTACTS_PER_ACCOUNT + 2));
    mocks.cache.status.value = 'ready';
    const wrapper = await mountPage();

    await wrapper.findAll('button[aria-label="contacts.remove"]')[0]!.trigger('click');
    const publish = wrapper.find('button[data-icon="publish"]');

    expect(wrapper.find('[data-testid="contacts-over-limit"]').exists()).toBe(true);
    expect(publish.attributes('disabled')).toBeDefined();
    await publish.trigger('click');
    await flushPromises();
    expect(mocks.publishContactList).not.toHaveBeenCalled();
  });
});

describe('ContactListPage newer list during edits (#430)', () => {
  const editThenReceive = async (newer: CachedContactList) => {
    mocks.cache.list.value = cachedList([bob]);
    mocks.cache.status.value = 'ready';
    const wrapper = await mountPage();
    await wrapper.find('button[aria-label="contacts.remove"]').trigger('click');
    mocks.cache.list.value = newer;
    await flushPromises();
    return wrapper;
  };
  const notice = (wrapper: Awaited<ReturnType<typeof mountPage>>) =>
    wrapper.find('[data-testid="contacts-newer-list"]');
  const publish = async (wrapper: Awaited<ReturnType<typeof mountPage>>) => {
    await wrapper.find('button[data-icon="publish"]').trigger('click');
    await flushPromises();
  };

  it('tells the user, keeps the edits, and asks before Publish replaces the newer list', async () => {
    const wrapper = await editThenReceive(cachedList([bob, dave], 150));

    expect(notice(wrapper).exists()).toBe(true);
    expect(notice(wrapper).text()).toContain(
      `contacts.newerListWarning:${new Date(150_000).toLocaleString()}`,
    );
    expect(wrapper.text()).toContain('contacts.count:0');

    await publish(wrapper);
    expect(mocks.dialog).toHaveBeenCalledTimes(1);
    expect(mocks.dialog.mock.calls[0]![0]).toMatchObject({
      title: 'contacts.replaceNewerTitle',
      persistent: true,
    });
    expect(mocks.publishContactList).not.toHaveBeenCalled();
  });

  it('publishes the edits once the user confirms', async () => {
    const wrapper = await editThenReceive(cachedList([bob, dave], 150));

    await publish(wrapper);
    mocks.dialogOk!();
    await flushPromises();

    expect(mocks.publishContactList).toHaveBeenCalledWith(ME, []);
  });

  it('asks again when yet another list arrives while the dialog is open', async () => {
    const wrapper = await editThenReceive(cachedList([bob, dave], 150));

    await publish(wrapper);
    mocks.cache.list.value = cachedList([dave], 180);
    await flushPromises();
    mocks.dialogOk!();
    await flushPromises();

    expect(mocks.publishContactList).not.toHaveBeenCalled();
    expect(mocks.dialog).toHaveBeenCalledTimes(2);
    expect(mocks.dialog.mock.calls[1]![0].message).toBe(
      `contacts.replaceNewerBody:${new Date(180_000).toLocaleString()}`,
    );

    mocks.dialogOk!();
    await flushPromises();
    expect(mocks.publishContactList).toHaveBeenCalledWith(ME, []);
  });

  it('closes an open confirmation when the page goes away, so it cannot publish later', async () => {
    const wrapper = await editThenReceive(cachedList([bob, dave], 150));

    await publish(wrapper);
    expect(mocks.dialogHide).not.toHaveBeenCalled();
    wrapper.unmount();

    expect(mocks.dialogHide).toHaveBeenCalledTimes(1);
  });

  it('does not hide a confirmation that was already closed when the page goes away', async () => {
    const wrapper = await editThenReceive(cachedList([bob, dave], 150));

    await publish(wrapper);
    // Cancel: Quasar closes the dialog, and hiding it again would throw.
    mocks.dialogDismiss!();
    wrapper.unmount();

    expect(mocks.dialogHide).not.toHaveBeenCalled();
  });

  it('still closes the second confirmation when the first one is dismissed after it opens', async () => {
    const wrapper = await editThenReceive(cachedList([bob, dave], 150));

    await publish(wrapper);
    mocks.cache.list.value = cachedList([dave], 180);
    await flushPromises();
    // Quasar runs a dialog's OK handlers, which here open the second dialog, then its dismiss ones.
    const [first] = mocks.dialogs;
    first!.ok!();
    first!.dismiss!();
    expect(mocks.dialogs).toHaveLength(2);

    wrapper.unmount();

    expect(mocks.dialogs[1]!.hidden).toBe(true);
    expect(first!.hidden).toBe(false);
  });

  it('publishes nothing and keeps the notice when the user cancels', async () => {
    const wrapper = await editThenReceive(cachedList([bob, dave], 150));

    // Cancel is the dialog closing without its OK handler running.
    await publish(wrapper);

    expect(mocks.publishContactList).not.toHaveBeenCalled();
    expect(notice(wrapper).exists()).toBe(true);
    expect(wrapper.text()).toContain('contacts.count:0');
  });

  it('"Load newer list" discards the edits and shows the newer list', async () => {
    const wrapper = await editThenReceive(cachedList([bob, dave], 150));

    await wrapper.find('button[aria-label="contacts.loadNewerList"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('contacts.count:2');
    expect(notice(wrapper).exists()).toBe(false);
    expect(mocks.cache.refresh).toHaveBeenCalledWith(true);
  });

  it('shows no notice, and publishes without asking, when no other list arrived', async () => {
    mocks.cache.list.value = cachedList([bob, dave]);
    mocks.cache.status.value = 'ready';
    const wrapper = await mountPage();

    await wrapper.findAll('button[aria-label="contacts.remove"]')[0]!.trigger('click');
    // The background writing the same list again is not a newer list.
    mocks.cache.list.value = { ...cachedList([bob, dave]), fetchedAt: 2 };
    await flushPromises();

    expect(notice(wrapper).exists()).toBe(false);
    await publish(wrapper);
    expect(mocks.dialog).not.toHaveBeenCalled();
    expect(mocks.publishContactList).toHaveBeenCalledWith(ME, [dave]);
  });

  it("does not take the page's own published list for a newer one", async () => {
    mocks.cache.list.value = cachedList([bob, dave]);
    mocks.cache.status.value = 'ready';
    // Saving profiles fails after the list is published and cached, so the edits stay unsaved and
    // nothing clears a wrong notice: only recording the published event before the cache write
    // keeps the page from taking its own list for a newer one.
    mocks.upsertProfiles.mockRejectedValue(new Error('profiles failed'));
    // The cache picks up the published list while the publish is still finishing.
    mocks.writeContactList.mockImplementation(async (_account: string, snapshot) => {
      mocks.cache.list.value = {
        ...cachedList(snapshot.contacts, 200),
        sourceEventId: 'event-200',
      };
      await flushPromises();
      return true;
    });
    const wrapper = await mountPage();

    await wrapper.findAll('button[aria-label="contacts.remove"]')[0]!.trigger('click');
    await publish(wrapper);

    expect(mocks.publishContactList).toHaveBeenCalledTimes(1);
    // The failure left the edits unsaved, which is when a wrong notice would stay.
    expect(wrapper.text()).toContain('profiles failed');
    expect(notice(wrapper).exists()).toBe(false);
    expect(wrapper.text()).toContain('contacts.count:1');
  });

  it('shows the notice when a list arrives after edits made before any list had loaded', async () => {
    // A ready cache with no list, which `useContactCache` does not produce: edits with no list to
    // start from are now blocked until the list loads (#429). Kept as a check of `applyCachedList`.
    mocks.cache.status.value = 'ready';
    const wrapper = await mountPage();
    mocks.searchContacts.mockResolvedValue([{ pubkey: DAVE, relayUrl: '' }]);
    await wrapper.find('button[data-icon="person_add"]').trigger('click');
    await wrapper.find('input').setValue('dave');
    await wrapper.find('button[data-icon="search"]').trigger('click');
    await flushPromises();
    await wrapper.find('button[aria-label="contacts.select"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('contacts.count:1');

    mocks.cache.list.value = cachedList([bob], 150);
    await flushPromises();

    expect(notice(wrapper).exists()).toBe(true);
  });

  it('clears the notice when the account changes', async () => {
    const wrapper = await editThenReceive(cachedList([bob, dave], 150));

    mocks.account.value = { id: 'c'.repeat(64), alias: 'carol', createdAt: '' };
    await flushPromises();

    expect(notice(wrapper).exists()).toBe(false);
  });
});

describe('ContactListPage before the list has loaded (#429)', () => {
  const addButton = (wrapper: Awaited<ReturnType<typeof mountPage>>) =>
    wrapper.find('button[data-icon="person_add"]');
  const publishButton = (wrapper: Awaited<ReturnType<typeof mountPage>>) =>
    wrapper.find('button[data-icon="publish"]');

  it('will not let a contact be added or anything be published while the list is loading', async () => {
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('contacts.loading');
    expect(addButton(wrapper).attributes('disabled')).toBeDefined();
    expect(publishButton(wrapper).attributes('disabled')).toBeDefined();

    await addButton(wrapper).trigger('click');
    await publishButton(wrapper).trigger('click');
    await flushPromises();

    expect(wrapper.find('input').exists()).toBe(false);
    expect(mocks.publishContactList).not.toHaveBeenCalled();
  });

  it('closes an open Add panel when the next account has no list yet, and publishes nothing', async () => {
    mocks.cache.list.value = cachedList([bob]);
    mocks.cache.status.value = 'ready';
    mocks.searchContacts.mockResolvedValue([{ pubkey: DAVE, relayUrl: '' }]);
    const wrapper = await mountPage();
    await addButton(wrapper).trigger('click');
    await wrapper.find('input').setValue('dave');
    await wrapper.find('button[data-icon="search"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('button[aria-label="contacts.select"]').exists()).toBe(true);

    // Switching account: the cache drops the old list and loads the next one.
    mocks.account.value = { id: 'c'.repeat(64), alias: 'carol', createdAt: '' };
    mocks.cache.list.value = undefined;
    mocks.cache.status.value = 'loading';
    await flushPromises();

    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="contacts.select"]').exists()).toBe(false);
    expect(addButton(wrapper).attributes('disabled')).toBeDefined();
    expect(publishButton(wrapper).attributes('disabled')).toBeDefined();
    await publishButton(wrapper).trigger('click');
    await flushPromises();
    expect(mocks.publishContactList).not.toHaveBeenCalled();
  });

  it('allows adding once the list has loaded', async () => {
    const wrapper = await mountPage();
    expect(addButton(wrapper).attributes('disabled')).toBeDefined();

    mocks.cache.list.value = cachedList([bob]);
    mocks.cache.status.value = 'ready';
    await flushPromises();

    expect(addButton(wrapper).attributes('disabled')).toBeUndefined();
    await addButton(wrapper).trigger('click');
    expect(wrapper.find('input').exists()).toBe(true);
  });
});
