import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

import SidebarFooterLinks from '@/components/sidebar/SidebarFooterLinks.vue';

const createTab = vi.fn();

const mountFooter = () =>
  mount(SidebarFooterLinks, {
    global: {
      stubs: {
        // Mirrors the real q-btn closely enough for the assertions: the accessible name comes
        // from `aria-label`, and the tooltip renders inside the button.
        'q-btn': {
          template: '<button :aria-label="ariaLabel" :title="title"><slot /></button>',
          props: ['label', 'icon', 'ariaLabel', 'title'],
        },
        'q-tooltip': { template: '<span class="tooltip"><slot /></span>' },
      },
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('chrome', {
    runtime: { getURL: (path: string) => `chrome-extension://id/${path}` },
    tabs: { create: createTab },
  });
});

/**
 * The footer offers exactly three destinations (#182).
 *
 * It carried a fourth, Event History, which the panel does not need: the panel is where signing is
 * decided, and reviewing what was signed belongs to the dashboard the first link reaches. The
 * approved specification named a different three again, and was amended to match this.
 */
describe('the sidebar footer', () => {
  it('offers exactly three links', () => {
    const wrapper = mountFooter();

    expect(wrapper.findAll('button')).toHaveLength(3);
  });

  /**
   * Asserted on the accessible name, not on rendered text.
   *
   * The footer shows icons only (#184), so there is no visible label to assert against — and the
   * name is what a screen-reader user actually receives. If this ever fails because the label was
   * dropped, the fix is to restore the label, never to assert on something weaker.
   */
  it('names Dashboard, Keys and Settings, and nothing else', () => {
    const wrapper = mountFooter();

    expect(wrapper.findAll('button').map((button) => button.attributes('aria-label'))).toEqual([
      'sidebar.links.dashboard',
      'sidebar.links.keys',
      'sidebar.links.settings',
    ]);
  });

  it('carries no visible text, which is the point of the change', () => {
    const wrapper = mountFooter();

    // The tooltip is rendered inside the button, so its text is excluded deliberately: what must
    // be absent is a permanently visible label beside the icon.
    for (const button of wrapper.findAll('button')) {
      expect(button.element.childElementCount).toBeLessThanOrEqual(1);
    }
  });

  it('names each button for assistive technology whether or not anything is hovered', () => {
    const wrapper = mountFooter();

    // NFR-1: no interaction may depend on a pointer affordance, and a tooltip is one.
    for (const button of wrapper.findAll('button')) {
      expect(button.attributes('aria-label')).toBeTruthy();
      expect(button.attributes('title')).toBe(button.attributes('aria-label'));
    }
  });

  it('offers a tooltip for sighted users beside that name', () => {
    const wrapper = mountFooter();

    expect(wrapper.findAll('.tooltip').map((tip) => tip.text())).toEqual([
      'sidebar.links.dashboard',
      'sidebar.links.keys',
      'sidebar.links.settings',
    ]);
  });

  it('opens each in a full tab rather than routing the panel', async () => {
    const wrapper = mountFooter();

    for (const button of wrapper.findAll('button')) {
      await button.trigger('click');
    }

    // Management stays full-tab; a panel that navigated to one would be a 360px dashboard.
    expect(createTab).toHaveBeenCalledTimes(3);
    for (const [{ url }] of createTab.mock.calls as Array<[{ url: string }]>) {
      expect(url).toMatch(/^chrome-extension:\/\/id\/www\/index\.html#\//);
    }
  });
});
