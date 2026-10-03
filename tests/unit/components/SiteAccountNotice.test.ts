import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const mocks = vi.hoisted(() => ({
  getSiteAccount: vi.fn(),
  switchSiteToActiveAccount: vi.fn(),
  notify: vi.fn(),
  dialog: vi.fn(),
}));

vi.mock('src/services/connected-sites-service', () => ({
  getSiteAccount: mocks.getSiteAccount,
  switchSiteToActiveAccount: mocks.switchSiteToActiveAccount,
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

vi.mock('quasar', () => ({
  useQuasar: () => ({ notify: mocks.notify, dialog: mocks.dialog }),
}));

import SiteAccountNotice from 'components/sidebar/SiteAccountNotice.vue';

const ORIGIN = 'https://example.com';
const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

const bound = (over: Record<string, unknown> = {}) => ({
  origin: ORIGIN,
  boundPubkey: ALICE,
  boundAlias: 'alice',
  activePubkey: ALICE,
  activeAlias: 'alice',
  mismatch: false,
  ...over,
});

const mismatched = () => bound({ activePubkey: BOB, activeAlias: 'bob', mismatch: true });

const mountNotice = async (activePubkey: string | null = ALICE) => {
  const wrapper = mount(SiteAccountNotice, {
    props: { origin: ORIGIN, activePubkey },
    global: {
      stubs: {
        'q-icon': true,
        'q-btn': {
          template: '<button v-bind="$attrs" @click="$emit(\'click\')">{{ label }}</button>',
          props: ['label', 'loading'],
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSiteAccount.mockResolvedValue(null);
  mocks.dialog.mockReturnValue({ onOk: (fn: () => void) => fn() });
  mocks.switchSiteToActiveAccount.mockResolvedValue({
    success: true,
    site: bound({ boundPubkey: BOB, boundAlias: 'bob', activePubkey: BOB, activeAlias: 'bob' }),
  });
});

describe('the account the active tab’s site is connected as', () => {
  it('shows nothing for a site that is not connected', async () => {
    const wrapper = await mountNotice();

    expect(mocks.getSiteAccount).toHaveBeenCalledWith(ORIGIN);
    expect(wrapper.find('[data-testid="site-account"]').exists()).toBe(false);
  });

  it('says which account the site is connected as', async () => {
    mocks.getSiteAccount.mockResolvedValue(bound());

    const wrapper = await mountNotice();

    expect(wrapper.find('[data-testid="site-account-bound"]').text()).toBe(
      'sidebar.activeSite.connectedAs:alice',
    );
  });

  it('warns only when the active account is another', async () => {
    mocks.getSiteAccount.mockResolvedValue(bound());
    const same = await mountNotice();
    expect(same.find('[data-testid="site-account-mismatch"]').exists()).toBe(false);
    expect(same.find('[data-testid="site-account-use-active"]').exists()).toBe(false);

    mocks.getSiteAccount.mockResolvedValue(mismatched());
    const other = await mountNotice(BOB);
    expect(other.find('[data-testid="site-account-mismatch"]').text()).toBe(
      `sidebar.activeSite.mismatch:${ORIGIN},alice,bob`,
    );
    expect(other.find('[data-testid="site-account-use-active"]').text()).toBe(
      'sidebar.activeSite.useActive:bob',
    );
  });

  it('asks again when the active account changes', async () => {
    mocks.getSiteAccount.mockResolvedValue(bound());
    const wrapper = await mountNotice(ALICE);

    mocks.getSiteAccount.mockResolvedValue(mismatched());
    await wrapper.setProps({ activePubkey: BOB });
    await flushPromises();

    expect(mocks.getSiteAccount).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-testid="site-account-mismatch"]').exists()).toBe(true);
  });

  it('confirms before switching, and says to sign in to the site again', async () => {
    mocks.getSiteAccount.mockResolvedValue(mismatched());
    const wrapper = await mountNotice(BOB);

    await wrapper.find('[data-testid="site-account-use-active"]').trigger('click');
    await flushPromises();

    const [options] = mocks.dialog.mock.calls[0] as [{ title: string; message: string }];
    expect(options.title).toBe(`sidebar.activeSite.useActiveTitle:${ORIGIN},bob`);
    expect(options.message).toBe(`sidebar.activeSite.useActiveBody:${ORIGIN},bob`);
    expect(mocks.switchSiteToActiveAccount).toHaveBeenCalledWith(ORIGIN);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'positive' }));
    // The notice now reflects the new binding.
    expect(wrapper.find('[data-testid="site-account-mismatch"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="site-account-bound"]').text()).toBe(
      'sidebar.activeSite.connectedAs:bob',
    );
  });

  it('changes nothing when the confirmation is cancelled', async () => {
    mocks.getSiteAccount.mockResolvedValue(mismatched());
    mocks.dialog.mockReturnValue({ onOk: () => undefined });
    const wrapper = await mountNotice(BOB);

    await wrapper.find('[data-testid="site-account-use-active"]').trigger('click');
    await flushPromises();

    expect(mocks.switchSiteToActiveAccount).not.toHaveBeenCalled();
  });

  it('says so when the switch is refused, and keeps the warning', async () => {
    mocks.getSiteAccount.mockResolvedValue(mismatched());
    mocks.switchSiteToActiveAccount.mockResolvedValue({ success: false, error: 'Vault is locked' });
    const wrapper = await mountNotice(BOB);

    await wrapper.find('[data-testid="site-account-use-active"]').trigger('click');
    await flushPromises();

    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
    expect(wrapper.find('[data-testid="site-account-mismatch"]').exists()).toBe(true);
  });
});
