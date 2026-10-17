import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

/**
 * The expired and interrupted notice on the panel (S13, S14, diogel-io/workspace#97).
 *
 * The notice is the request the user was reading, kept on screen to say why it went. It can only
 * be dismissed: it is never offered for rejection, and moving on to another request dismisses it.
 */

const NOTICE = {
  id: 'req-1',
  origin: 'https://example.com',
  requestType: 'sign_event',
  eventKind: 1,
  accountAlias: 'alice',
  accountPubkey: 'a'.repeat(64),
  activeAccountAlias: null,
  activeAccountPubkey: null,
  state: 'expired',
  createdAt: 1,
  expiresAt: 2,
};

const NEXT = { ...NOTICE, id: 'req-2', state: 'queued', createdAt: 3, expiresAt: 4 };

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  dismiss: vi.fn(),
  refresh: vi.fn(),
  order: [] as string[],
  vault: { vaultExists: true, isUnlocked: true },
}));

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

vi.mock('quasar', () => ({ useQuasar: () => ({ notify: vi.fn() }) }));

vi.mock('@/stores/vault-store', () => ({ default: () => mocks.vault }));

vi.mock('@/stores/account-store', () => ({
  default: () => ({ activeAccount: undefined, hasNoAccounts: false, getKeys: vi.fn() }),
}));

vi.mock('@/composables/useActiveTab', () => ({
  useActiveTab: () => ({ activeOrigin: ref('') }),
}));

vi.mock('@/composables/useApprovalQueue', () => ({
  useApprovalQueue: () => ({
    pending: ref([NEXT]),
    current: ref(NOTICE),
    content: ref(null),
    decide: mocks.decide,
    dismiss: mocks.dismiss,
    refresh: mocks.refresh,
  }),
}));

vi.mock('@/services/connected-sites-service', () => ({ switchSiteToActiveAccount: vi.fn() }));

/** Stands in for the notice: one button that dismisses it. */
const CurrentRequestStub = defineComponent({
  props: { request: { type: Object, required: true } },
  emits: ['dismiss', 'decide', 'rejectAndSwitch'],
  setup(props, { emit }) {
    return () =>
      h('button', { class: 'dismiss', onClick: () => emit('dismiss', props.request.id) });
  },
});

/** Stands in for the pending list: one button that chooses the next request. */
const PendingRequestListStub = defineComponent({
  emits: ['select'],
  setup(_props, { emit }) {
    return () => h('button', { class: 'select-next', onClick: () => emit('select', NEXT.id) });
  },
});

const SidebarUnlockStub = defineComponent({
  props: { waitingRequest: { type: Object, default: null } },
  setup(props) {
    return () => h('div', { class: 'unlock' }, props.waitingRequest ? 'waiting' : 'nothing');
  },
});

const mountPage = async () => {
  const SidebarHome = (await import('@/pages/sidebar/SidebarHome.vue')).default;
  return mount(SidebarHome, {
    global: {
      stubs: {
        'q-page': { template: '<div><slot /></div>' },
        CurrentRequest: CurrentRequestStub,
        PendingRequestList: PendingRequestListStub,
        SidebarUnlock: SidebarUnlockStub,
        SidebarSetup: true,
        ProfileView: true,
      },
    },
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order = [];
  mocks.vault.vaultExists = true;
  mocks.vault.isUnlocked = true;
  mocks.dismiss.mockImplementation(async () => {
    mocks.order.push('dismiss');
    return true;
  });
  mocks.refresh.mockImplementation(async () => {
    mocks.order.push('refresh');
  });
});

describe('the expired or interrupted notice', () => {
  it('is dismissed from the request screen, and never decided', async () => {
    const wrapper = await mountPage();

    await wrapper.find('.dismiss').trigger('click');
    await flushPromises();

    expect(mocks.dismiss).toHaveBeenCalledWith('req-1');
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it('is dismissed first when another request is chosen, so the choice takes', async () => {
    const wrapper = await mountPage();

    await wrapper.find('.select-next').trigger('click');
    await flushPromises();

    expect(mocks.dismiss).toHaveBeenCalledWith('req-1');
    expect(mocks.order).toEqual(['dismiss', 'refresh']);
  });

  it('is never handed to the unlock view, whose Reject it cannot take', async () => {
    mocks.vault.isUnlocked = false;
    const wrapper = await mountPage();

    expect(wrapper.find('.unlock').text()).toBe('nothing');
  });
});
