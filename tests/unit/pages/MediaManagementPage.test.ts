import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const store = vi.hoisted(() => ({
  blossomServer: 'https://blossom.example.com/',
  getSettings: vi.fn(),
  setBlossomServer: vi.fn(),
}));

vi.mock('@/stores/settings-store', () => ({
  default: () => store,
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import MediaManagementPage from '@/pages/dashboard/MediaManagementPage.vue';

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
});
