import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, string>,
  connect: vi.fn(),
  post: vi.fn(),
  getCurrent: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('vue-router', () => ({ useRoute: () => ({ query: mocks.query }) }));
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));
vi.mock('@/composables/useWalletAuthorization', () => ({
  useWalletAuthorization: () => ({ connect: mocks.connect }),
}));
vi.mock('@/services/wallet-connect-channel', () => ({ postWalletConnectOutcome: mocks.post }));

import WalletConnectPage from '@/pages/wallet/WalletConnectPage.vue';

const slot = (tag = 'div') => ({ template: `<${tag}><slot /></${tag}>` });

const mountPage = async () => {
  const wrapper = mount(WalletConnectPage, {
    global: {
      stubs: {
        'q-page': slot(),
        'q-card': slot(),
        'q-card-section': slot('section'),
        'q-card-actions': slot(),
        'q-spinner': true,
        DiogelLogo: true,
        'q-btn': {
          template: '<button v-bind="$attrs" @click="$emit(\'click\')">{{ label }}</button>',
          props: ['label'],
          emits: ['click'],
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
};

const message = (wrapper: Awaited<ReturnType<typeof mountPage>>) =>
  wrapper.find('[data-testid="wallet-connect-message"]').text();

const ACCOUNT = 'a'.repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query = { provider: 'coinos', request: 'request-1', account: ACCOUNT };
  mocks.getCurrent.mockResolvedValue({ id: 9 });
  mocks.remove.mockResolvedValue(undefined);
  vi.stubGlobal('chrome', { windows: { getCurrent: mocks.getCurrent, remove: mocks.remove } });
});

describe('the wallet connect window (workspace#76)', () => {
  it('connects straight away, reports the outcome, then closes itself', async () => {
    const connection = { id: 'w', label: 'Coinos' };
    mocks.connect.mockResolvedValue({ status: 'connected', connection });

    const wrapper = await mountPage();

    expect(mocks.connect).toHaveBeenCalledExactlyOnceWith('coinos', ACCOUNT, undefined);
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith('request-1', { status: 'connected', connection });
    expect(mocks.remove).toHaveBeenCalledWith(9);
    expect(message(wrapper)).toBe('walletManagement.connectWindow.finished');
  });

  it('passes a custom Alby Hub origin through', async () => {
    mocks.query = { provider: 'alby-hub', request: 'request-1', account: ACCOUNT, origin: 'https://hub.example.com' };
    mocks.connect.mockResolvedValue({ status: 'no-response' });

    await mountPage();

    expect(mocks.connect).toHaveBeenCalledWith('alby-hub', ACCOUNT, 'https://hub.example.com');
    expect(mocks.post).toHaveBeenCalledWith('request-1', { status: 'no-response' });
  });

  it('asks for a click when the browser blocks the popup, then connects from it', async () => {
    mocks.connect.mockResolvedValueOnce({ status: 'popup-blocked' });
    const wrapper = await mountPage();

    expect(mocks.post).not.toHaveBeenCalled();
    expect(message(wrapper)).toBe('walletManagement.connectWindow.needsClick:Coinos');

    mocks.connect.mockResolvedValueOnce({ status: 'no-response' });
    await wrapper.find('[data-testid="wallet-connect-continue"]').trigger('click');
    await flushPromises();

    expect(mocks.connect).toHaveBeenCalledTimes(2);
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith('request-1', { status: 'no-response' });
  });

  it('reports a popup blocked even after the click, rather than asking forever', async () => {
    mocks.connect.mockResolvedValue({ status: 'popup-blocked' });
    const wrapper = await mountPage();

    await wrapper.find('[data-testid="wallet-connect-continue"]').trigger('click');
    await flushPromises();

    expect(mocks.post).toHaveBeenCalledExactlyOnceWith('request-1', { status: 'popup-blocked' });
  });

  it('reports an error and still closes', async () => {
    mocks.connect.mockRejectedValue(new Error('Vault is locked'));

    await mountPage();

    expect(mocks.post).toHaveBeenCalledWith('request-1', { status: 'error', message: 'Vault is locked' });
    expect(mocks.remove).toHaveBeenCalledWith(9);
  });

  it('stays on the finished state when it cannot close itself', async () => {
    mocks.connect.mockResolvedValue({ status: 'no-response' });
    mocks.remove.mockRejectedValue(new Error('nope'));

    const wrapper = await mountPage();

    expect(message(wrapper)).toBe('walletManagement.connectWindow.finished');
  });

  it.each([
    ['an unknown provider', { provider: 'evil-wallet', request: 'request-1', account: ACCOUNT }],
    ['no request id', { provider: 'coinos', account: ACCOUNT }],
    // No account to connect for: never fall back to whichever account is active (#304).
    ['no account', { provider: 'coinos', request: 'request-1' }],
    ['an account that is not a public key', { provider: 'coinos', request: 'request-1', account: 'npub1x' }],
  ])('does nothing for %s', async (_label, query) => {
    mocks.query = query;

    const wrapper = await mountPage();

    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(message(wrapper)).toBe('walletManagement.connectWindow.invalid');
  });
});
