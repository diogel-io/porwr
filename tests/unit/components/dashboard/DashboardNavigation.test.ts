import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/composables/useVault', () => ({ useVault: () => ({ handleLock: vi.fn() }) }));

import routes from '@/router/routes';
import DashboardNavigation from '@/components/dashboard/DashboardNavigation.vue';

beforeEach(() => {
  vi.stubGlobal('open', vi.fn());
});

const mountNavigation = async (path = '/dashboard') => {
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(path);
  const wrapper = mount(DashboardNavigation, {
    global: {
      plugins: [router],
      stubs: {
        'q-list': { template: '<ul><slot /></ul>' },
        'q-item': {
          template:
            '<li class="nav-item" :class="{ active }" @click="$emit(\'click\')"><slot /></li>',
          props: ['active'],
          emits: ['click'],
        },
        'q-item-section': { template: '<span><slot /></span>' },
        'q-item-label': { template: '<span><slot /></span>' },
        'q-icon': true,
        'q-separator': true,
        DiogelLogo: true,
      },
      directives: { ripple: {} },
    },
  });
  await flushPromises();
  return { wrapper, router };
};

const item = (wrapper: Awaited<ReturnType<typeof mountNavigation>>['wrapper'], label: string) =>
  wrapper.findAll('li.nav-item').find((entry) => entry.text() === label)!;

describe('DashboardNavigation support (#228)', () => {
  it('opens the Support page inside Porwr rather than an external site', async () => {
    const { wrapper, router } = await mountNavigation();
    const push = vi.spyOn(router, 'push').mockResolvedValue(undefined);

    await item(wrapper, 'navigation.support.label').trigger('click');

    expect(push).toHaveBeenCalledWith({ name: 'support' });
    expect(router.resolve({ name: 'support' }).fullPath).toBe('/support');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('marks Support active on the Support page', async () => {
    const { wrapper } = await mountNavigation('/support');

    expect(item(wrapper, 'navigation.support.label').classes()).toContain('active');
    expect(item(wrapper, 'navigation.messaging.label').classes()).not.toContain('active');
  });

  it('still opens Documentation on the web', async () => {
    const { wrapper } = await mountNavigation();

    await item(wrapper, 'navigation.documentation.label').trigger('click');

    expect(window.open).toHaveBeenCalledWith('https://diogel.io/docs/porwr', '_blank', 'noopener,noreferrer');
  });
});
