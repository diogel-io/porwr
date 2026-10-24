import { randomUUID } from 'node:crypto';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useWalletConnectWindow,
  type UseWalletConnectWindowResult,
} from '@/composables/useWalletConnectWindow';
import { cancelNip47Authorization, openNip47Authorization } from '@/services/nip47-service';
import { postWalletConnectOutcome } from '@/services/wallet-connect-channel';

vi.mock('@/services/nip47-service', () => ({
  cancelNip47Authorization: vi.fn(() => Promise.resolve()),
  openNip47Authorization: vi.fn(),
}));

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
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'popup', width: 420, height: 680 }),
    );
    const { url, params } = openedRequest();
    expect(url.href.startsWith('chrome-extension://porwr/www/index.html#/wallet-connect?')).toBe(
      true,
    );
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

    await expect(pending).resolves.toEqual({
      status: 'connected',
      connection: { id: 'w', label: 'Coinos' },
    });
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
    postWalletConnectOutcome(openedRequest().params.get('request')!, {
      status: 'error',
      message: 'Vault is locked',
    });

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

describe('useWalletConnectWindow in Firefox (workspace#85)', () => {
  beforeEach(() => {
    vi.mocked(openNip47Authorization).mockReset().mockResolvedValue({ pendingId: 'p' });
    const stubbed = globalThis.chrome as unknown as {
      runtime: { getURL: (path: string) => string };
    };
    stubbed.runtime.getURL = (path: string) => `moz-extension://porwr/${path}`;
  });

  it('has the background open the wallet, with no connect window, and takes its outcome', async () => {
    const { api } = harness();

    const result = api.connect('alby-hub', ACCOUNT, ' http://192.168.1.50:59000 ');
    await settle();

    expect(create).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
    const request = vi.mocked(openNip47Authorization).mock.calls[0]![0];
    expect(request).toMatchObject({
      accountPubkey: ACCOUNT,
      provider: 'alby-hub',
      customOrigin: 'http://192.168.1.50:59000',
    });
    expect(request.requestId).toMatch(/^[0-9a-f-]{36}$/);

    postWalletConnectOutcome(request.requestId, { status: 'no-response' });
    await expect(result).resolves.toEqual({ status: 'no-response' });
  });

  it('closes the wallet window in the background when it stops waiting', async () => {
    vi.mocked(cancelNip47Authorization).mockClear();
    vi.useFakeTimers();
    const { api, wrapper } = harness(1_000);

    const timedOut = api.connect('coinos', ACCOUNT);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(timedOut).resolves.toEqual({ status: 'cancelled' });
    await vi.advanceTimersByTimeAsync(0);
    const { requestId } = vi.mocked(openNip47Authorization).mock.calls[0]![0];
    expect(cancelNip47Authorization).toHaveBeenCalledWith(requestId);

    void api.connect('coinos', ACCOUNT);
    await vi.advanceTimersByTimeAsync(0);
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(0);
    expect(cancelNip47Authorization).toHaveBeenCalledTimes(2);
  });

  it('waits for a save the background could no longer stop when its wait ran out', async () => {
    vi.mocked(cancelNip47Authorization).mockResolvedValueOnce('committed');
    vi.useFakeTimers();
    const { api } = harness(1_000);

    const result = api.connect('alby-hub', ACCOUNT);
    await vi.advanceTimersByTimeAsync(1_000);
    const { requestId } = vi.mocked(openNip47Authorization).mock.calls[0]![0];
    postWalletConnectOutcome(requestId, {
      status: 'connected',
      connection: { id: 'w', label: 'Alby Hub' } as never,
    });

    await expect(result).resolves.toMatchObject({ status: 'connected' });
  });

  it("does not let a finished wait's fallback undo a later connection's cancel hook", async () => {
    vi.mocked(cancelNip47Authorization).mockClear();
    vi.mocked(cancelNip47Authorization).mockResolvedValueOnce('committed');
    vi.useFakeTimers();
    const { api, wrapper } = harness(1_000);

    const first = api.connect('alby-hub', ACCOUNT);
    await vi.advanceTimersByTimeAsync(1_000);
    const firstId = vi.mocked(openNip47Authorization).mock.calls[0]![0].requestId;
    postWalletConnectOutcome(firstId, { status: 'no-response' });
    await first;

    // A second connection starts, then the first one's 30 s fallback would have fired.
    void api.connect('alby-hub', ACCOUNT);
    await vi.advanceTimersByTimeAsync(0);
    const secondId = vi.mocked(openNip47Authorization).mock.calls[1]![0].requestId;
    await vi.advanceTimersByTimeAsync(30_000);

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(0);
    expect(cancelNip47Authorization).toHaveBeenLastCalledWith(secondId);
  });

  it('cancels nothing once the outcome has arrived', async () => {
    vi.mocked(cancelNip47Authorization).mockClear();
    const { api } = harness();

    const result = api.connect('alby-hub', ACCOUNT);
    await settle();
    const { requestId } = vi.mocked(openNip47Authorization).mock.calls[0]![0];
    postWalletConnectOutcome(requestId, { status: 'no-response' });
    await result;

    expect(cancelNip47Authorization).not.toHaveBeenCalled();
  });

  it('fails when the background cannot open the wallet, and cancels what it may have opened', async () => {
    vi.mocked(cancelNip47Authorization).mockClear();
    vi.mocked(openNip47Authorization).mockRejectedValue(new Error('Background did not answer'));
    const { api } = harness();

    await expect(api.connect('coinos', ACCOUNT)).rejects.toThrow('Background did not answer');
    const { requestId } = vi.mocked(openNip47Authorization).mock.calls[0]![0];
    expect(cancelNip47Authorization).toHaveBeenCalledWith(requestId);
  });
});
