import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const mocks = vi.hoisted(() => ({
  getDmRelays: vi.fn(),
  publishDmRelays: vi.fn(),
  notify: vi.fn(),
}));

vi.mock('@/services/messaging-service', () => ({
  getDmRelays: mocks.getDmRelays,
  publishDmRelays: mocks.publishDmRelays,
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

vi.mock('quasar', () => ({
  useQuasar: () => ({ notify: mocks.notify }),
}));

import DmRelayEditor from '@/components/dashboard/DmRelayEditor.vue';

const storedKey = { id: 'a'.repeat(64), alias: 'alice', createdAt: '', account: { privkey: '' } };

const mountEditor = async () => {
  const wrapper = mount(DmRelayEditor, {
    props: { storedKey },
    global: {
      stubs: {
        'q-spinner': true,
        'q-banner': { template: '<div class="q-banner"><slot /></div>' },
        'q-list': { template: '<ul><slot /></ul>' },
        'q-item': { template: '<li class="dm-relay"><slot /></li>' },
        'q-item-section': { template: '<div><slot /></div>' },
        'q-item-label': { template: '<span><slot /></span>' },
        'q-input': {
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keyup.enter="$emit(\'keyup\', $event)" />',
          props: ['modelValue'],
          emits: ['update:modelValue', 'keyup'],
        },
        'q-btn': {
          template: '<button :aria-label="ariaLabel || label" @click="$emit(\'click\')">{{ label }}</button>',
          props: ['label', 'ariaLabel', 'loading'],
          emits: ['click'],
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
};

const relayItems = (wrapper: Awaited<ReturnType<typeof mountEditor>>) =>
  wrapper.findAll('li.dm-relay').map((item) => item.text());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDmRelays.mockResolvedValue({ relays: ['wss://inbox.example'], updatedAt: 10 });
  mocks.publishDmRelays.mockImplementation((relays: string[]) =>
    Promise.resolve({ relays, accepted: ['wss://a', 'wss://b'], rejected: [] }),
  );
});

describe('DmRelayEditor', () => {
  it('shows the published direct message relays', async () => {
    const wrapper = await mountEditor();

    expect(mocks.getDmRelays).toHaveBeenCalledTimes(1);
    expect(relayItems(wrapper)).toEqual(['wss://inbox.example']);
    expect(wrapper.find('.q-banner').exists()).toBe(false);
  });

  it('says so when the account has never published a list', async () => {
    mocks.getDmRelays.mockResolvedValue({ relays: [], updatedAt: null });
    const wrapper = await mountEditor();

    expect(wrapper.find('.q-banner').text()).toBe('relays.dmRelays.notPublished');
    expect(wrapper.text()).toContain('relays.dmRelays.empty');
  });

  it('adds a relay at the end, keeping the order the user chose', async () => {
    const wrapper = await mountEditor();

    await wrapper.find('input').setValue('wss://second.example');
    await wrapper.find('button[aria-label="relays.dmRelays.add"]').trigger('click');

    expect(relayItems(wrapper)).toEqual(['wss://inbox.example', 'wss://second.example']);
  });

  it('rejects a URL that is not a relay', async () => {
    const wrapper = await mountEditor();

    await wrapper.find('input').setValue('https://web.example');
    await wrapper.find('button[aria-label="relays.dmRelays.add"]').trigger('click');

    expect(relayItems(wrapper)).toEqual(['wss://inbox.example']);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
  });

  it('removes a relay', async () => {
    const wrapper = await mountEditor();

    await wrapper.find('button[aria-label="relays.dmRelays.remove:wss://inbox.example"]').trigger('click');

    expect(relayItems(wrapper)).toEqual([]);
  });

  it('suggests a smaller list once there are more than three relays', async () => {
    mocks.getDmRelays.mockResolvedValue({
      relays: ['wss://a.example', 'wss://b.example', 'wss://c.example', 'wss://d.example'],
      updatedAt: 10,
    });
    const wrapper = await mountEditor();

    expect(wrapper.find('[data-testid="dm-relays-guidance"]').text()).toBe('relays.dmRelays.tooMany');
  });

  it('publishes the list through the background and reports how many relays took it', async () => {
    const wrapper = await mountEditor();

    await wrapper.find('button[aria-label="relays.dmRelays.save"]').trigger('click');
    await flushPromises();

    expect(mocks.publishDmRelays).toHaveBeenCalledWith(['wss://inbox.example']);
    expect(mocks.notify).toHaveBeenCalledWith({ type: 'positive', message: 'relays.dmRelays.saveSuccess:2' });
  });

  it('reports a failed publish', async () => {
    mocks.publishDmRelays.mockRejectedValue(new Error('No relay accepted the direct message relay list'));
    const wrapper = await mountEditor();

    await wrapper.find('button[aria-label="relays.dmRelays.save"]').trigger('click');
    await flushPromises();

    expect(mocks.notify).toHaveBeenCalledWith({ type: 'negative', message: 'relays.dmRelays.saveError' });
  });
});
