import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import type { RouteRecordRaw } from 'vue-router';

import routes from '@/router/routes';
import SidebarFooterLinks from '@/components/sidebar/SidebarFooterLinks.vue';

/**
 * Guards the sidebar surface boundary.
 *
 * The panel and the management surfaces share one router and one bundle, so nothing structural
 * stops a dashboard page being rendered inside a 360px panel. The approved surface map says
 * management stays full-tab and the panel links out to it; this is what holds that line.
 */

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const SIDEBAR_PATH = '/sidebar';

const findRoute = (path: string): RouteRecordRaw => {
  const route = routes.find((candidate) => candidate.path === path);
  if (!route) throw new Error(`No route registered for ${path}`);
  return route;
};

/**
 * Resolves a lazy route component to the name it declares, falling back to the one the SFC
 * compiler derives from its filename.
 *
 * The declared name is checked first, and the order matters. `__name` is the filename, so while
 * the layouts sit at `layouts/{surface}/Layout.vue` it reads `Layout` for every one of them and
 * this guard cannot tell a dashboard layout from a sidebar one. `defineOptions({ name })` is what
 * makes them distinguishable, so an explicit name has to win over a derived one.
 *
 * Undefined rather than throwing for a component that carries neither: not every SFC in the
 * router declares a name, and an unnamed one is by definition not the layout this file looks for.
 */
const resolveComponentName = async (component: unknown): Promise<string | undefined> => {
  if (typeof component !== 'function') return undefined;
  const loaded = (await component()) as { default: Record<string, unknown> };
  const name = loaded.default.name ?? loaded.default.__name;
  return typeof name === 'string' ? name : undefined;
};

describe('sidebar surface boundary', () => {
  it('renders the sidebar under its own layout, not the dashboard layout', async () => {
    await expect(resolveComponentName(findRoute(SIDEBAR_PATH).component)).resolves.toBe(
      'SidebarLayout',
    );
  });

  it('nests nothing but the panel itself under the sidebar route', async () => {
    const children = findRoute(SIDEBAR_PATH).children ?? [];

    expect(children).toHaveLength(1);
    await expect(resolveComponentName(children[0]?.component)).resolves.toBe('SidebarHome');
  });

  it('registers no approval fallback surface', async () => {
    // The approved contract has no fallback for a closed panel in 0.1.0: the toolbar badge asks for
    // attention and the user opens the panel themselves (D4, specification §9). `/approve` and its
    // popup page were retained only until that was settled, and were removed once it was (#113).
    const paths = routes.map((route) => route.path);

    expect(paths).not.toContain('/approve');
    for (const route of routes) {
      const layout = await resolveComponentName(route.component);
      expect(layout).not.toBe('PopupLayout');
    }
  });

  it('keeps every dashboard-layout route outside the sidebar branch', async () => {
    const managementPaths: string[] = [];

    for (const route of routes) {
      if (route.path === SIDEBAR_PATH || typeof route.component !== 'function') continue;

      // Mounting DashboardLayout is what makes a route a management surface.
      if ((await resolveComponentName(route.component)) === 'DashboardLayout') {
        managementPaths.push(route.path);
      }
    }

    // A guard that found nothing would pass silently forever.
    expect(managementPaths.length).toBeGreaterThan(0);
    for (const path of managementPaths) {
      expect(path.startsWith(SIDEBAR_PATH)).toBe(false);
    }
  });
});

describe('sidebar footer links', () => {
  const createTab = vi.fn();
  const getURL = vi.fn((path: string) => `chrome-extension://id/${path}`);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('chrome', { runtime: { getURL }, tabs: { create: createTab } });
  });

  it('opens every management surface in a full tab rather than routing the panel', async () => {
    const push = vi.fn();
    const wrapper = mount(SidebarFooterLinks, {
      global: {
        mocks: { $router: { push } },
        stubs: {
          // No explicit emit: the parent's @click falls through to the native button, which is
          // how the real q-btn behaves. Emitting as well would double every click.
          'q-btn': {
            template: '<button>{{ label }}</button>',
            props: ['label', 'icon'],
          },
        },
      },
    });

    const buttons = wrapper.findAll('button');
    expect(buttons.length).toBeGreaterThan(0);

    for (const button of buttons) {
      await button.trigger('click');
    }

    expect(createTab).toHaveBeenCalledTimes(buttons.length);
    expect(push).not.toHaveBeenCalled();

    // Every destination is an extension URL, never a page the panel navigates to in place.
    const calls = createTab.mock.calls as Array<[{ url: string }]>;
    for (const [{ url }] of calls) {
      expect(url).toMatch(/^chrome-extension:\/\/id\/www\/index\.html#\//);
    }
  });
});
