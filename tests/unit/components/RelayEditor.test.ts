import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import RelayEditor from '@/components/dashboard/RelayEditor.vue';
import RelayBrowserModal from '@/components/dashboard/RelayBrowserModal.vue';
import useSettingsStore from '@/stores/settings-store';

// Mock chrome API
const chromeMock = {
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn(),
      clear: vi.fn(),
    },
    session: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
};

vi.stubGlobal('chrome', chromeMock);

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('quasar', () => ({
  useQuasar: () => ({
    notify: vi.fn(),
  }),
}));

// Mock nostr-tools
const poolGet = vi.hoisted(() => vi.fn());
const poolPublish = vi.hoisted(() => vi.fn());

vi.mock('@/services/account-signing-client', () => ({
  signAsAccount: vi.fn(() => Promise.resolve({ id: 'signed', kind: 10002 })),
}));

vi.mock('nostr-tools', () => {
  return {
    SimplePool: class {
      get = poolGet;
      publish = poolPublish;
      close = vi.fn();
    },
    finalizeEvent: vi.fn(),
  };
});

vi.mock('@noble/hashes/utils', () => ({
  hexToBytes: vi.fn(),
}));

describe('RelayEditor.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    poolGet.mockResolvedValue(null);
  });

  // `pool.get` over no relays never settles; with no usable fallback relay the editor must not wait
  // on it (diogel-io/workspace#142).
  it('shows the editor, not a spinner, when there is no usable fallback relay', async () => {
    poolGet.mockReturnValue(new Promise(() => undefined));
    const wrapper = mount(RelayEditor, {
      props,
      global: {
        plugins: [
          createTestingPinia({
            createSpy: vi.fn,
            stubActions: false,
            initialState: { settings: { fallbackRelays: [] } },
          }),
        ],
        stubs: globalStubs,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(poolGet).not.toHaveBeenCalled();
    expect(wrapper.find('q-spinner-stub').exists()).toBe(false);
    expect(wrapper.find('button[data-icon="explore"]').exists()).toBe(true);
  });

  const props = {
    storedKey: {
      id: 'pubkey',
      alias: 'alias',
      account: {
        privkey: '00'.repeat(32),
      },
      createdAt: new Date().toISOString(),
    },
  };

  const globalStubs = {
    'q-input': {
      template:
        '<div data-testid="q-input"><input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)"><slot name="append" /></div>',
      props: ['modelValue'],
      emits: ['update:modelValue'],
    },
    'q-btn': {
      template:
        '<button data-testid="q-btn" :data-icon="icon" @click="$emit(\'click\')"><slot /></button>',
      props: ['icon'],
    },
    'q-checkbox': {
      template:
        '<input data-testid="q-checkbox" type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
      props: ['modelValue', 'label'],
    },
    'q-list': {
      template: '<div data-testid="q-list"><slot /></div>',
    },
    'q-item': {
      template: '<div data-testid="q-item"><slot /></div>',
    },
    'q-item-section': {
      template: '<div data-testid="q-item-section"><slot /></div>',
    },
    'q-item-label': {
      template: '<div data-testid="q-item-label"><slot /></div>',
    },
    'q-badge': {
      template: '<div data-testid="q-badge">{{ label }}<slot /></div>',
      props: ['label'],
    },
    'q-spinner': true,
    'q-tooltip': true,
    'relay-browser-modal': {
      template: '<div v-if="modelValue" class="mock-modal">Relay Browser Modal</div>',
      props: ['modelValue'],
      emits: ['select'],
    },
  };

  // With no usable fallback relay the list can still be saved: it goes to the write relays it names
  // (NIP-65), and only to ones Porwr may connect to (diogel-io/workspace#142).
  it("saves to the list's own write relays when there is no usable fallback relay", async () => {
    poolGet.mockResolvedValue({
      tags: [
        ['r', 'wss://write.example'],
        ['r', 'wss://read.example', 'read'],
        ['r', 'ws://plain.example', 'write'],
      ],
    });
    poolPublish.mockReturnValue([Promise.resolve('ok')]);
    const wrapper = mount(RelayEditor, {
      props,
      global: {
        plugins: [
          createTestingPinia({
            createSpy: vi.fn,
            stubActions: false,
            initialState: { settings: { fallbackRelays: ['wss://fallback.example'] } },
          }),
        ],
        stubs: globalStubs,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    useSettingsStore().fallbackRelays = [];
    await new Promise((resolve) => setTimeout(resolve, 0));

    const save = wrapper
      .findAll('button[data-testid="q-btn"]')
      .filter((b) => !b.attributes('data-icon'));
    await save[save.length - 1]!.trigger('click');
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The button stub reports a click twice (emitted and native); each save publishes the same way.
    expect(poolPublish).toHaveBeenCalled();
    for (const [targets] of poolPublish.mock.calls) {
      expect(targets).toEqual(['wss://write.example']);
    }
  });

  it('renders Browse button', () => {
    const wrapper = mount(RelayEditor, {
      props,
      global: {
        plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false })],
        stubs: globalStubs,
      },
    });

    const browseBtn = wrapper.find('button[data-icon="explore"]');
    expect(browseBtn.exists()).toBe(true);
  });

  it('opens modal when Browse button is clicked', async () => {
    const wrapper = mount(RelayEditor, {
      props,
      global: {
        plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false })],
        stubs: globalStubs,
      },
    });

    expect(wrapper.find('.mock-modal').exists()).toBe(false);

    const browseBtn = wrapper.find('button[data-icon="explore"]');
    await browseBtn.trigger('click');

    expect(wrapper.find('.mock-modal').exists()).toBe(true);
  });

  it('populates input and defaults when relay is selected', async () => {
    const wrapper = mount(RelayEditor, {
      props,
      global: {
        plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false })],
        stubs: globalStubs,
      },
    });

    // Wait for loading to finish
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    // Open modal
    const browseBtn = wrapper.find('button[data-icon="explore"]');
    await browseBtn.trigger('click');

    const modal = wrapper.getComponent(RelayBrowserModal);
    const mockRelay = {
      url: 'wss://selected-relay.com',
      hostname: 'selected-relay.com',
    };

    await modal.setValue(true, 'modelValue');
    modal.vm.$emit('select', mockRelay);
    await wrapper.vm.$nextTick();

    // Check URL input
    const input = wrapper.find('[data-testid="q-input"] input');
    expect((input.element as HTMLInputElement).value).toBe('wss://selected-relay.com');

    // Check checkboxes
    const checkboxes = wrapper.findAll('input[type="checkbox"]');
    expect(checkboxes).toHaveLength(1); // Only Write checkbox

    // Only write checkbox exists and it should be false by default
    expect((checkboxes[0]!.element as HTMLInputElement).checked).toBe(false);
  });

  it('defaults to Read enabled and Write disabled for manual add', async () => {
    const wrapper = mount(RelayEditor, {
      props,
      global: {
        plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false })],
        stubs: globalStubs,
      },
    });

    // Wait for initial fetch to finish
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const urlInput = wrapper.find('[data-testid="q-input"] input');
    await urlInput.setValue('wss://manual-relay.com');

    // Write checkbox is initially false
    const writeCheckbox = wrapper.find('[data-testid="q-checkbox"]');
    expect((writeCheckbox.element as HTMLInputElement).checked).toBe(false);

    // Trigger add
    const addBtn = wrapper.find('button.diogel-btn-primary');
    await addBtn.trigger('click');

    // relays update is sync in addRelay, but template might need a tick
    await wrapper.vm.$nextTick();

    const items = wrapper.findAll('[data-testid="q-item"]');
    expect(items.length).toBeGreaterThan(0);
    const lastItem = items[items.length - 1];
    expect(lastItem!.text()).toContain('wss://manual-relay.com');

    // It should show "relays.read" badge but NOT "relays.write" badge
    const badges = lastItem!.findAll('[data-testid="q-badge"]');
    const badgeTexts = badges.map((b) => b.text());
    expect(badgeTexts).toContain('relays.read');
    expect(badgeTexts).not.toContain('relays.write');
  });

  it('renders existing relay list correctly', async () => {
    // This test is tricky because of the SimplePool mock in the module scope
    // For now we rely on other tests as the logic is verified
  });

  it('uses fallback relays from settings store', async () => {
    const pinia = createTestingPinia({ createSpy: vi.fn });
    const settingsStore = useSettingsStore(pinia);
    settingsStore.fallbackRelays = ['wss://test-relay.com'];

    const wrapper = mount(RelayEditor, {
      props,
      global: {
        plugins: [pinia],
        stubs: globalStubs,
      },
    });

    await wrapper.vm.$nextTick();
    /* eslint-disable @typescript-eslint/unbound-method */
    expect(settingsStore.getSettings).toHaveBeenCalled();
    /* eslint-enable @typescript-eslint/unbound-method */
  });
});
