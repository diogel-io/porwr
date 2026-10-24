import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const store = vi.hoisted(() => ({
  blossomServer: 'https://blossom.example.com/',
  getSettings: vi.fn(),
  setBlossomServer: vi.fn(),
}));

vi.mock('@/stores/settings-store', async () => {
  const { reactive } = await import('vue');
  const reactiveStore = reactive(store);
  return { default: () => reactiveStore };
});

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import MediaManagementPage from '@/pages/dashboard/MediaManagementPage.vue';
import useSettingsStore from '@/stores/settings-store';

const mountPage = async () => {
  const wrapper = mount(MediaManagementPage, {
    global: {
      stubs: {
        'q-page': { template: '<div><slot /></div>' },
        'q-card': { template: '<div class="q-card"><slot /></div>' },
        'q-card-section': { template: '<section><slot /></section>' },
        'q-list': { template: '<div><slot /></div>' },
        'q-item': { template: '<div><slot /></div>' },
        'q-item-section': { template: '<div><slot /></div>' },
        'q-item-label': { template: '<span><slot /></span>' },
        'q-input': {
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          props: ['modelValue'],
          emits: ['update:modelValue'],
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
};

beforeEach(() => {
  vi.clearAllMocks();
  store.blossomServer = 'https://blossom.example.com/';
});

describe('MediaManagementPage', () => {
  it('loads settings when it mounts', async () => {
    await mountPage();

    expect(store.getSettings).toHaveBeenCalledTimes(1);
  });

  it('shows the stored Blossom server URL', async () => {
    const wrapper = await mountPage();

    expect((wrapper.find('input').element as HTMLInputElement).value).toBe(
      'https://blossom.example.com/',
    );
  });

  it('saves an edited URL through the settings store', async () => {
    const wrapper = await mountPage();

    await wrapper.find('input').setValue('https://media.example.org/');

    expect(store.setBlossomServer).toHaveBeenCalledWith('https://media.example.org/');
  });

  it('does not save an http:// URL, and shows why (diogel-io/workspace#142, T21)', async () => {
    const wrapper = await mountPage();

    await wrapper.find('input').setValue('http://media.example.org/');

    expect(store.setBlossomServer).not.toHaveBeenCalled();
  });

  it('follows a server changed elsewhere after it mounted (diogel-io/workspace#142)', async () => {
    const wrapper = await mountPage();

    useSettingsStore().blossomServer = 'https://other-tab.example/';
    await flushPromises();

    expect((wrapper.find('input').element as HTMLInputElement).value).toBe(
      'https://other-tab.example/',
    );
  });

  it('does not rewrite what is being typed when its own save comes back normalised', async () => {
    store.setBlossomServer.mockImplementation((url: string) => {
      useSettingsStore().blossomServer = new URL(url).toString();
      return Promise.resolve();
    });
    const wrapper = await mountPage();

    await wrapper.find('input').setValue('https://media.example.org');
    await flushPromises();

    expect((wrapper.find('input').element as HTMLInputElement).value).toBe(
      'https://media.example.org',
    );
  });
});
