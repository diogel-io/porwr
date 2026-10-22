import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h } from 'vue';

import { useLoadedSettings } from '../mocks/remote-images';
import RemoteImage from '@/components/shared/RemoteImage.vue';
import RemoteImagesNotice from '@/components/shared/RemoteImagesNotice.vue';
import { isRemoteImageUrl, resetRemoteImageReveals } from '@/composables/useRemoteImages';
import useSettingsStore from '@/stores/settings-store';

/**
 * Remote images wait for the user while "Load remote images" is off (T32, diogel-io/workspace#148).
 */

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const PICTURE = 'https://images.example.com/alice.png';
const BANNER = 'https://images.example.com/alice-banner.png';

const stubs = {
  'q-icon': { props: ['name'], template: '<i class="q-icon" :data-name="name" />' },
  'q-banner': {
    template: '<div class="q-banner"><slot name="avatar" /><slot /><slot name="action" /></div>',
  },
  'q-btn': {
    props: ['label'],
    emits: ['click'],
    template: '<button class="q-btn" @click="$emit(\'click\')">{{ label }}</button>',
  },
};

/** One page: the notice above a picture and a banner, as the dashboard layout places it. */
const Page = defineComponent({
  props: { interactive: { type: Boolean, default: true } },
  setup(props) {
    return () =>
      h('div', [
        h(RemoteImagesNotice),
        h(RemoteImage, { src: PICTURE, interactive: props.interactive, class: 'avatar' }),
        h(RemoteImage, { src: BANNER, variant: 'banner' }),
      ]);
  },
});

const mountPage = async (props: { interactive?: boolean } = {}) => {
  const wrapper = mount(Page, { props, global: { stubs } });
  await flushPromises();
  return wrapper;
};

const sources = (wrapper: Awaited<ReturnType<typeof mountPage>>) =>
  wrapper.findAll('img').map((img) => img.attributes('src'));

// An image left mounted would still count as waiting in the next test.
enableAutoUnmount(afterEach);

beforeEach(() => {
  resetRemoteImageReveals();
});

describe('RemoteImage with "Load remote images" on', () => {
  beforeEach(() => useLoadedSettings(true));

  it('loads every image at once, as before', async () => {
    const wrapper = await mountPage();

    expect(sources(wrapper)).toEqual([PICTURE, BANNER]);
    expect(wrapper.find('[data-testid="remote-image-placeholder"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="remote-images-notice"]').exists()).toBe(false);
  });

  it('passes the class to the image', async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('img.avatar').exists()).toBe(true);
  });
});

describe('RemoteImage with "Load remote images" off', () => {
  beforeEach(() => useLoadedSettings(false));

  it('loads nothing, and shows a placeholder in each image box', async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('img').exists()).toBe(false);
    const placeholders = wrapper.findAll('[data-testid="remote-image-placeholder"]');
    expect(placeholders).toHaveLength(2);
    expect(placeholders[0]!.classes()).toContain('avatar');
    expect(placeholders[0]!.find('.q-icon').attributes('data-name')).toBe('person');
    expect(placeholders[1]!.find('.q-icon').attributes('data-name')).toBe('image');
  });

  it('loads one image when the user presses its placeholder, and only that one', async () => {
    const wrapper = await mountPage();

    const placeholder = wrapper.find('button[data-testid="remote-image-placeholder"]');
    expect(placeholder.attributes('aria-label')).toBe('remoteImages.loadOne');
    await placeholder.trigger('click');

    expect(sources(wrapper)).toEqual([PICTURE]);
  });

  it('offers to load the whole page, and loads every image on it', async () => {
    const wrapper = await mountPage();

    const notice = wrapper.find('[data-testid="remote-images-notice"]');
    expect(notice.text()).toContain('remoteImages.hidden');
    await notice.find('button.q-btn').trigger('click');

    expect(sources(wrapper)).toEqual([PICTURE, BANNER]);
    expect(wrapper.find('[data-testid="remote-images-notice"]').exists()).toBe(false);
  });

  it('hides the notice once nothing on the page is waiting', async () => {
    const wrapper = await mountPage();

    for (const placeholder of wrapper.findAll('button[data-testid="remote-image-placeholder"]')) {
      await placeholder.trigger('click');
    }

    expect(wrapper.find('[data-testid="remote-images-notice"]').exists()).toBe(false);
  });

  it('forgets what was loaded when the page changes', async () => {
    const first = await mountPage();
    await first.find('[data-testid="remote-images-load-all"]').trigger('click');
    expect(sources(first)).toHaveLength(2);
    first.unmount();

    resetRemoteImageReveals();
    const next = await mountPage();

    expect(next.find('img').exists()).toBe(false);
  });

  it('shows a placeholder that is not a button inside a control that takes the click', async () => {
    const wrapper = await mountPage({ interactive: false });

    const placeholder = wrapper.find('.avatar[data-testid="remote-image-placeholder"]');
    expect(placeholder.element.tagName).toBe('SPAN');
    expect(placeholder.attributes('aria-hidden')).toBe('true');
    // The page notice still loads it.
    await wrapper.find('[data-testid="remote-images-load-all"]').trigger('click');
    expect(sources(wrapper)).toContain(PICTURE);
  });

  it('never holds back a local data: or blob: image', async () => {
    const local = 'data:image/png;base64,AAAA';
    const wrapper = mount(RemoteImage, { props: { src: local }, global: { stubs } });
    await flushPromises();

    expect(wrapper.find('img').attributes('src')).toBe(local);
    expect(isRemoteImageUrl('blob:chrome-extension://id/uuid')).toBe(false);
    expect(isRemoteImageUrl(PICTURE)).toBe(true);
  });
});

describe('RemoteImage before the settings are read', () => {
  it('loads nothing until it knows the setting, then follows it', async () => {
    setActivePinia(createPinia());
    const store = useSettingsStore();
    let finishRead: () => void = () => undefined;
    const getSettings = vi.spyOn(store, 'getSettings').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRead = () => {
            store.$patch({ settingsLoaded: true, loadRemoteImages: true });
            resolve();
          };
        }),
    );

    const wrapper = mount(Page, { global: { stubs } });
    await flushPromises();

    expect(getSettings).toHaveBeenCalledTimes(1);
    expect(wrapper.find('img').exists()).toBe(false);
    // Not yet a button: pressing it would decide before the setting is known.
    expect(wrapper.find('button[data-testid="remote-image-placeholder"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="remote-images-notice"]').exists()).toBe(false);

    finishRead();
    await flushPromises();

    expect(sources(wrapper)).toEqual([PICTURE, BANNER]);
  });

  it('loads nothing when the settings cannot be read', async () => {
    setActivePinia(createPinia());
    const store = useSettingsStore();
    vi.spyOn(store, 'getSettings').mockRejectedValue(new Error('storage unavailable'));

    const wrapper = mount(Page, { global: { stubs } });
    await flushPromises();

    expect(wrapper.find('img').exists()).toBe(false);
  });
});
