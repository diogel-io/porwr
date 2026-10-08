import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

/**
 * "Reject and use <active>" on the approval prompt (diogel-io/workspace#23).
 *
 * It must reject the request before the site is moved, and never approve it: the prompt named the
 * account the request would act as, and nothing may be signed with any other.
 */

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  switchSiteToActiveAccount: vi.fn(),
  notify: vi.fn(),
  order: [] as string[],
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

vi.mock('quasar', () => ({ useQuasar: () => ({ notify: mocks.notify }) }));

vi.mock('@/stores/vault-store', () => ({
  default: () => ({ vaultExists: true, isUnlocked: true }),
}));

vi.mock('@/stores/account-store', () => ({
  default: () => ({ activeAccount: undefined, hasNoAccounts: false, getKeys: vi.fn() }),
}));

vi.mock('@/composables/useActiveTab', () => ({
  useActiveTab: () => ({ activeOrigin: ref('') }),
}));

const REQUEST = {
  id: 'req-1',
  origin: 'https://example.com',
  requestType: 'sign_event',
  eventKind: 1,
  accountAlias: 'alice',
  accountPubkey: 'a'.repeat(64),
  activeAccountAlias: 'bob',
  activeAccountPubkey: 'b'.repeat(64),
  state: 'presented',
  createdAt: 1,
  expiresAt: 2,
};

vi.mock('@/composables/useApprovalQueue', () => ({
  useApprovalQueue: () => ({
    pending: ref([REQUEST]),
    current: ref(REQUEST),
    content: ref(null),
    decide: mocks.decide,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/services/connected-sites-service', () => ({
  switchSiteToActiveAccount: mocks.switchSiteToActiveAccount,
}));

/** Stands in for the prompt: one button that asks to reject and switch. */
const CurrentRequestStub = defineComponent({
  props: { request: { type: Object, required: true } },
  emits: ['rejectAndSwitch', 'decide'],
  setup(props, { emit }) {
    return () =>
      h('button', {
        class: 'reject-and-switch',
        onClick: () => emit('rejectAndSwitch', props.request),
      });
  },
});

const mountPage = async () => {
  const SidebarHome = (await import('@/pages/sidebar/SidebarHome.vue')).default;
  return mount(SidebarHome, {
    global: {
      stubs: {
        'q-page': { template: '<div><slot /></div>' },
        CurrentRequest: CurrentRequestStub,
        PendingRequestList: true,
        SidebarUnlock: true,
        SidebarSetup: true,
        ProfileView: true,
      },
    },
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order = [];
  mocks.decide.mockImplementation(async () => {
    mocks.order.push('decide');
  });
  mocks.switchSiteToActiveAccount.mockImplementation(async () => {
    mocks.order.push('switch');
    return { success: true, site: { boundAlias: 'bob' } };
  });
});

describe('reject and use the active account', () => {
  it('rejects the request, then connects the site as the active account', async () => {
    const wrapper = await mountPage();

    await wrapper.find('.reject-and-switch').trigger('click');
    await flushPromises();

    expect(mocks.decide).toHaveBeenCalledTimes(1);
    expect(mocks.decide).toHaveBeenCalledWith('req-1', false, 'once');
    expect(mocks.switchSiteToActiveAccount).toHaveBeenCalledWith('https://example.com');
    expect(mocks.order).toEqual(['decide', 'switch']);
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'positive',
        message: 'request.account.switched:https://example.com,bob',
      }),
    );
  });

  it('never approves the request', async () => {
    const wrapper = await mountPage();

    await wrapper.find('.reject-and-switch').trigger('click');
    await flushPromises();

    for (const call of mocks.decide.mock.calls) {
      expect(call[1]).toBe(false);
    }
  });

  it('says so when the switch is refused; the request stays rejected', async () => {
    mocks.switchSiteToActiveAccount.mockResolvedValue({ success: false, error: 'Vault is locked' });
    const wrapper = await mountPage();

    await wrapper.find('.reject-and-switch').trigger('click');
    await flushPromises();

    expect(mocks.decide).toHaveBeenCalledWith('req-1', false, 'once');
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
  });
});
