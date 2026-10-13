import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

/**
 * The Settings toggle for Quick Publish's NIP-89 client tag (#226): it shows the stored choice and
 * changes it through the settings store, which persists it.
 */

const store = vi.hoisted(() => ({
  quickPublishClientTag: true,
  vaultAutoLockMinutes: 15,
  requestExpiryMinutes: 5,
  getSettings: vi.fn(() => Promise.resolve()),
  setQuickPublishClientTag: vi.fn(() => Promise.resolve()),
  setVaultAutoLockMinutes: vi.fn(),
  setRequestExpiryMinutes: vi.fn(),
}));

vi.mock('@/stores/settings-store', () => ({ default: () => store }));
vi.mock('@/composables/useVaultManagement', () => ({
  useVaultManagement: () => ({
    fileInput: null,
    handleExportVault: vi.fn(),
    triggerImport: vi.fn(),
    handleFileImport: vi.fn(),
  }),
}));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('quasar', () => ({ useQuasar: () => ({ notify: vi.fn() }) }));

import ExtensionSettings from '@/pages/dashboard/ExtensionSettings.vue';

const mountPage = async () => {
  const wrapper = mount(ExtensionSettings, {
    global: {
      stubs: {
        ThemeSwitch: true,
        'q-toggle': {
          template:
            '<input type="checkbox" class="q-toggle" :aria-label="ariaLabel" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
          props: ['modelValue', 'ariaLabel'],
          emits: ['update:modelValue'],
        },
      },
      directives: { ripple: {} },
    },
  });
  await flushPromises();
  return wrapper;
};

const clientTagToggle = (wrapper: Awaited<ReturnType<typeof mountPage>>) =>
  wrapper.find('input.q-toggle[aria-label="settings.quickPublishClientTag"]');

describe('ExtensionSettings: Quick Publish client tag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.quickPublishClientTag = true;
  });

  it('shows the toggle on when the setting is on', async () => {
    const wrapper = await mountPage();

    expect(clientTagToggle(wrapper).exists()).toBe(true);
    expect((clientTagToggle(wrapper).element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.text()).toContain('settings.quickPublishClientTagCaption');
  });

  it('shows the toggle off when the setting is off', async () => {
    store.quickPublishClientTag = false;
    const wrapper = await mountPage();

    expect((clientTagToggle(wrapper).element as HTMLInputElement).checked).toBe(false);
  });

  it('turns the tag off through the store, which persists it', async () => {
    const wrapper = await mountPage();

    await clientTagToggle(wrapper).setValue(false);

    expect(store.setQuickPublishClientTag).toHaveBeenCalledWith(false);
  });
});

describe('ExtensionSettings: relays', () => {
  it('no longer shows Profile Search Relays, which moved to the Relays page (#263)', async () => {
    const wrapper = await mountPage();

    expect(wrapper.text()).not.toContain('settings.profileSearchRelays');
    expect(wrapper.text()).not.toContain('relays.profileSearch.title');
    expect(wrapper.text()).toContain('settings.vaultManagement');
  });
});
