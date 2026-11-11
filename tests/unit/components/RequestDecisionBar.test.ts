import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import RequestDecisionBar from '@/components/sidebar/RequestDecisionBar.vue';

const mountBar = (props: { noApprove?: boolean } = {}) =>
  mount(RequestDecisionBar, {
    props: { riskClass: 'standard', allowRemember: true, busy: false, ...props },
    global: {
      stubs: {
        'q-btn': {
          template: '<button :data-label="label" @click="$emit(\'click\')">{{ label }}</button>',
          props: ['label', 'disable'],
        },
        'q-select': { template: '<div class="duration" />' },
      },
    },
  });

/** Approve is carried out as the account a request names, so one naming none has no Approve. */
describe('the decision bar for a request with no account (diogel-io/workspace#227)', () => {
  it('shows only Reject, and no duration', () => {
    const wrapper = mountBar({ noApprove: true });

    expect(wrapper.find('[data-label="request.approve"]').exists()).toBe(false);
    expect(wrapper.find('[data-label="request.reject"]').exists()).toBe(true);
    expect(wrapper.find('.duration').exists()).toBe(false);
  });

  it('still rejects', async () => {
    const wrapper = mountBar({ noApprove: true });

    await wrapper.find('[data-label="request.reject"]').trigger('click');

    const decisions = wrapper.emitted('decide') ?? [];
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.every(([approved]) => approved === false)).toBe(true);
  });

  it('shows Approve otherwise', () => {
    const wrapper = mountBar();

    expect(wrapper.find('[data-label="request.approve"]').exists()).toBe(true);
    expect(wrapper.find('.duration').exists()).toBe(true);
  });
});
