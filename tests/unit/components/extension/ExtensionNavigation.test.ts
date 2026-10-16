import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/composables/useVault', () => ({ useVault: () => ({ handleLock: vi.fn() }) }));

import routes from '@/router/routes';
import ExtensionNavigation from '@/components/extension/ExtensionNavigation.vue';

const created: string[] = [];

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal('chrome', {
    runtime: { getURL: (path: string) => `chrome-extension://porwr/${path}` },
    tabs: { create: vi.fn(({ url }: { url: string }) => created.push(url)) },
  });
  vi.stubGlobal('open', vi.fn());
});

const mountNavigation = async (path = '/dashboard') => {
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(path);
  const wrapper = mount(ExtensionNavigation, {
    global: {
      plugins: [router],
      stubs: {
        'q-btn': { template: '<div><slot /></div>' },
        'q-menu': { template: '<div><slot /></div>' },
        'q-list': { template: '<ul><slot /></ul>' },
        'q-item': {
          template:
            '<li class="nav-item" :class="{ active }" @click="$emit(\'click\')"><slot /></li>',
          props: ['active'],
          emits: ['click'],
        },
        'q-item-section': { template: '<span><slot /></span>' },
        'q-icon': true,
        'q-separator': true,
      },
      directives: { ripple: {} },
    },
  });
  await flushPromises();
  return { wrapper, router };
};

describe('ExtensionNavigation', () => {
  it("opens every item on its own route's path, not one guessed from the route name", async () => {
    const { wrapper, router } = await mountNavigation();

    // Every item but Documentation (the web) and Lock (no page) opens a tab inside Porwr.
    for (const item of wrapper.findAll('li.nav-item')) await item.trigger('click');

    expect(created.length).toBeGreaterThan(5);

    for (const url of created) {
      const [, hash] = url.split('#');
      const resolved = router.resolve(hash!);
      expect(resolved.matched.length, `${url} matches no route`).toBeGreaterThan(0);
      expect(resolved.matched[0]!.path, `${url} opens the not-found page`).not.toBe(
        '/:catchAll(.*)*',
      );
    }
  });

  it('opens Messaging at /messages and Media Management at /media', async () => {
    const { wrapper } = await mountNavigation();

    await wrapper
      .findAll('li.nav-item')
      .find((item) => item.text() === 'navigation.messaging.label')!
      .trigger('click');
    await wrapper
      .findAll('li.nav-item')
      .find((item) => item.text() === 'navigation.mediaManagement.label')!
      .trigger('click');

    expect(created).toEqual([
      'chrome-extension://porwr/www/index.html#/messages',
      'chrome-extension://porwr/www/index.html#/media',
    ]);
  });

  it('opens Support inside Porwr at /support, and Documentation on the web (#228)', async () => {
    const { wrapper } = await mountNavigation();

    await wrapper
      .findAll('li.nav-item')
      .find((item) => item.text() === 'navigation.support.label')!
      .trigger('click');
    await wrapper
      .findAll('li.nav-item')
      .find((item) => item.text() === 'navigation.documentation.label')!
      .trigger('click');

    expect(created).toEqual(['chrome-extension://porwr/www/index.html#/support']);
    expect(window.open).toHaveBeenCalledWith(
      'https://diogel.io/docs/porwr',
      '_blank',
      'noopener,noreferrer',
    );
    expect(window.open).toHaveBeenCalledTimes(1);
  });

  it('keeps the profile tab query', async () => {
    const { wrapper } = await mountNavigation();

    await wrapper
      .findAll('li.nav-item')
      .find((item) => item.text() === 'navigation.profile.label')!
      .trigger('click');

    expect(created).toEqual(['chrome-extension://porwr/www/index.html#/profile?tab=profile']);
  });

  it('lists Keys, Settings, Documentation, Support and Lock last, in that order (#294)', async () => {
    const { wrapper } = await mountNavigation();
    const labels = wrapper.findAll('li.nav-item').map((item) => item.text());

    expect(labels.slice(-5)).toEqual([
      'navigation.keys.label',
      'navigation.settings.label',
      'navigation.documentation.label',
      'navigation.support.label',
      'navigation.lock.label',
    ]);
  });

  it('opens Keys at /keys and Settings at /settings (#294)', async () => {
    const { wrapper } = await mountNavigation();

    await wrapper
      .findAll('li.nav-item')
      .find((item) => item.text() === 'navigation.keys.label')!
      .trigger('click');
    await wrapper
      .findAll('li.nav-item')
      .find((item) => item.text() === 'navigation.settings.label')!
      .trigger('click');

    expect(created).toEqual([
      'chrome-extension://porwr/www/index.html#/keys',
      'chrome-extension://porwr/www/index.html#/settings',
    ]);
  });

  it('marks Keys and Settings active on their own pages (#294)', async () => {
    const onKeys = (await mountNavigation('/keys/new')).wrapper.findAll('li.nav-item');
    expect(onKeys.find((item) => item.text() === 'navigation.keys.label')!.classes()).toContain(
      'active',
    );
    expect(
      onKeys.find((item) => item.text() === 'navigation.settings.label')!.classes(),
    ).not.toContain('active');

    const onSettings = (await mountNavigation('/settings')).wrapper.findAll('li.nav-item');
    expect(
      onSettings.find((item) => item.text() === 'navigation.settings.label')!.classes(),
    ).toContain('active');
    expect(
      onSettings.find((item) => item.text() === 'navigation.keys.label')!.classes(),
    ).not.toContain('active');
  });
});
