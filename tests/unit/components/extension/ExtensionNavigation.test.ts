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

const mountNavigation = async () => {
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push('/dashboard');
  const wrapper = mount(ExtensionNavigation, {
    global: {
      plugins: [router],
      stubs: {
        'q-btn': { template: '<div><slot /></div>' },
        'q-menu': { template: '<div><slot /></div>' },
        'q-list': { template: '<ul><slot /></ul>' },
        'q-item': { template: '<li class="nav-item" @click="$emit(\'click\')"><slot /></li>', emits: ['click'] },
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
    const items = wrapper.findAll('li.nav-item');
    const labels = items.map((item) => item.text());

    for (const item of items) await item.trigger('click');

    const navigationCount = labels.findIndex((label) => label === 'navigation.support.label');
    const opened = created.slice(0, navigationCount);
    expect(opened.length).toBeGreaterThan(5);

    for (const url of opened) {
      const [, hash] = url.split('#');
      const resolved = router.resolve(hash!);
      expect(resolved.matched.length, `${url} matches no route`).toBeGreaterThan(0);
      expect(resolved.matched[0]!.path, `${url} opens the not-found page`).not.toBe('/:catchAll(.*)*');
    }
  });

  it('opens Messaging at /messages and Media Management at /media', async () => {
    const { wrapper } = await mountNavigation();

    await wrapper.findAll('li.nav-item').find((item) => item.text() === 'navigation.messaging.label')!.trigger('click');
    await wrapper.findAll('li.nav-item').find((item) => item.text() === 'navigation.mediaManagement.label')!.trigger('click');

    expect(created).toEqual([
      'chrome-extension://porwr/www/index.html#/messages',
      'chrome-extension://porwr/www/index.html#/media',
    ]);
  });

  it('keeps the profile tab query', async () => {
    const { wrapper } = await mountNavigation();

    await wrapper.findAll('li.nav-item').find((item) => item.text() === 'navigation.profile.label')!.trigger('click');

    expect(created).toEqual(['chrome-extension://porwr/www/index.html#/profile?tab=profile']);
  });
});
