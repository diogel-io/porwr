import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVaultAutoLock } from '@/composables/useVaultAutoLock';

const testState = vi.hoisted(() => ({
  vaultStore: { isUnlocked: true },
}));

vi.mock('@/stores/vault-store', () => ({
  default: () => testState.vaultStore,
}));

interface HarnessVm {
  markActivity: () => void;
}

const TestHarness = defineComponent({
  name: 'UseVaultAutoLockHarness',
  setup() {
    return useVaultAutoLock();
  },
  template: '<div />',
});

type BridgeWindow = Window & {
  bridge?: { send: (request: unknown) => void } | undefined;
  $q?: { bex?: { send: (request: unknown) => void } } | undefined;
};

function setBridge(send: ((request: unknown) => void) | undefined) {
  (window as BridgeWindow).bridge = send ? { send } : undefined;
}

describe('useVaultAutoLock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    testState.vaultStore.isUnlocked = true;
    setBridge(undefined);
    (window as BridgeWindow).$q = undefined;
  });

  afterEach(() => {
    setBridge(undefined);
    (window as BridgeWindow).$q = undefined;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('sends an initial activity mark on mount via the Quasar bridge', () => {
    const send = vi.fn();
    setBridge(send);

    mount(TestHarness);

    expect(send).toHaveBeenCalledWith({ event: 'activity.mark', to: 'background' });
  });

  it('falls back to chrome.runtime.sendMessage when no bridge is present', () => {
    const sendMessage = vi.fn();
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    mount(TestHarness);

    expect(sendMessage).toHaveBeenCalledWith({ type: 'activity.mark' });
  });

  it('does not mark activity while the vault is locked', () => {
    testState.vaultStore.isUnlocked = false;
    const send = vi.fn();
    setBridge(send);

    mount(TestHarness);

    expect(send).not.toHaveBeenCalled();
  });

  it('throttles repeated activity events within the throttle window', () => {
    const send = vi.fn();
    setBridge(send);

    const wrapper = mount(TestHarness);
    const vm = wrapper.vm as unknown as HarnessVm;
    send.mockClear(); // clear the initial on-mount mark

    vm.markActivity();
    vm.markActivity();
    vm.markActivity();

    expect(send).not.toHaveBeenCalled(); // still within 10s of the mount-time mark
  });

  it('sends another mark once the throttle window has elapsed', () => {
    const send = vi.fn();
    setBridge(send);

    const wrapper = mount(TestHarness);
    const vm = wrapper.vm as unknown as HarnessVm;
    send.mockClear();

    vi.advanceTimersByTime(10_001);
    vm.markActivity();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('removes its activity listeners on unmount', () => {
    setBridge(vi.fn());
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const wrapper = mount(TestHarness);
    wrapper.unmount();

    expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('click', expect.any(Function));
  });
});
