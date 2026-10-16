import { randomUUID } from 'node:crypto';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWalletConnectWindow, type UseWalletConnectWindowResult } from '@/composables/useWalletConnectWindow';
import { postWalletConnectOutcome } from '@/services/wallet-connect-channel';

const removedListeners = new Set<(id: number) => void>();
const create = vi.fn();

beforeEach(() => {
  removedListeners.clear();
  create.mockReset().mockResolvedValue({ id: 42 });
  vi.stubGlobal('chrome', {
    runtime: { getURL: (path: string) => `chrome-extension://porwr/${path}` },
    windows: {
      create,
      onRemoved: {
        addListener: (listener: (id: number) => void) => removedListeners.add(listener),
        removeListener: (listener: (id: number) => void) => removedListeners.delete(listener),
      },
    },
  });
  vi.stubGlobal('open', vi.fn());
  // jsdom's `crypto` lacks `randomUUID`; extension pages have it.
  vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID });
});

afterEach(() => {
  vi.useRealTimers();
});

const harness = (timeoutMs?: number) => {
  let api!: UseWalletConnectWindowResult;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useWalletConnectWindow(timeoutMs === undefined ? {} : { timeoutMs });
        return {};
      },
      template: '<div />',
    }),
  );
  return { api, wrapper };
};

/** The request id the connect window was given, read back from the URL it was opened at. */
const openedRequest = (): { url: URL; params: URLSearchParams } => {
  const url = new URL((create.mock.calls[0]![0] as { url: string }).url);
  return { url, params: new URLSearchParams(url.hash.split('?')[1]) };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const ACCOUNT = 'a'.repeat(64);

describe('useWalletConnectWindow (workspace#76)', () => {
  it('opens a separate Porwr window for the connection, never a popup from this page', async () => {
    const { api } = harness();

    void api.connect('alby-hub', ACCOUNT, ' https://hub.example.com ');
    await settle();

    expect(window.open).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: 'popup', width: 420, height: 680 }));
    const { url, params } = openedRequest();
    expect(url.href.startsWith('chrome-extension://porwr/www/index.html#/wallet-connect?')).toBe(true);
    expect(params.get('provider')).toBe('alby-hub');
    expect(params.get('origin')).toBe('https://hub.example.com');
    expect(params.get('request')).toMatch(/^[0-9a-f-]{36}$/);
    // Whose wallet the connection becomes, fixed here rather than read from the active account later (#304).
    expect(params.get('account')).toBe(ACCOUNT);
  });

  it('returns the outcome the connect window reports and clears the connecting state', async () => {
    const { api } = harness();

    const pending = api.connect('coinos', ACCOUNT);
    expect(api.connecting.value).toBe('coinos');
    await settle();
    postWalletConnectOutcome(openedRequest().params.get('request')!, {
      status: 'connected',
      connection: { id: 'w', label: 'Coinos' } as never,
    });

    await expect(pending).resolves.toEqual({ status: 'connected', connection: { id: 'w', label: 'Coinos' } });
    expect(api.connecting.value).toBeNull();
    expect(removedListeners.size).toBe(0);
  });

  it('ignores an outcome meant for another connect window', async () => {
    const { api } = harness(200);

    const pending = api.connect('coinos', ACCOUNT);
    await settle();
    postWalletConnectOutcome('someone-else', { status: 'no-response' });

    await expect(pending).resolves.toEqual({ status: 'cancelled' });
  });

  it('turns a reported error into a rejection', async () => {
    const { api } = harness();

    const pending = api.connect('coinos', ACCOUNT);
    await settle();
    postWalletConnectOutcome(openedRequest().params.get('request')!, { status: 'error', message: 'Vault is locked' });

    await expect(pending).rejects.toThrow('Vault is locked');
    expect(api.connecting.value).toBeNull();
  });

  it('is cancelled when the user closes the connect window', async () => {
    const { api } = harness();

    const pending = api.connect('coinos', ACCOUNT);
    await settle();
    removedListeners.forEach((listener) => listener(7));
    removedListeners.forEach((listener) => listener(42));

    await expect(pending).resolves.toEqual({ status: 'cancelled' });
    expect(api.connecting.value).toBeNull();
  });

  it('gives up after the timeout, in case the connect window was navigated away', async () => {
    const { api } = harness(50);

    await expect(api.connect('coinos', ACCOUNT)).resolves.toEqual({ status: 'cancelled' });
    expect(removedListeners.size).toBe(0);
  });

  it('rethrows when the window cannot be created', async () => {
    create.mockRejectedValue(new Error('No windows here'));
    const { api } = harness();

    await expect(api.connect('coinos', ACCOUNT)).rejects.toThrow('No windows here');
    expect(api.connecting.value).toBeNull();
    expect(removedListeners.size).toBe(0);
  });

  it('stops waiting when the page goes away', async () => {
    const { api, wrapper } = harness();

    const pending = api.connect('coinos', ACCOUNT);
    await settle();
    wrapper.unmount();

    await expect(pending).resolves.toEqual({ status: 'cancelled' });
  });
});
