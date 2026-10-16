import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import type { QuickSignAccountRelays } from '@/types';

const { listRelaysMock, settingsStoreMock } = vi.hoisted(() => ({
  listRelaysMock: vi.fn(),
  settingsStoreMock: { fallbackRelays: ['wss://seed.example'], quickPublishClientTag: true },
}));

vi.mock('@/services/quick-sign-service', () => ({
  buildQuickSignPreviewEvent: vi.fn(),
  getQuickSignAvailability: vi.fn(),
  listQuickSignAccountRelayUrls: listRelaysMock,
  listQuickSignAccounts: vi.fn(async () => [
    { label: 'alpha (npub-a)', value: 'alpha', npub: 'npub-a' },
    { label: 'beta (npub-b)', value: 'beta', npub: 'npub-b' },
  ]),
  quickSignEvent: vi.fn(),
}));

vi.mock('@/services/dexie-storage', () => ({
  get: vi.fn(async () => ({})),
  getActive: vi.fn(async () => 'alpha'),
}));

vi.mock('@/stores/settings-store', async () => {
  const { reactive } = await import('vue');
  const store = reactive(settingsStoreMock);
  return { default: () => store };
});

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

import useSettingsStore from '@/stores/settings-store';
import QuickSignCard from '@/components/dashboard/QuickSignCard.vue';

// Cards share the settings store, so a card left mounted would react to the next test's relays.
enableAutoUnmount(afterEach);

const QSelectStub = defineComponent({
  name: 'QSelectStub',
  props: ['modelValue', 'label'],
  emits: ['update:modelValue'],
  template: '<div class="q-select-stub" />',
});

const slot = (tag = 'div') => ({ template: `<${tag}><slot /></${tag}>` });

const mountCard = async () => {
  const wrapper = mount(QuickSignCard, {
    global: {
      stubs: {
        'q-card': slot(),
        'q-card-section': slot('section'),
        'q-card-actions': slot(),
        'q-banner': slot(),
        'q-select': QSelectStub,
        'q-input': true,
        'q-icon': true,
        'q-dialog': true,
        'q-separator': true,
        'q-expansion-item': true,
        'q-btn': {
          template: '<button @click="$emit(\'click\')">{{ label }}</button>',
          props: ['label'],
          emits: ['click'],
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
};

const ready = (relayUrls: string[]): QuickSignAccountRelays => ({ state: 'ready', relayUrls });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('the Quick Publish card relays (#285)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore().fallbackRelays = ['wss://seed.example'];
    listRelaysMock.mockResolvedValue(ready(['wss://write.example']));
  });

  it('looks the relays up once when it mounts', async () => {
    const wrapper = await mountCard();

    expect(listRelaysMock).toHaveBeenCalledOnce();
    expect(listRelaysMock).toHaveBeenCalledWith('alpha');
    expect(wrapper.text()).toContain('dashboard.widgets.quickSign.publishDestinationSummary:1');
  });

  it('looks the relays up once when the account changes', async () => {
    const wrapper = await mountCard();
    listRelaysMock.mockClear();

    wrapper.findAllComponents(QSelectStub)[0]!.vm.$emit('update:modelValue', 'beta');
    await flushPromises();

    expect(listRelaysMock).toHaveBeenCalledOnce();
    expect(listRelaysMock).toHaveBeenCalledWith('beta');
  });

  it('ignores a lookup that finishes after a newer one', async () => {
    const slowAlpha = deferred<QuickSignAccountRelays>();
    listRelaysMock
      .mockReturnValueOnce(slowAlpha.promise)
      .mockResolvedValueOnce(ready(['wss://beta.example']));
    const wrapper = await mountCard();

    wrapper.findAllComponents(QSelectStub)[0]!.vm.$emit('update:modelValue', 'beta');
    await flushPromises();
    slowAlpha.resolve(ready(['wss://alpha-1.example', 'wss://alpha-2.example']));
    await flushPromises();

    expect(wrapper.text()).toContain('dashboard.widgets.quickSign.publishDestinationSummary:1');
  });

  it('shows loading rather than the no-relay warning while a lookup runs', async () => {
    listRelaysMock.mockReturnValueOnce(new Promise(() => {}));
    const wrapper = await mountCard();

    expect(wrapper.find('[data-testid="quick-sign-relays-loading"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="quick-sign-no-relay-meta"]').exists()).toBe(false);
  });

  it('says it could not reach the relays, not that there is no relay list', async () => {
    listRelaysMock.mockResolvedValueOnce({ state: 'unreachable' });
    const wrapper = await mountCard();

    expect(wrapper.find('[data-testid="quick-sign-relays-unreachable"]').text()).toContain(
      'dashboard.widgets.quickSign.relaysUnreachable',
    );
    expect(wrapper.find('[data-testid="quick-sign-no-relay-meta"]').exists()).toBe(false);
  });

  it('loads the relays when Retry succeeds', async () => {
    listRelaysMock.mockResolvedValueOnce({ state: 'unreachable' });
    const wrapper = await mountCard();

    await wrapper.find('[data-testid="quick-sign-relays-unreachable"] button').trigger('click');
    await flushPromises();

    expect(listRelaysMock).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-testid="quick-sign-relays-unreachable"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('dashboard.widgets.quickSign.publishDestinationSummary:1');
  });

  it('still warns when the account has no relay list', async () => {
    listRelaysMock.mockResolvedValueOnce(ready([]));
    const wrapper = await mountCard();

    expect(wrapper.find('[data-testid="quick-sign-no-relay-meta"]').exists()).toBe(true);
  });

  it('looks the relays up again when the fallback relays change', async () => {
    listRelaysMock.mockResolvedValueOnce({ state: 'unreachable' });
    const wrapper = await mountCard();

    useSettingsStore().fallbackRelays = ['wss://working.example'];
    await flushPromises();

    expect(listRelaysMock).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('dashboard.widgets.quickSign.publishDestinationSummary:1');
  });
});
