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
  writeContactList: vi.fn(),
  upsertProfiles: vi.fn(),
  notify: vi.fn(),
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

vi.mock('@/services/contact-cache', () => ({
  writeContactList: mocks.writeContactList,
  upsertProfiles: mocks.upsertProfiles,
}));

vi.mock('@/services/contact-list-service', () => ({
  publishContactList: mocks.publishContactList,
  searchContacts: vi.fn(),
  formatContactNpub: (pubkey: string) => `npub-${pubkey.slice(0, 4)}`,
  getContactDisplayName: (
    contact: { pubkey: string; petname: string },
    profile?: { name: string },
  ) => profile?.name || contact.petname || `npub-${contact.pubkey.slice(0, 4)}`,
}));

vi.mock('@/stores/account-store', () => ({
  default: () => ({
    activeKey: 'alice',
    activeAccountOrFirst: { id: ME, alias: 'alice', createdAt: '' },
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

import ContactListPage from '@/pages/dashboard/ContactListPage.vue';

const slot = { template: '<div><slot /></div>' };
const stubs = {
  'q-page': slot,
  'q-card': slot,
  'q-card-section': slot,
  'q-banner': slot,
  'q-chip': slot,
  'q-list': slot,
  'q-item': slot,
  'q-item-section': slot,
  'q-item-label': { template: '<span class="label"><slot /></span>' },
  'q-avatar': slot,
  'q-tooltip': slot,
  'q-slide-transition': slot,
  'q-separator': true,
  'q-icon': true,
  'q-spinner': true,
  'q-input': true,
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
