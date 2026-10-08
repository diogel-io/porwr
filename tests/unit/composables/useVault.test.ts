import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVault } from '@/composables/useVault';

const testState = vi.hoisted(() => ({
  notifyMock: vi.fn(),
  pushMock: vi.fn(async () => undefined),
  route: {
    name: 'login' as string,
    query: {} as Record<string, string>,
  },
  vaultStore: {
    create: vi.fn(),
    unlock: vi.fn(),
    lock: vi.fn(async () => undefined),
  },
}));

vi.mock('quasar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('quasar')>();
  return {
    ...actual,
    useQuasar: () => ({ notify: testState.notifyMock }),
  };
});

vi.mock('vue-router', () => ({
  useRoute: () => testState.route,
  useRouter: () => ({ push: testState.pushMock }),
}));

vi.mock('@/stores/vault-store', () => ({
  default: () => testState.vaultStore,
}));

interface HarnessVm {
  password: string;
  confirmPassword: string;
  mnemonic: string;
  passphrase: string;
  loading: boolean;
  loginError: string;
  handleCreate: () => Promise<void>;
  handleUnlock: () => Promise<void>;
  handleLock: () => Promise<void>;
  getPostLoginRouteName: () => string;
}

const TestHarness = defineComponent({
  name: 'UseVaultHarness',
  setup() {
    return useVault();
  },
  template: '<div />',
});

describe('useVault', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.route.name = 'login';
    testState.route.query = {};
  });

  describe('handleCreate', () => {
    it('does nothing when the password is too short', async () => {
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;
      vm.password = 'short';
      vm.confirmPassword = 'short';

      await vm.handleCreate();

      expect(testState.vaultStore.create).not.toHaveBeenCalled();
    });

    it('does nothing when the passwords do not match', async () => {
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;
      vm.password = 'longenough1';
      vm.confirmPassword = 'longenough2';

      await vm.handleCreate();

      expect(testState.vaultStore.create).not.toHaveBeenCalled();
    });

    it('creates the vault and goes to key management on success', async () => {
      testState.vaultStore.create.mockResolvedValue({ success: true });
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;
      vm.password = 'longenough1';
      vm.confirmPassword = 'longenough1';

      await vm.handleCreate();

      expect(testState.notifyMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'positive' }));
      // A vault that has just been created holds no keys, and a dashboard with no keys has nothing
      // to show (#198).
      expect(testState.pushMock).toHaveBeenCalledWith({ name: 'keys' });
      expect(vm.loading).toBe(false);
    });

    it('goes to key management regardless of the login context', async () => {
      // The login context still decides where *unlocking* lands. Creation does not consult it:
      // whichever surface the user came from, a brand-new vault has no keys to show there (#198).
      testState.route.query = { loginContext: 'extension' };
      testState.vaultStore.create.mockResolvedValue({ success: true });
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;
      vm.password = 'longenough1';
      vm.confirmPassword = 'longenough1';

      await vm.handleCreate();

      expect(testState.pushMock).toHaveBeenCalledWith({ name: 'keys' });
    });

    it('surfaces a formatted error and notifies on failure', async () => {
      testState.vaultStore.create.mockResolvedValue({ success: false, error: 'boom', errorCode: 'GEN_UNKNOWN' });
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;
      vm.password = 'longenough1';
      vm.confirmPassword = 'longenough1';

      await vm.handleCreate();

      expect(vm.loginError).not.toBe('');
      expect(testState.notifyMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
      expect(testState.pushMock).not.toHaveBeenCalled();
    });
  });

  describe('handleUnlock', () => {
    it('redirects to the requested path on success when one is given', async () => {
      testState.route.query = { redirect: '/settings' };
      testState.vaultStore.unlock.mockResolvedValue({ success: true });
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;
      vm.password = 'correct-password';

      await vm.handleUnlock();

      expect(testState.pushMock).toHaveBeenCalledWith({ path: '/settings', query: testState.route.query });
    });

    it('falls back to the post-login route when no redirect is given', async () => {
      testState.vaultStore.unlock.mockResolvedValue({ success: true });
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;
      vm.password = 'correct-password';

      await vm.handleUnlock();

      expect(testState.pushMock).toHaveBeenCalledWith({ name: 'dashboard' });
    });

    it('surfaces a formatted error and notifies on failure', async () => {
      testState.vaultStore.unlock.mockResolvedValue({ success: false, error: 'Invalid password', errorCode: 'VLT_INVALID_PASSWORD' });
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;
      vm.password = 'wrong-password';

      await vm.handleUnlock();

      expect(vm.loginError).not.toBe('');
      expect(testState.notifyMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
      expect(testState.pushMock).not.toHaveBeenCalled();
    });
  });

  describe('handleLock', () => {
    it('locks the vault and navigates to login with the dashboard context', async () => {
      testState.route.name = 'settings';
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;

      await vm.handleLock();

      expect(testState.vaultStore.lock).toHaveBeenCalledTimes(1);
      expect(testState.pushMock).toHaveBeenCalledWith({ name: 'login', query: { loginContext: 'dashboard' } });
    });

    it('uses the extension login context outside dashboard routes', async () => {
      testState.route.name = 'popup';
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;

      await vm.handleLock();

      expect(testState.pushMock).toHaveBeenCalledWith({ name: 'login', query: { loginContext: 'extension' } });
    });

    it('locks without leaving the panel when the sidebar is the active surface', async () => {
      // The panel renders its own unlock view. Routing would pull the full-tab login page into
      // the 360px panel, which the sidebar surface map forbids.
      testState.route.name = 'sidebar';
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;

      await vm.handleLock();

      expect(testState.vaultStore.lock).toHaveBeenCalledTimes(1);
      expect(testState.pushMock).not.toHaveBeenCalled();
    });
  });

  /**
   * The panel owns a view for every vault state it can be in, so no vault action may navigate it.
   *
   * Unlocking used to push to `dashboard`, which put the full-tab dashboard inside a 360px panel —
   * the failure users actually saw, and a break of S6, where unlocking with a request waiting should
   * present that request (#116).
   */
  describe('inside the panel', () => {
    beforeEach(() => {
      testState.route.name = 'sidebar';
    });

    it('does not navigate after unlocking', async () => {
      testState.vaultStore.unlock.mockResolvedValue({ success: true });
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;
      vm.password = 'a-password';

      await vm.handleUnlock();

      expect(testState.vaultStore.unlock).toHaveBeenCalled();
      expect(testState.pushMock).not.toHaveBeenCalled();
    });

    it('does not navigate after unlocking even when a redirect is queued', async () => {
      // A redirect query belongs to the full-tab login flow and must not drag the panel with it.
      testState.route.query = { redirect: '/settings' };
      testState.vaultStore.unlock.mockResolvedValue({ success: true });
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;
      vm.password = 'a-password';

      await vm.handleUnlock();

      expect(testState.pushMock).not.toHaveBeenCalled();
    });

    it('does not navigate after creating a vault', async () => {
      testState.vaultStore.create.mockResolvedValue({ success: true });
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;
      vm.password = 'a-password';
      vm.confirmPassword = 'a-password';

      await vm.handleCreate();

      expect(testState.pushMock).not.toHaveBeenCalled();
    });

    it('still reports a failed unlock rather than swallowing it', async () => {
      testState.vaultStore.unlock.mockResolvedValue({ success: false, error: 'Wrong password' });
      const wrapper = mount(TestHarness);
      const vm = wrapper.vm as unknown as HarnessVm;
      vm.password = 'wrong';

      await vm.handleUnlock();

      expect(vm.loginError).toBeTruthy();
      expect(testState.pushMock).not.toHaveBeenCalled();
    });
  });
});
