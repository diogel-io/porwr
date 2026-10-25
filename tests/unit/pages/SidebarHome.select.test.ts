import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

/**
 * Choosing a request from the pending list (S7, porwr#334).
 *
 * The choice has to reach the background, which owns what is current. Setting it only in the panel
 * was overwritten by the next read, and the panel stayed on the request it was already showing.
 * Choosing while a notice is on screen is covered in `SidebarHome.notice.test.ts`.
 */

const mocks = vi.hoisted(() => ({
  present: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

vi.mock('quasar', () => ({ useQuasar: () => ({ notify: vi.fn() }) }));

vi.mock('@/stores/vault-store', () => ({
  default: () => ({ vaultExists: true, isUnlocked: true }),
}));

vi.mock('@/stores/account-store', () => ({
  default: () => ({ activeAccount: undefined, hasNoAccounts: false, getKeys: vi.fn() }),
}));

vi.mock('@/composables/useActiveTab', () => ({
  useActiveTab: () => ({ activeOrigin: ref('') }),
}));

const record = (id: string, state: string) => ({
  id,
  origin: `https://${id}.example`,
  requestType: 'sign_event',
  eventKind: 1,
  accountAlias: 'alice',
  accountPubkey: 'a'.repeat(64),
  state,
  createdAt: 1,
  expiresAt: 2,
});

const queue = vi.hoisted(() => ({ pending: [] as unknown[], current: null as unknown }));

vi.mock('@/composables/useApprovalQueue', async () => {
  const { ref: vueRef } = await import('vue');
  return {
    useApprovalQueue: () => ({
      pending: vueRef(queue.pending),
      current: vueRef(queue.current),
      // The queue has been read; the panel is past its loading view (porwr#371).
      loading: vueRef(false),
      content: vueRef(null),
      decide: vi.fn(),
      dismiss: mocks.dismiss,
      present: mocks.present,
      refresh: vi.fn(),
    }),
  };
});

/** Stands in for the list: one button per id, each emitting `select` as the real list does. */
const PendingRequestListStub = defineComponent({
  props: { requests: { type: Array, required: true }, currentId: { type: String, default: null } },
  emits: ['select'],
  setup(_props, { emit }) {
    return () =>
      h('div', [
        h('button', { class: 'choose-b', onClick: () => emit('select', 'req-b') }),
        h('button', { class: 'choose-gone', onClick: () => emit('select', 'req-gone') }),
      ]);
  },
});

const mountPage = async () => {
  const SidebarHome = (await import('@/pages/sidebar/SidebarHome.vue')).default;
  return mount(SidebarHome, {
    global: {
      stubs: {
        'q-page': { template: '<div><slot /></div>' },
        CurrentRequest: true,
        PendingRequestList: PendingRequestListStub,
        SidebarUnlock: true,
        SidebarSetup: true,
        ProfileView: true,
      },
    },
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dismiss.mockResolvedValue(true);
  queue.pending = [record('req-a', 'presented'), record('req-b', 'queued')];
  queue.current = queue.pending[0];
});

describe('choosing a request from the pending list', () => {
  it('asks the background to present the chosen request', async () => {
    const wrapper = await mountPage();

    await wrapper.find('.choose-b').trigger('click');
    await flushPromises();

    expect(mocks.present).toHaveBeenCalledTimes(1);
    expect(mocks.present).toHaveBeenCalledWith('req-b');
    expect(mocks.dismiss).not.toHaveBeenCalled();
  });

  it('ignores a request that is no longer pending', async () => {
    queue.current = record('req-old', 'expired');
    const wrapper = await mountPage();

    await wrapper.find('.choose-gone').trigger('click');
    await flushPromises();

    expect(mocks.present).not.toHaveBeenCalled();
    expect(mocks.dismiss).not.toHaveBeenCalled();
  });
});
