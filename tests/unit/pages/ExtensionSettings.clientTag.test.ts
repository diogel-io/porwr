import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

/**
 * The Settings toggle for Quick Publish's NIP-89 client tag (#226): it shows the stored choice and
 * changes it through the settings store, which persists it.
 */

const store = vi.hoisted(() => ({
  quickPublishClientTag: true,
  loadRemoteImages: true,
  vaultAutoLockMinutes: 15,
  requestExpiryMinutes: 5,
  getSettings: vi.fn(() => Promise.resolve()),
  setQuickPublishClientTag: vi.fn(() => Promise.resolve()),
  setLoadRemoteImages: vi.fn(() => Promise.resolve()),
  setVaultAutoLockMinutes: vi.fn(),
  setRequestExpiryMinutes: vi.fn(),
}));

vi.mock('@/stores/settings-store', () => ({ default: () => store }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
const notify = vi.hoisted(() => vi.fn());
vi.mock('quasar', () => ({ useQuasar: () => ({ notify }) }));

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

describe('ExtensionSettings: load remote images (diogel-io/workspace#148)', () => {
  const remoteImagesToggle = (wrapper: Awaited<ReturnType<typeof mountPage>>) =>
    wrapper.find('input.q-toggle[aria-label="settings.loadRemoteImages"]');

  beforeEach(() => {
    vi.clearAllMocks();
    store.loadRemoteImages = true;
  });

  it('shows the toggle on by default, with what an image host learns', async () => {
    const wrapper = await mountPage();

    expect((remoteImagesToggle(wrapper).element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.text()).toContain('settings.loadRemoteImagesCaption');
  });

  it('shows the toggle off when the setting is off', async () => {
    store.loadRemoteImages = false;
    const wrapper = await mountPage();

    expect((remoteImagesToggle(wrapper).element as HTMLInputElement).checked).toBe(false);
  });

  it('turns remote images off through the store, which persists it', async () => {
    const wrapper = await mountPage();

    await remoteImagesToggle(wrapper).setValue(false);

    expect(store.setLoadRemoteImages).toHaveBeenCalledWith(false);
  });

  it('says so when the choice cannot be saved', async () => {
    store.setLoadRemoteImages.mockRejectedValueOnce(new Error('quota exceeded'));
    const wrapper = await mountPage();

    await remoteImagesToggle(wrapper).setValue(false);
    await flushPromises();

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'negative',
        message: 'settings.loadRemoteImagesSaveFailed',
      }),
    );
  });
});

describe('ExtensionSettings: relays', () => {
  it('no longer shows Profile Search Relays, which moved to the Relays page (#263)', async () => {
    const wrapper = await mountPage();

    expect(wrapper.text()).not.toContain('settings.profileSearchRelays');
    expect(wrapper.text()).not.toContain('relays.profileSearch.title');
    expect(wrapper.text()).toContain('settings.autoLockVault');
  });
});

describe('ExtensionSettings: vault backup', () => {
  it('no longer shows vault export or import, which moved to the Keys page (#297)', async () => {
    const wrapper = await mountPage();

    expect(wrapper.text()).not.toContain('settings.exportVault');
    expect(wrapper.text()).not.toContain('settings.importVault');
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
  });
});
