import { describe, expect, it, vi } from 'vitest';
import { mount, RouterLinkStub } from '@vue/test-utils';

import DashboardBreadcrumbs from '@/components/dashboard/DashboardBreadcrumbs.vue';

/** The trail back from a dashboard sub-page (#302). */

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const mountCrumbs = (items: InstanceType<typeof DashboardBreadcrumbs>['$props']['items']) =>
  mount(DashboardBreadcrumbs, {
    props: { items },
    global: { stubs: { RouterLink: RouterLinkStub } },
  });

describe('DashboardBreadcrumbs.vue', () => {
  it('is a labelled navigation landmark', () => {
    const nav = mountCrumbs([{ label: 'Keys' }]).get('nav');

    expect(nav.attributes('aria-label')).toBe('navigation.breadcrumb');
  });

  it('links every item before the current one', () => {
    const wrapper = mountCrumbs([{ label: 'Keys', to: { name: 'keys' } }, { label: 'alice' }]);

    const links = wrapper.findAllComponents(RouterLinkStub);
    expect(links).toHaveLength(1);
    expect(links[0]!.props('to')).toEqual({ name: 'keys' });
    expect(links[0]!.text()).toBe('Keys');
  });

  it('marks the last item as the current page and never links it', () => {
    const wrapper = mountCrumbs([
      { label: 'Keys', to: { name: 'keys' } },
      // A `to` on the last item is ignored: a link to the page you are on goes nowhere.
      { label: 'alice', to: { name: 'view-key', params: { alias: 'alice' } } },
    ]);

    const current = wrapper.get('[aria-current="page"]');
    expect(current.text()).toBe('alice');
    expect(wrapper.findAllComponents(RouterLinkStub)).toHaveLength(1);
  });

  it('hides the separators from assistive technology', () => {
    const wrapper = mountCrumbs([{ label: 'Keys', to: { name: 'keys' } }, { label: 'alice' }]);

    const separators = wrapper.findAll('.dashboard-breadcrumbs__separator');
    expect(separators).toHaveLength(1);
    expect(separators[0]!.attributes('aria-hidden')).toBe('true');
  });
});
