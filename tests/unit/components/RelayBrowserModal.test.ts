import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import RelayBrowserModal from '@/components/dashboard/RelayBrowserModal.vue';
import { listRelayCatalog, refreshRelayCatalog, getRelayDiscoveryStatus } from '@/services/relay-service';
import type { RelayCatalogEntry, RelayDiscoveryState } from '@/types/relay';

const i18nMock = {
  t: (key: string) => key,
};

vi.mock('vue-i18n', () => ({
  useI18n: () => i18nMock,
}));

vi.mock('@/services/relay-service', () => ({
  listRelayCatalog: vi.fn(),
  refreshRelayCatalog: vi.fn(),
  getRelayDiscoveryStatus: vi.fn(),
}));

const stubs = {
  'q-dialog': {
    template: '<div><slot v-if="modelValue" /></div>',
    props: ['modelValue'],
  },
  'q-card': {
    template: '<div><slot /></div>',
  },
  'q-card-section': {
    template: '<div><slot /></div>',
  },
  'q-card-actions': {
    template: '<div><slot /></div>',
  },
  'q-btn': {
    template: '<button @click="$emit(\'click\')" :icon="icon">{{ label }}{{ icon }}<slot /></button>',
    props: ['label', 'icon'],
  },
  'q-spacer': {
    template: '<div />',
  },
  'q-spinner': {
    template: '<div />',
  },
  'q-icon': {
    template: '<div />',
    props: ['name'],
  },
  'q-list': {
    template: '<div><slot /></div>',
  },
  'q-item': {
    template: '<div class="q-item" @click="$emit(\'click\')"><slot /></div>',
    props: ['clickable'],
  },
  'q-item-section': {
    template: '<div><slot /></div>',
    props: ['side'],
  },
  'q-item-label': {
    template: '<div class="q-item-label" :class="{ caption }"><slot /></div>',
    props: ['caption', 'lines'],
  },
  'q-avatar': {
    template: '<div class="q-avatar"><slot /></div>',
    props: ['size', 'color', 'text-color', 'icon'],
  },
  'q-badge': {
    template: '<span>{{ label }}</span>',
    props: ['color', 'label'],
  },
  'q-tooltip': {
    template: '<div><slot /></div>',
  },
  'q-input': {
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    props: ['modelValue', 'label'],
  },
  'q-toggle': {
    template: '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
    props: ['modelValue', 'label'],
  },
  'q-pagination': {
    template: '<div class="q-pagination"><button class="prev" @click="$emit(\'update:modelValue\', modelValue - 1)">prev</button><span class="current">{{ modelValue }}</span><button class="next" @click="$emit(\'update:modelValue\', modelValue + 1)">next</button></div>',
    props: ['modelValue', 'max'],
  },
  'q-select': {
    template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', Number($event.target.value))"><option v-for="opt in options" :key="opt" :value="opt">{{ opt }}</option></select>',
    props: ['modelValue', 'options', 'label'],
  },
};

const directives = {
  'close-popup': vi.fn(),
};

describe('RelayBrowserModal.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly when modelValue is true and shows empty state', async () => {
    vi.mocked(listRelayCatalog).mockResolvedValue([]);

    const wrapper = mount(RelayBrowserModal, {
      props: {
        modelValue: true,
      },
      global: {
        stubs,
        directives,
      },
    });

    await flushPromises();

    expect(wrapper.exists()).toBe(true);
    expect(wrapper.text()).toContain('relays.browser.title');
    expect(wrapper.text()).toContain('relays.browser.empty');
  });

  it('renders cached relay catalog entries in the list', async () => {
    const mockRelays = [
      {
        url: 'wss://relay.example.com',
        hostname: 'relay.example.com',
        status: 'online',
        metadata: {
          name: 'Example Relay',
          description: 'A test relay',
        },
      },
    ];
    vi.mocked(listRelayCatalog).mockResolvedValue(mockRelays as RelayCatalogEntry[]);

    const wrapper = mount(RelayBrowserModal, {
      props: {
        modelValue: false,
      },
      global: {
        stubs,
        directives,
      },
    });

    await wrapper.setProps({ modelValue: true });
    await flushPromises();

    expect(wrapper.text()).toContain('Example Relay');
    expect(wrapper.text()).toContain('wss://relay.example.com');
    expect(wrapper.text()).toContain('A test relay');
    expect(wrapper.text()).toContain('online');
  });

  it('falls back to hostname or URL when display name is missing', async () => {
    const mockRelays = [
      {
        url: 'wss://no-name.com',
        hostname: 'no-name.com',
        status: 'online',
        metadata: {},
      },
      {
        url: 'wss://no-nothing.com',
        status: 'offline',
      },
    ];
    vi.mocked(listRelayCatalog).mockResolvedValue(mockRelays as RelayCatalogEntry[]);

    const wrapper = mount(RelayBrowserModal, {
      props: {
        modelValue: false,
      },
      global: {
        stubs,
        directives,
      },
    });

    await wrapper.setProps({ modelValue: true });
    await flushPromises();

    expect(wrapper.text()).toContain('no-name.com');
    expect(wrapper.text()).toContain('wss://no-nothing.com');
  });

  it('handles missing optional metadata without crashing', async () => {
    const mockRelays = [
      {
        url: 'wss://minimal.com',
        status: 'unknown',
      },
    ];
    vi.mocked(listRelayCatalog).mockResolvedValue(mockRelays as RelayCatalogEntry[]);

    const wrapper = mount(RelayBrowserModal, {
      props: {
        modelValue: false,
      },
      global: {
        stubs,
        directives,
      },
    });

    await wrapper.setProps({ modelValue: true });
    await flushPromises();

    expect(wrapper.text()).toContain('wss://minimal.com');
    expect(wrapper.text()).toContain('unknown');
  });

  it('emits update:modelValue when close button is clicked', async () => {
    vi.mocked(listRelayCatalog).mockResolvedValue([]);

    const wrapper = mount(RelayBrowserModal, {
      props: {
        modelValue: true,
      },
      global: {
        stubs,
        directives,
      },
    });

    await flushPromises();

    // Find the header close button (the one with the 'close' icon)
    const closeBtn = wrapper.find('button[icon="close"]');
    await closeBtn.trigger('click');

    expect(wrapper.emitted('update:modelValue')).toBeTruthy();
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false]);
  });

  it('emits select and closes when a relay is clicked', async () => {
    const mockRelays = [
      {
        url: 'wss://relay.example.com',
        hostname: 'relay.example.com',
        status: 'online',
        metadata: { name: 'Example Relay' },
      },
    ];
    vi.mocked(listRelayCatalog).mockResolvedValue(mockRelays as RelayCatalogEntry[]);

    const wrapper = mount(RelayBrowserModal, {
      props: {
        modelValue: true,
      },
      global: {
        stubs,
        directives,
      },
    });

    await flushPromises();

    const item = wrapper.find('.q-item');
    await item.trigger('click');

    expect(wrapper.emitted('select')).toBeTruthy();
    expect(wrapper.emitted('select')?.[0]).toEqual([mockRelays[0]]);
    expect(wrapper.emitted('update:modelValue')).toBeTruthy();
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false]);
  });
});

describe('RelayBrowserModal.vue filtering and sorting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockRelays = [
    {
      url: 'wss://zebra.relay.com',
      hostname: 'zebra.relay.com',
      status: 'online',
      metadata: { name: 'Zebra Relay' },
    },
    {
      url: 'wss://apple.relay.com',
      hostname: 'apple.relay.com',
      status: 'online',
      metadata: { name: 'Apple Relay', supported_nips: [50] },
    },
  ];

  it('filters relays by search text', async () => {
    vi.mocked(listRelayCatalog).mockResolvedValue(mockRelays as RelayCatalogEntry[]);
    const wrapper = mount(RelayBrowserModal, {
      props: { modelValue: true },
      global: { stubs, directives },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('Zebra Relay');
    expect(wrapper.text()).toContain('Apple Relay');

    const input = wrapper.find('input');
    await input.setValue('apple');
    await flushPromises();

    expect(wrapper.text()).not.toContain('Zebra Relay');
    expect(wrapper.text()).toContain('Apple Relay');
  });

  it('filters relays by search-capable toggle', async () => {
    vi.mocked(listRelayCatalog).mockResolvedValue(mockRelays as RelayCatalogEntry[]);
    const wrapper = mount(RelayBrowserModal, {
      props: { modelValue: true },
      global: { stubs, directives },
    });
    await flushPromises();

    const toggle = wrapper.find('input[type="checkbox"]');
    (toggle.element as HTMLInputElement).checked = true;
    await toggle.trigger('change');
    await flushPromises();

    expect(wrapper.text()).not.toContain('Zebra Relay');
    expect(wrapper.text()).toContain('Apple Relay');
  });

  it('preserves the order provided by the background service', async () => {
    vi.mocked(listRelayCatalog).mockResolvedValue(mockRelays as RelayCatalogEntry[]);
    const wrapper = mount(RelayBrowserModal, {
      props: { modelValue: true },
      global: { stubs, directives },
    });
    await flushPromises();

    const items = wrapper.findAll('.q-item-label').filter(i => !i.classes('caption'));
    // Should be Zebra, then Apple (following mockRelays order)
    expect(items).toHaveLength(4);
    expect(items[0]!.text()).toContain('Zebra Relay');
    expect(items[1]!.text()).toContain('wss://zebra.relay.com');
    expect(items[2]!.text()).toContain('Apple Relay');
    expect(items[3]!.text()).toContain('wss://apple.relay.com');
  });

  it('shows empty state when no results match filter', async () => {
    vi.mocked(listRelayCatalog).mockResolvedValue(mockRelays as RelayCatalogEntry[]);
    const wrapper = mount(RelayBrowserModal, {
      props: { modelValue: true },
      global: { stubs, directives },
    });
    await flushPromises();

    const input = wrapper.find('input');
    await input.setValue('non-existent');
    await flushPromises();

    expect(wrapper.text()).toContain('relays.browser.empty');
    expect(wrapper.text()).not.toContain('Zebra Relay');
    expect(wrapper.text()).not.toContain('Apple Relay');
  });

  it('triggers refresh automatically when catalog is empty', async () => {
    vi.mocked(listRelayCatalog).mockResolvedValue([]);
    vi.mocked(getRelayDiscoveryStatus).mockResolvedValue({ isDiscoveryInProgress: false, lastGlobalDiscoveryAt: Date.now() } as RelayDiscoveryState);

    mount(RelayBrowserModal, {
      props: { modelValue: true },
      global: { stubs, directives },
    });
    await flushPromises();

    expect(refreshRelayCatalog).toHaveBeenCalled();
  });

  it('triggers refresh automatically when discovery state is stale', async () => {
    vi.mocked(listRelayCatalog).mockResolvedValue([{ url: 'wss://relay1.com' }] as RelayCatalogEntry[]);
    const staleTime = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
    vi.mocked(getRelayDiscoveryStatus).mockResolvedValue({
      isDiscoveryInProgress: false,
      lastGlobalDiscoveryAt: staleTime,
    } as RelayDiscoveryState);

    mount(RelayBrowserModal, {
      props: { modelValue: true },
      global: { stubs, directives },
    });
    await flushPromises();

    expect(refreshRelayCatalog).toHaveBeenCalled();
  });

  it('does not trigger refresh when catalog is not empty and state is fresh', async () => {
    vi.mocked(listRelayCatalog).mockResolvedValue([{ url: 'wss://relay1.com' }] as RelayCatalogEntry[]);
    vi.mocked(getRelayDiscoveryStatus).mockResolvedValue({
      isDiscoveryInProgress: false,
      lastGlobalDiscoveryAt: Date.now(),
    } as RelayDiscoveryState);

    mount(RelayBrowserModal, {
      props: { modelValue: true },
      global: { stubs, directives },
    });
    await flushPromises();

    expect(refreshRelayCatalog).not.toHaveBeenCalled();
  });

  it('does not trigger refresh based on low relay count alone', async () => {
    // 5 relays (below the old heuristic of 10)
    const mockRelays = Array.from({ length: 5 }, (_, i) => ({
      url: `wss://relay${i + 1}.com`,
      hostname: `relay${i + 1}.com`,
    }));
    vi.mocked(listRelayCatalog).mockResolvedValue(mockRelays as RelayCatalogEntry[]);
    vi.mocked(getRelayDiscoveryStatus).mockResolvedValue({
      isDiscoveryInProgress: false,
      lastGlobalDiscoveryAt: Date.now(),
    } as RelayDiscoveryState);

    mount(RelayBrowserModal, {
      props: { modelValue: true },
      global: { stubs, directives },
    });
    await flushPromises();

    expect(refreshRelayCatalog).not.toHaveBeenCalled();
  });

  it('triggers refresh manually when refresh button is clicked', async () => {
    vi.mocked(listRelayCatalog).mockResolvedValue([
      { url: '1', hostname: '1' },
      { url: '2', hostname: '2' },
      { url: '3', hostname: '3' },
      { url: '4', hostname: '4' },
      { url: '5', hostname: '5' },
      { url: '6', hostname: '6' },
      { url: '7', hostname: '7' },
      { url: '8', hostname: '8' },
      { url: '9', hostname: '9' },
      { url: '10', hostname: '10' },
      { url: '11', hostname: '11' },
    ] as RelayCatalogEntry[]);
    vi.mocked(getRelayDiscoveryStatus).mockResolvedValue({
      isDiscoveryInProgress: false,
      lastGlobalDiscoveryAt: Date.now(),
    } as RelayDiscoveryState);

    const wrapper = mount(RelayBrowserModal, {
      props: { modelValue: true },
      global: { stubs, directives },
    });
    await flushPromises();

    // Auto-refresh should NOT have been called
    expect(refreshRelayCatalog).not.toHaveBeenCalled();

    const refreshBtn = wrapper.findAll('button').find((b) => b.attributes('icon') === 'refresh');
    await refreshBtn?.trigger('click');

    expect(refreshRelayCatalog).toHaveBeenCalledWith(true);
  });

  it('polls status when discovery is in progress', async () => {
    vi.useFakeTimers();
    vi.mocked(listRelayCatalog).mockResolvedValue([{ url: 'wss://relay1.com' }] as RelayCatalogEntry[]);
    vi.mocked(getRelayDiscoveryStatus).mockResolvedValue({
      isDiscoveryInProgress: true,
      lastGlobalDiscoveryAt: Date.now(),
    } as RelayDiscoveryState);

    mount(RelayBrowserModal, {
      props: { modelValue: true },
      global: { stubs, directives },
    });

    // Run pending promises for onMounted
    await flushPromises();

    // The first call is from onMounted -> checkStatus
    // checkStatus calls startPollingStatus because discovery is in progress.
    // startPollingStatus calls checkStatus once immediately.
    expect(getRelayDiscoveryStatus).toHaveBeenCalledTimes(2);

    // Trigger timers for first poll
    vi.advanceTimersByTime(2000);
    // After timers are advanced, the interval callback is triggered.
    // Since checkStatus is async, we need to wait for its completion.
    await flushPromises();

    expect(getRelayDiscoveryStatus).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it('shows only the first page of results', async () => {
    const mockRelays = Array.from({ length: 15 }, (_, i) => ({
      url: `wss://relay${i + 1}.com`,
      hostname: `relay${i + 1}.com`,
      status: 'online',
      metadata: { name: `Relay ${String(i + 1).padStart(2, '0')}` },
    }));
    vi.mocked(listRelayCatalog).mockResolvedValue(mockRelays as RelayCatalogEntry[]);

    const wrapper = mount(RelayBrowserModal, {
      props: { modelValue: true },
      global: { stubs, directives },
    });
    await flushPromises();

    // Default page size is 10
    const items = wrapper.findAll('.q-item');
    expect(items).toHaveLength(10);
    expect(wrapper.text()).toContain('Relay 01');
    expect(wrapper.text()).toContain('Relay 10');
    expect(wrapper.text()).not.toContain('Relay 11');
  });

  it('switches pages correctly', async () => {
    const mockRelays = Array.from({ length: 15 }, (_, i) => ({
      url: `wss://relay${i + 1}.com`,
      hostname: `relay${i + 1}.com`,
      status: 'online',
      metadata: { name: `Relay ${String(i + 1).padStart(2, '0')}` },
    }));
    vi.mocked(listRelayCatalog).mockResolvedValue(mockRelays as RelayCatalogEntry[]);

    const wrapper = mount(RelayBrowserModal, {
      props: { modelValue: true },
      global: { stubs, directives },
    });
    await flushPromises();

    const nextBtn = wrapper.find('.q-pagination .next');
    await nextBtn.trigger('click');
    await flushPromises();

    const items = wrapper.findAll('.q-item');
    expect(items).toHaveLength(5);
    expect(wrapper.text()).not.toContain('Relay 10');
    expect(wrapper.text()).toContain('Relay 11');
    expect(wrapper.text()).toContain('Relay 15');
  });

  it('changes page size correctly', async () => {
    const mockRelays = Array.from({ length: 25 }, (_, i) => ({
      url: `wss://relay${i + 1}.com`,
      hostname: `relay${i + 1}.com`,
      status: 'online',
      metadata: { name: `Relay ${String(i + 1).padStart(2, '0')}` },
    }));
    vi.mocked(listRelayCatalog).mockResolvedValue(mockRelays as RelayCatalogEntry[]);

    const wrapper = mount(RelayBrowserModal, {
      props: { modelValue: true },
      global: { stubs, directives },
    });
    await flushPromises();

    expect(wrapper.findAll('.q-item')).toHaveLength(10);

    const select = wrapper.find('select');
    await select.setValue(20);
    await flushPromises();

    expect(wrapper.findAll('.q-item')).toHaveLength(20);
    expect(wrapper.text()).toContain('Relay 20');
  });

  it('resets to page 1 when filtering', async () => {
    const mockRelays = Array.from({ length: 25 }, (_, i) => ({
      url: `wss://relay${i + 1}.com`,
      hostname: `relay${i + 1}.com`,
      status: 'online',
      metadata: { name: `Relay ${String(i + 1).padStart(2, '0')}` },
    }));
    vi.mocked(listRelayCatalog).mockResolvedValue(mockRelays as RelayCatalogEntry[]);

    const wrapper = mount(RelayBrowserModal, {
      props: { modelValue: true },
      global: { stubs, directives },
    });
    await flushPromises();

    // Go to page 2
    await wrapper.find('.q-pagination .next').trigger('click');
    expect(wrapper.find('.q-pagination .current').text()).toBe('2');

    // Filter
    const input = wrapper.find('input');
    await input.setValue('Relay 01');
    await flushPromises();

    expect(wrapper.find('.q-pagination .current').text()).toBe('1');
    expect(wrapper.findAll('.q-item')).toHaveLength(1);
  });
});
