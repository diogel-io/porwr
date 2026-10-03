import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

import type { ApprovalRequestRecord } from 'app/src-bex/types/background';

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

import CurrentRequest from 'components/sidebar/CurrentRequest.vue';

const request = (over: Partial<ApprovalRequestRecord> = {}): ApprovalRequestRecord =>
  ({
    id: 'req-1',
    origin: 'https://example.com',
    requestType: 'sign_event',
    eventKind: 1,
    accountAlias: 'alice',
    accountPubkey: 'a'.repeat(64),
    state: 'presented',
    createdAt: 1,
    expiresAt: 2,
    ...over,
  }) as ApprovalRequestRecord;

const mountRequest = (record: ApprovalRequestRecord) =>
  mount(CurrentRequest, {
    props: { request: record, content: { allowRemember: true }, busy: false },
    global: {
      stubs: {
        RequestOriginHeader: {
          template: '<div class="request-origin-header">{{ activeAccountAlias }}</div>',
          props: ['origin', 'accountAlias', 'activeAccountAlias'],
        },
        'q-btn': {
          template:
            '<button v-bind="$attrs" :disabled="disable" @click="$emit(\'click\')">{{ label }}</button>',
          props: ['label', 'disable'],
        },
        RequestRiskWarning: true,
        RequestPreview: { template: '<div class="request-preview" />' },
        RequestDecisionBar: { template: '<div class="request-decision-bar" />' },
      },
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * A terminal request must not look actionable (FR-12, S13, S14).
 *
 * The background refuses a decision on a terminal id, so approving one cannot succeed — but a panel
 * that still shows the controls invites the attempt and reads as though the request were live.
 */
describe('a request that can no longer be decided', () => {
  for (const state of ['expired', 'interrupted'] as const) {
    describe(`when ${state}`, () => {
      it('offers no approval controls', () => {
        const wrapper = mountRequest(request({ state }));

        expect(wrapper.find('.request-decision-bar').exists()).toBe(false);
      });

      it('does not show the event content, which is no longer reviewable', () => {
        const wrapper = mountRequest(request({ state }));

        expect(wrapper.find('.request-preview').exists()).toBe(false);
      });

      it('says why, in a live region so it is announced', () => {
        const wrapper = mountRequest(request({ state }));

        const notice = wrapper.find('[role="status"]');
        expect(notice.exists()).toBe(true);
        expect(notice.text()).toBe(`request.states.${state}`);
      });
    });
  }

  it('still shows the controls for a live request', () => {
    const wrapper = mountRequest(request({ state: 'presented' }));

    expect(wrapper.find('.request-decision-bar').exists()).toBe(true);
    expect(wrapper.find('.request-preview').exists()).toBe(true);
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });

  it('still shows the controls for a queued request', () => {
    const wrapper = mountRequest(request({ state: 'queued' }));

    expect(wrapper.find('.request-decision-bar').exists()).toBe(true);
  });
});

/**
 * The site is connected as one account and another is active (#116, workspace#23).
 */
describe('a request from a site connected as another account', () => {
  const BOB = 'b'.repeat(64);
  const mismatched = (over: Partial<ApprovalRequestRecord> = {}) =>
    request({ activeAccountAlias: 'bob', activeAccountPubkey: BOB, ...over });

  it('tells the header which account is active, so it can say so', () => {
    const wrapper = mountRequest(mismatched());

    expect(wrapper.find('.request-origin-header').text()).toBe('bob');
  });

  it('offers to reject and use the active account, and emits only that', async () => {
    const wrapper = mountRequest(mismatched());

    const button = wrapper.find('[data-testid="reject-and-switch"]');
    expect(button.text()).toBe('request.account.rejectAndSwitch:bob');
    await button.trigger('click');

    expect(wrapper.emitted('rejectAndSwitch')?.[0]?.[0]).toMatchObject({ id: 'req-1' });
    // Switching is never an approval: no decision is emitted from here at all.
    expect(wrapper.emitted('decide')).toBeUndefined();
  });

  it('says nothing when the site is connected as the active account', () => {
    const wrapper = mountRequest(
      request({ activeAccountAlias: 'alice', activeAccountPubkey: 'a'.repeat(64) }),
    );

    expect(wrapper.find('.request-origin-header').text()).toBe('');
    expect(wrapper.find('[data-testid="reject-and-switch"]').exists()).toBe(false);
  });

  it('says nothing for a request that acts for no account', () => {
    const wrapper = mountRequest(mismatched({ accountAlias: null, accountPubkey: null }));

    expect(wrapper.find('[data-testid="reject-and-switch"]').exists()).toBe(false);
  });

  it('offers no switch on a request that can no longer be decided', () => {
    const wrapper = mountRequest(mismatched({ state: 'expired' }));

    expect(wrapper.find('[data-testid="reject-and-switch"]').exists()).toBe(false);
  });
});
