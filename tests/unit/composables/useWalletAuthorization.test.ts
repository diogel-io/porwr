import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const service = vi.hoisted(() => ({
  beginNip47Authorization: vi.fn(),
  completeNip47Authorization: vi.fn(),
  probeNip47Authorization: vi.fn(),
}));

vi.mock('@/services/nip47-service', () => service);

import { useWalletAuthorization } from '@/composables/useWalletAuthorization';

const ORIGIN = 'https://coinos.io';
const WALLET = 'b'.repeat(64);
const START = {
  pendingId: 'pending-1',
  clientPubkey: 'c'.repeat(64),
  origin: ORIGIN,
  authorizationUrl: `${ORIGIN}/apps/new?name=Porwr&pubkey=${'c'.repeat(64)}`,
};
const CONNECTION = { id: 'w', label: 'Coinos' };

interface FakePopup {
  closed: boolean;
  location: { href: string };
  close: () => void;
}

function setup() {
  const listeners = new Set<(event: MessageEvent) => void>();
  const popup: FakePopup = {
    closed: false,
    location: { href: 'about:blank' },
    close: vi.fn(() => {
      popup.closed = true;
    }),
  };
  const host = {
    open: vi.fn((): FakePopup | null => popup),
    addEventListener: vi.fn((_type: string, listener: (event: MessageEvent) => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: (event: MessageEvent) => void) => listeners.delete(listener)),
  };
  const post = (data: unknown, origin = ORIGIN, source: unknown = popup): void => {
    for (const listener of [...listeners]) {
      listener({ data, origin, source } as MessageEvent);
    }
  };
  const { connecting, connect } = useWalletAuthorization({
    host: host as unknown as Window,
    pollIntervalMs: 100,
    timeoutMs: 10_000,
  });
  return { host, popup, post, listeners, connecting, connect };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  service.beginNip47Authorization.mockResolvedValue(START);
  service.completeNip47Authorization.mockResolvedValue(CONNECTION);
  service.probeNip47Authorization.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

const ACCOUNT = 'a'.repeat(64);

describe('useWalletAuthorization', () => {
  it('opens the popup before awaiting anything, then sends it to the wallet', async () => {
    const { host, popup, connecting, connect } = setup();

    const pending = connect('coinos', ACCOUNT);
    expect(host.open).toHaveBeenCalledWith('about:blank', 'porwr-wallet-connect', expect.stringContaining('popup'));
    expect(connecting.value).toBe('coinos');

    await vi.waitFor(() => expect(popup.location.href).toBe(START.authorizationUrl));
    expect(service.beginNip47Authorization).toHaveBeenCalledWith({ accountPubkey: ACCOUNT, provider: 'coinos' });

    popup.closed = true;
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(connecting.value).toBeNull();
  });

  it('completes the connection from the wallet message and closes the popup', async () => {
    const { popup, post, listeners, connect } = setup();

    const pending = connect('coinos', ACCOUNT);
    await vi.waitFor(() => expect(popup.location.href).toBe(START.authorizationUrl));
    post({ type: 'nwc:success', walletPubkey: WALLET, relayUrl: 'wss://relay.coinos.io', lud16: 'alice@coinos.io' });

    await expect(pending).resolves.toEqual({ status: 'connected', connection: CONNECTION });
    expect(service.completeNip47Authorization).toHaveBeenCalledWith({
      pendingId: 'pending-1',
      walletServicePubkey: WALLET,
      relays: [expect.stringMatching(/^wss:\/\/relay\.coinos\.io\/?$/)],
      lud16: 'alice@coinos.io',
    });
    expect(service.probeNip47Authorization).not.toHaveBeenCalled();
    expect(popup.close).toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it('ignores messages from another origin or another window', async () => {
    const { popup, post, connect } = setup();

    const pending = connect('coinos', ACCOUNT);
    await vi.waitFor(() => expect(popup.location.href).toBe(START.authorizationUrl));
    const message = { type: 'nwc:success', walletPubkey: WALLET, relayUrl: 'wss://relay.coinos.io' };
    post(message, 'https://evil.example.com');
    post(message, ORIGIN, {});
    post({ type: 'something-else' });

    popup.closed = true;
    await vi.advanceTimersByTimeAsync(100);

    await expect(pending).resolves.toEqual({ status: 'no-response' });
    expect(service.completeNip47Authorization).not.toHaveBeenCalled();
  });

  it('asks the background to check with the wallet when the popup closes without a message', async () => {
    service.probeNip47Authorization.mockResolvedValue(CONNECTION);
    const { popup, connect } = setup();

    const pending = connect('coinos', ACCOUNT);
    await vi.waitFor(() => expect(popup.location.href).toBe(START.authorizationUrl));
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(100);

    await expect(pending).resolves.toEqual({ status: 'connected', connection: CONNECTION });
    expect(service.probeNip47Authorization).toHaveBeenCalledWith('pending-1');
  });

  it('gives up and closes the popup after the timeout', async () => {
    const { popup, connect } = setup();

    const pending = connect('alby-hub', ACCOUNT, ' https://hub.example.com ');
    await vi.waitFor(() => expect(popup.location.href).toBe(START.authorizationUrl));
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toEqual({ status: 'no-response' });
    expect(service.beginNip47Authorization).toHaveBeenCalledWith({
      accountPubkey: ACCOUNT,
      provider: 'alby-hub',
      customOrigin: 'https://hub.example.com',
    });
    expect(popup.close).toHaveBeenCalled();
  });

  it('reports a blocked popup without starting anything', async () => {
    const { host, connect } = setup();
    host.open.mockReturnValue(null);

    await expect(connect('coinos', ACCOUNT)).resolves.toEqual({ status: 'popup-blocked' });
    expect(service.beginNip47Authorization).not.toHaveBeenCalled();
  });

  it('closes the popup and rethrows when the background refuses to start', async () => {
    service.beginNip47Authorization.mockRejectedValue(new Error('Vault is locked'));
    const { popup, connecting, connect } = setup();

    await expect(connect('coinos', ACCOUNT)).rejects.toThrow('Vault is locked');
    expect(popup.close).toHaveBeenCalled();
    expect(connecting.value).toBeNull();
  });
});
