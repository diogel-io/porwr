import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

import RequestOriginHeader from '@/components/sidebar/RequestOriginHeader.vue';

const mountHeader = (props: Record<string, unknown>) =>
  mount(RequestOriginHeader, {
    props: { origin: 'https://example.com', accountAlias: 'alice', ...props },
    global: { stubs: { 'q-icon': true } },
  });

describe('the account named on a request (workspace#23)', () => {
  it('names the account the site is connected as', () => {
    const wrapper = mountHeader({});

    expect(wrapper.text()).toContain('alice');
    expect(wrapper.find('[data-testid="request-not-active"]').exists()).toBe(false);
  });

  it('says when that is not the active account', () => {
    const wrapper = mountHeader({ activeAccountAlias: 'bob' });

    const notice = wrapper.find('[data-testid="request-not-active"]');
    expect(notice.attributes('role')).toBe('alert');
    expect(notice.text()).toBe('request.account.notActive:bob,alice');
  });

  it('compares nothing for a request that acts for no account', () => {
    const wrapper = mountHeader({ accountAlias: null, activeAccountAlias: 'bob' });

    expect(wrapper.find('[data-testid="request-not-active"]').exists()).toBe(false);
  });
});

describe('a look-alike origin (#144, threat model T1)', () => {
  it('shows a punycode origin exactly as given, never decoded back to Unicode', () => {
    const wrapper = mountHeader({ origin: 'https://xn--pple-43d.com' });

    const value = wrapper.find('.request-origin__value');
    expect(value.text()).toBe('https://xn--pple-43d.com');
    expect(wrapper.text()).not.toContain('\u0430pple');
  });
});
