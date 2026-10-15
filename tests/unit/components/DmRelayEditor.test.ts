import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const mocks = vi.hoisted(() => ({
  getDmRelays: vi.fn(),
  publishDmRelays: vi.fn(),
  checkDmRelays: vi.fn(),
  notify: vi.fn(),
  dialog: vi.fn(),
  /** What the user does with the "some relays drop messages" dialog. */
  dialogAnswer: 'ok' as 'ok' | 'cancel',
}));

vi.mock('@/services/messaging-service', () => ({
  getDmRelays: mocks.getDmRelays,
  publishDmRelays: mocks.publishDmRelays,
  checkDmRelays: mocks.checkDmRelays,
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

vi.mock('quasar', () => ({
  useQuasar: () => ({ notify: mocks.notify, dialog: mocks.dialog }),
}));

import DmRelayEditor from '@/components/dashboard/DmRelayEditor.vue';
import RelayBrowserModal from '@/components/dashboard/RelayBrowserModal.vue';

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
        'q-tooltip': true,
        'q-chip': { template: '<em class="q-chip"><slot /></em>' },
        'q-input': {
          template:
            '<div><input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keyup.enter="$emit(\'keyup\', $event)" /><slot name="append" /></div>',
          props: ['modelValue'],
          emits: ['update:modelValue', 'keyup'],
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

const relayItems = (wrapper: Awaited<ReturnType<typeof mountEditor>>) =>
  wrapper.findAll('li.dm-relay').map((item) => item.find('span').text());

const statuses = (wrapper: Awaited<ReturnType<typeof mountEditor>>) =>
  wrapper.findAll('li.dm-relay').map((item) => (item.find('.q-chip').exists() ? item.find('.q-chip').text() : null));

const save = async (wrapper: Awaited<ReturnType<typeof mountEditor>>) => {
  await wrapper.find('button[aria-label="relays.save"]').trigger('click');
  await flushPromises();
};

/** Has the check answer `status` for every relay, or the status listed for it in `byUrl`. */
const checkAnswers = (byUrl: Record<string, string>, status = 'keeps') =>
  mocks.checkDmRelays.mockImplementation((relays: string[]) =>
    Promise.resolve({ checks: relays.map((url) => ({ url, status: byUrl[url] ?? status })) }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDmRelays.mockResolvedValue({ relays: ['wss://inbox.example'], updatedAt: 10 });
  mocks.publishDmRelays.mockImplementation((relays: string[]) =>
    Promise.resolve({ relays, accepted: ['wss://a', 'wss://b'], rejected: [] }),
  );
  checkAnswers({});
  mocks.dialogAnswer = 'ok';
  mocks.dialog.mockImplementation(() => {
    const chain = {
      onOk: (fn: () => void) => {
        if (mocks.dialogAnswer === 'ok') fn();
        return chain;
      },
      onCancel: (fn: () => void) => {
        if (mocks.dialogAnswer === 'cancel') fn();
        return chain;
      },
    };
    return chain;
  });
});

describe('DmRelayEditor', () => {
  it('says which relays keep private messages (#278)', async () => {
    const wrapper = await mountEditor();

    expect(wrapper.find('[data-testid="dm-relays-keeps-messages"]').text()).toBe('relays.dmRelays.keepsMessages');
  });

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

  it('fills the relay input from the relay browser', async () => {
    const wrapper = await mountEditor();

    expect(wrapper.find('.mock-relay-browser').exists()).toBe(false);
    await wrapper.find('button[data-icon="explore"]').trigger('click');
    expect(wrapper.find('.mock-relay-browser').exists()).toBe(true);

    wrapper
      .getComponent(RelayBrowserModal)
      .vm.$emit('select', { url: 'wss://picked.example', hostname: 'picked.example' });
    await flushPromises();

    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('wss://picked.example');
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

    await wrapper.find('button[aria-label="relays.save"]').trigger('click');
    await flushPromises();

    expect(mocks.publishDmRelays).toHaveBeenCalledWith(['wss://inbox.example']);
    expect(mocks.notify).toHaveBeenCalledWith({ type: 'positive', message: 'relays.dmRelays.saveSuccess:2' });
  });

  it('reports a failed publish', async () => {
    mocks.publishDmRelays.mockRejectedValue(new Error('No relay accepted the direct message relay list'));
    const wrapper = await mountEditor();

    await wrapper.find('button[aria-label="relays.save"]').trigger('click');
    await flushPromises();

    expect(mocks.notify).toHaveBeenCalledWith({ type: 'negative', message: 'relays.dmRelays.saveError' });
  });

  it('logs why a publish failed', async () => {
    const error = new Error('Direct background timeout for messaging.dmRelays.publish');
    mocks.publishDmRelays.mockRejectedValue(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapper = await mountEditor();

    await wrapper.find('button[aria-label="relays.save"]').trigger('click');
    await flushPromises();

    expect(consoleError).toHaveBeenCalledWith('Error publishing direct message relays:', error);
    consoleError.mockRestore();
  });

  describe('checking the relays before publishing (#277)', () => {
    beforeEach(() => {
      mocks.getDmRelays.mockResolvedValue({ relays: ['wss://keeps.example', 'wss://damus.example'], updatedAt: 10 });
    });

    it('checks the list, then shows what each relay does with messages', async () => {
      checkAnswers({ 'wss://damus.example': 'unchecked' });
      const wrapper = await mountEditor();
      expect(statuses(wrapper)).toEqual([null, null]);

      await save(wrapper);

      expect(mocks.checkDmRelays).toHaveBeenCalledWith(['wss://keeps.example', 'wss://damus.example']);
      expect(statuses(wrapper)).toEqual(['relays.dmRelays.status.keeps', 'relays.dmRelays.status.unchecked']);
      expect(mocks.publishDmRelays).toHaveBeenCalledWith(['wss://keeps.example', 'wss://damus.example']);
      expect(mocks.dialog).not.toHaveBeenCalled();
    });

    it("says it is checking while the check runs", async () => {
      let answer: (value: unknown) => void = () => undefined;
      mocks.checkDmRelays.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      const wrapper = await mountEditor();

      await wrapper.find('button[aria-label="relays.save"]').trigger('click');
      expect(wrapper.find('[data-testid="dm-relays-checking"]').text()).toBe('relays.dmRelays.checking');

      answer({ checks: [] });
      await flushPromises();
      expect(wrapper.find('[data-testid="dm-relays-checking"]').exists()).toBe(false);
    });

    it('refuses to publish a list where every relay drops messages, naming them', async () => {
      checkAnswers({}, 'drops');
      const wrapper = await mountEditor();

      await save(wrapper);

      expect(mocks.publishDmRelays).not.toHaveBeenCalled();
      expect(wrapper.find('[data-testid="dm-relays-all-drop"]').text()).toBe(
        'relays.dmRelays.allDrop:wss://keeps.example, wss://damus.example',
      );
      expect(statuses(wrapper)).toEqual(['relays.dmRelays.status.drops', 'relays.dmRelays.status.drops']);
    });

    it('stops blocking once the list changes', async () => {
      checkAnswers({}, 'drops');
      const wrapper = await mountEditor();
      await save(wrapper);

      await wrapper.find('button[aria-label="relays.dmRelays.remove:wss://damus.example"]').trigger('click');

      expect(wrapper.find('[data-testid="dm-relays-all-drop"]').exists()).toBe(false);
    });

    it('asks before publishing a list where some relays drop messages, naming them', async () => {
      checkAnswers({ 'wss://damus.example': 'drops' });
      const wrapper = await mountEditor();

      await save(wrapper);

      expect(mocks.dialog).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'relays.dmRelays.someDropTitle',
          message: 'relays.dmRelays.someDropBody:wss://damus.example',
        }),
      );
      expect(mocks.publishDmRelays).toHaveBeenCalledWith(['wss://keeps.example', 'wss://damus.example']);
    });

    it('publishes nothing when the user cancels', async () => {
      checkAnswers({ 'wss://damus.example': 'drops' });
      mocks.dialogAnswer = 'cancel';
      const wrapper = await mountEditor();

      await save(wrapper);

      expect(mocks.publishDmRelays).not.toHaveBeenCalled();
      expect(statuses(wrapper)).toEqual(['relays.dmRelays.status.keeps', 'relays.dmRelays.status.drops']);
    });

    it("publishes anyway when the check itself fails, showing every relay as couldn't check", async () => {
      const error = new Error('Bridge timeout');
      mocks.checkDmRelays.mockRejectedValue(error);
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const wrapper = await mountEditor();

      await save(wrapper);

      expect(consoleError).toHaveBeenCalledWith('Error checking direct message relays:', error);
      expect(mocks.notify).toHaveBeenCalledWith({ type: 'warning', message: 'relays.dmRelays.checkFailed' });
      expect(statuses(wrapper)).toEqual(['relays.dmRelays.status.unchecked', 'relays.dmRelays.status.unchecked']);
      expect(mocks.publishDmRelays).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('publishes an empty list without checking anything', async () => {
      mocks.getDmRelays.mockResolvedValue({ relays: [], updatedAt: 10 });
      const wrapper = await mountEditor();

      await save(wrapper);

      expect(mocks.checkDmRelays).not.toHaveBeenCalled();
      expect(mocks.publishDmRelays).toHaveBeenCalledWith([]);
    });
  });
});
