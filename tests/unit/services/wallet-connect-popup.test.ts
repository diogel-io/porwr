import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { observeWalletConnectPopups } from '@/../src-bex/services/wallet-connect-popup';
import { armWalletRelay } from '@/../src-bex/services/wallet-relay-arm';
import { findPendingNip47AuthorizationByPopup } from '@/../src-bex/services/nip47-pending-authorization-store';
import {
  handleNip47AuthorizationPopupClosed,
  handleNip47AuthorizationRelay,
} from '@/../src-bex/handlers/nip47';
import {
  WALLET_RELAY_ARM,
  WALLET_RELAY_PORT_NAME,
} from '@/../src-bex/services/wallet-relay-protocol';

vi.mock('@/../src-bex/handlers/nip47', () => ({
  handleNip47AuthorizationPopupClosed: vi.fn(() => Promise.resolve()),
  handleNip47AuthorizationRelay: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@/../src-bex/services/nip47-pending-authorization-store', () => ({
  findPendingNip47AuthorizationByPopup: vi.fn(),
}));

/**
 * The background's side of a wallet popup it opened itself (workspace#85).
 */

type Listener<T extends unknown[]> = (...args: T) => void;

interface FakePort {
  name: string;
  sender?: chrome.runtime.MessageSender;
  onMessage: { addListener: (l: Listener<[unknown]>) => void; removeListener: () => void };
  disconnect: ReturnType<typeof vi.fn>;
  deliver: (message: unknown) => void;
}

let removed: Listener<[number]>[];
let updated: Listener<[number, { status?: string }]>[];
let connected: Listener<[FakePort]>[];
let sendMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  removed = [];
  updated = [];
  connected = [];
  sendMessage = vi.fn(() => Promise.resolve());
  vi.stubGlobal('chrome', {
    windows: { onRemoved: { addListener: (l: Listener<[number]>) => removed.push(l) } },
    tabs: {
      sendMessage,
      onUpdated: { addListener: (l: Listener<[number, { status?: string }]>) => updated.push(l) },
    },
    runtime: { onConnect: { addListener: (l: Listener<[FakePort]>) => connected.push(l) } },
  });
  observeWalletConnectPopups('porwr');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function openPort(name: string, sender?: chrome.runtime.MessageSender): FakePort {
  let onMessage: Listener<[unknown]> | undefined;
  const port: FakePort = {
    name,
    ...(sender ? { sender } : {}),
    onMessage: {
      addListener: (l) => {
        onMessage = l;
      },
      removeListener: () => {
        onMessage = undefined;
      },
    },
    disconnect: vi.fn(),
    deliver: (message) => onMessage?.(message),
  };
  for (const listener of connected) listener(port);
  return port;
}

const SENDER: chrome.runtime.MessageSender = {
  id: 'porwr',
  tab: { id: 70 } as chrome.tabs.Tab,
  frameId: 0,
  url: 'http://192.168.1.50:59000/apps/created',
};

describe('the wallet relay port', () => {
  it('passes the browser-supplied sender and one message to the handler, then closes', async () => {
    const port = openPort(WALLET_RELAY_PORT_NAME, SENDER);

    port.deliver({ type: 'nwc:success' });
    port.deliver({ type: 'nwc:success', second: true });
    await vi.waitFor(() => expect(port.disconnect).toHaveBeenCalled());

    expect(handleNip47AuthorizationRelay).toHaveBeenCalledOnce();
    expect(handleNip47AuthorizationRelay).toHaveBeenCalledWith(
      { tabId: 70, frameId: 0, url: SENDER.url },
      { type: 'nwc:success' },
    );
  });

  it.each([
    ['another extension', { ...SENDER, id: 'other' }],
    ['no tab', { ...SENDER, tab: undefined }],
    ['no frame', { ...SENDER, frameId: undefined }],
    ['no url', { ...SENDER, url: undefined }],
    ['no sender at all', undefined],
  ])('refuses a port from %s', (_label, sender) => {
    const port = openPort(WALLET_RELAY_PORT_NAME, sender as chrome.runtime.MessageSender);

    port.deliver({ type: 'nwc:success' });

    expect(port.disconnect).toHaveBeenCalled();
    expect(handleNip47AuthorizationRelay).not.toHaveBeenCalled();
  });

  it('leaves ports with other names alone', () => {
    const port = openPort('porwr:page', SENDER);

    expect(port.disconnect).not.toHaveBeenCalled();
  });
});

describe('popup events', () => {
  it('settles an authorization when its window closes', () => {
    for (const listener of removed) listener(7);

    expect(handleNip47AuthorizationPopupClosed).toHaveBeenCalledWith(7);
  });

  it('arms a bound tab when its page finishes loading, and no other', async () => {
    vi.mocked(findPendingNip47AuthorizationByPopup).mockImplementation((match) =>
      Promise.resolve('tabId' in match && match.tabId === 70 ? ({} as never) : null),
    );

    for (const listener of updated) listener(70, { status: 'loading' });
    for (const listener of updated) listener(71, { status: 'complete' });
    for (const listener of updated) listener(70, { status: 'complete' });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith(70, { type: WALLET_RELAY_ARM }, { frameId: 0 });
  });

  it('ignores a tab with no content script to arm', async () => {
    vi.mocked(findPendingNip47AuthorizationByPopup).mockResolvedValue({} as never);
    sendMessage.mockRejectedValue(new Error('Could not establish connection'));

    await expect(armWalletRelay(70)).resolves.toBeUndefined();
  });
});
