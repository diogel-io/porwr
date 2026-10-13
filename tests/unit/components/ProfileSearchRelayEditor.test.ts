import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

/**
 * The Profile Search Relays card on the Relays page (#263): changes stay local until Save, and only
 * Save writes the list through the settings store.
 */

const DEFAULTS = ['wss://default.example'];

const mocks = vi.hoisted(() => ({
  notify: vi.fn(),
  store: {
    profileSearchRelays: [] as string[],
    getSettings: vi.fn(),
    setProfileSearchRelays: vi.fn(),
  },
}));

vi.mock('@/stores/settings-store', () => ({ default: () => mocks.store }));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

vi.mock('quasar', () => ({
  useQuasar: () => ({ notify: mocks.notify }),
}));

import ProfileSearchRelayEditor from '@/components/dashboard/ProfileSearchRelayEditor.vue';
import RelayBrowserModal from '@/components/dashboard/RelayBrowserModal.vue';

const mountEditor = async () => {
  const wrapper = mount(ProfileSearchRelayEditor, {
    global: {
      stubs: {
        'q-spinner': true,
        'q-tooltip': true,
        'q-list': { template: '<ul><slot /></ul>' },
        'q-item': { template: '<li class="search-relay"><slot /></li>' },
        'q-item-section': { template: '<div><slot /></div>' },
        'q-item-label': { template: '<span><slot /></span>' },
        'q-input': {
          template:
            '<div><input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /><slot name="append" /></div>',
          props: ['modelValue'],
          emits: ['update:modelValue'],
        },
        'q-btn': {
          template:
            '<button :aria-label="ariaLabel || label" :data-icon="icon" @click="$emit(\'click\')">{{ label }}</button>',
          props: ['label', 'ariaLabel', 'loading', 'icon'],
          emits: ['click'],
        },
        'relay-browser-modal': {
          template: '<div v-if="modelValue" class="mock-relay-browser" />',
          props: ['modelValue'],
          emits: ['update:modelValue', 'select'],
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
};

type Wrapper = Awaited<ReturnType<typeof mountEditor>>;

const listed = (wrapper: Wrapper) => wrapper.findAll('li.search-relay').map((item) => item.text());

const newRelayInput = (wrapper: Wrapper) => wrapper.find('input');

const add = async (wrapper: Wrapper, url: string) => {
  await newRelayInput(wrapper).setValue(url);
  await wrapper.find('button[aria-label="relays.profileSearch.add"]').trigger('click');
};

const save = async (wrapper: Wrapper) => {
  await wrapper.find('button[aria-label="relays.save"]').trigger('click');
  await flushPromises();
};

const unsavedHint = (wrapper: Wrapper) =>
  wrapper.find('[data-testid="profile-search-relays-unsaved"]');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.profileSearchRelays = ['wss://search.example'];
  mocks.store.getSettings.mockResolvedValue(undefined);
  mocks.store.setProfileSearchRelays.mockImplementation((relays: string[]) => {
    mocks.store.profileSearchRelays = relays.length > 0 ? [...relays] : DEFAULTS;
    return Promise.resolve();
  });
});

describe('ProfileSearchRelayEditor', () => {
  it('shows the stored relays once settings are read', async () => {
    const wrapper = await mountEditor();

    expect(mocks.store.getSettings).toHaveBeenCalledTimes(1);
    expect(listed(wrapper)).toEqual(['wss://search.example']);
    expect(unsavedHint(wrapper).exists()).toBe(false);
  });

  it('adds a relay locally and stores nothing until Save', async () => {
    const wrapper = await mountEditor();

    await add(wrapper, 'wss://second.example');

    expect(listed(wrapper)).toEqual(['wss://search.example', 'wss://second.example']);
    expect(unsavedHint(wrapper).exists()).toBe(true);
    expect(mocks.store.setProfileSearchRelays).not.toHaveBeenCalled();
  });

  it('ignores a relay that is already listed', async () => {
    const wrapper = await mountEditor();

    await add(wrapper, 'wss://search.example');

    expect(listed(wrapper)).toEqual(['wss://search.example']);
    expect(unsavedHint(wrapper).exists()).toBe(false);
  });

  it('rejects a URL that is not a relay', async () => {
    const wrapper = await mountEditor();

    await add(wrapper, 'https://web.example');

    expect(listed(wrapper)).toEqual(['wss://search.example']);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
  });

  it('removes a relay', async () => {
    const wrapper = await mountEditor();

    await wrapper
      .find('button[aria-label="relays.profileSearch.remove:wss://search.example"]')
      .trigger('click');

    expect(listed(wrapper)).toEqual([]);
    expect(wrapper.text()).toContain('relays.profileSearch.empty');
    expect(mocks.store.setProfileSearchRelays).not.toHaveBeenCalled();
  });

  it('stores the list on Save and clears the unsaved hint', async () => {
    const wrapper = await mountEditor();
    await add(wrapper, 'wss://second.example');

    await save(wrapper);

    expect(mocks.store.setProfileSearchRelays).toHaveBeenCalledTimes(1);
    expect(mocks.store.setProfileSearchRelays).toHaveBeenCalledWith([
      'wss://search.example',
      'wss://second.example',
    ]);
    expect(unsavedHint(wrapper).exists()).toBe(false);
    expect(mocks.notify).toHaveBeenCalledWith({
      type: 'positive',
      message: 'relays.profileSearch.saveSuccess',
    });
  });

  it('shows the default relays the store restores after saving an empty list', async () => {
    const wrapper = await mountEditor();
    await wrapper
      .find('button[aria-label="relays.profileSearch.remove:wss://search.example"]')
      .trigger('click');

    await save(wrapper);

    expect(listed(wrapper)).toEqual(DEFAULTS);
    expect(unsavedHint(wrapper).exists()).toBe(false);
  });

  it('reports a failed save and keeps the edits', async () => {
    mocks.store.setProfileSearchRelays.mockRejectedValue(new Error('storage failed'));
    const wrapper = await mountEditor();
    await add(wrapper, 'wss://second.example');

    await save(wrapper);

    expect(mocks.notify).toHaveBeenCalledWith({
      type: 'negative',
      message: 'relays.profileSearch.saveError',
    });
    expect(listed(wrapper)).toEqual(['wss://search.example', 'wss://second.example']);
    expect(unsavedHint(wrapper).exists()).toBe(true);
  });

  it('fills the relay input from the relay browser', async () => {
    const wrapper = await mountEditor();

    expect(wrapper.find('.mock-relay-browser').exists()).toBe(false);
    await wrapper.find('button[data-icon="explore"]').trigger('click');
    expect(wrapper.find('.mock-relay-browser').exists()).toBe(true);

    wrapper
      .getComponent(RelayBrowserModal)
      .vm.$emit('select', { url: 'wss://picked.example', hostname: 'picked.example' });
    await flushPromises();

    expect((newRelayInput(wrapper).element as HTMLInputElement).value).toBe('wss://picked.example');
    expect(mocks.store.setProfileSearchRelays).not.toHaveBeenCalled();
  });
});
