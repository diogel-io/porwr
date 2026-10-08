import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VaultLogin from '@/pages/extension/VaultLogin.vue';

const testState = vi.hoisted(() => ({
  notifyMock: vi.fn(),
  pushMock: vi.fn(),
  checkVaultStatusMock: vi.fn(async () => undefined),
  route: {
    path: '/login',
    name: 'login',
    query: {} as Record<string, string>,
  },
  vaultStore: {
    vaultExists: true,
    isLoading: false,
    isUnlocked: false,
    lastLockReason: null as string | null,
    checkVaultStatus: vi.fn(async () => undefined),
  },
}));

testState.vaultStore.checkVaultStatus = testState.checkVaultStatusMock;

vi.mock('quasar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('quasar')>();
  return {
    ...actual,
    useQuasar: () => ({
      notify: testState.notifyMock,
    }),
  };
});

vi.mock('vue-router', () => ({
  useRoute: () => testState.route,
  useRouter: () => ({
    push: testState.pushMock,
  }),
}));

vi.mock('@/composables/useVault', () => ({
  useVault: () => ({
    vaultStore: testState.vaultStore,
    password: '',
    confirmPassword: '',
    loading: false,
    loginError: '',
    handleCreate: vi.fn(),
    handleUnlock: vi.fn(),
    getPostLoginRouteName: () => 'home',
  }),
}));

const mountPage = () =>
  mount(VaultLogin, {
    global: {
      stubs: {
        DiogelLogo: { template: '<div class="diogel-logo-stub" />' },
        'q-page': { template: '<div><slot /></div>' },
        'q-card': { template: '<div><slot /></div>' },
        'q-card-section': { template: '<section><slot /></section>' },
        'q-card-actions': { template: '<div><slot /></div>' },
        'q-input': true,
        'q-btn': true,
      },
    },
  });

describe('VaultLogin.vue', () => {
  beforeEach(() => {
    testState.notifyMock.mockReset();
    testState.pushMock.mockReset();
    testState.checkVaultStatusMock.mockClear();
    testState.route.query = {};
    testState.vaultStore.vaultExists = true;
    testState.vaultStore.isLoading = false;
    testState.vaultStore.isUnlocked = false;
    testState.vaultStore.lastLockReason = null;
  });

  it('shows and notifies a locked-vault signer approval message', async () => {
    testState.route.query = {
      redirect: '/settings',
      origin: 'https://example.test',
      kind: '1',
      approvalVaultLocked: 'true',
    };

    const wrapper = mountPage();
    await wrapper.vm.$nextTick();

    expect(testState.checkVaultStatusMock).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Vault is locked. Unlock your vault to approve the signer request.');
    expect(testState.notifyMock).toHaveBeenCalledWith({
      type: 'warning',
      message: 'Vault is locked. Unlock your vault to approve the signer request.',
      position: 'top',
      timeout: 6000,
    });
  });

  it('does not show the signer approval locked message during normal login', async () => {
    const wrapper = mountPage();
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).not.toContain('Vault is locked. Unlock your vault to approve the signer request.');
    expect(testState.notifyMock).not.toHaveBeenCalled();
  });
});
