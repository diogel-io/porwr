import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGE_TYPE_REQUEST } from '@/../src-bex/constants';
import { normalizeErrorMessage } from '@/../src-bex/error-normalizer';
import {
  handleDiogelWindowMessage,
  type WindowMessageBridge,
} from '@/../src-bex/window-message-handler';
import {
  getCurrentWindowOrigin,
  isDiogelWindowMessage,
  isSameWindowOrigin,
} from '@/../src-bex/window-message-security';

const providerSource = readFileSync('src-bex/nostr-provider.js', 'utf8');
const contentScriptSource = readFileSync('src-bex/content-script.ts', 'utf8');
const windowMessageHandlerSource = readFileSync('src-bex/window-message-handler.ts', 'utf8');

describe('postMessage target origin hardening (Static)', () => {
  it('does not use wildcard or empty target origins in BEX source', () => {
    const source = `${providerSource}\n${contentScriptSource}\n${windowMessageHandlerSource}`;

    // Negative match for postMessage(..., '*') or postMessage(..., "*")
    expect(source).not.toMatch(/postMessage\s*\([\s\S]*?,\s*['"]\*['"]\s*\)/);
    // Negative match for postMessage(..., '') or postMessage(..., "")
    expect(source).not.toMatch(/postMessage\s*\([\s\S]*?,\s*['"]['"]\s*\)/);
  });
});

describe('window-message-security helpers', () => {
  it('getCurrentWindowOrigin returns window.location.origin', () => {
    const originalOrigin = window.location.origin;
    expect(getCurrentWindowOrigin()).toBe(originalOrigin);
  });

  it('isSameWindowOrigin returns true for same-origin events', () => {
    const event = {
      origin: window.location.origin,
    } as MessageEvent;
    expect(isSameWindowOrigin(event)).toBe(true);
  });

  it('isSameWindowOrigin returns false for different-origin events', () => {
    const event = {
      origin: 'https://malicious.com',
    } as MessageEvent;
    expect(isSameWindowOrigin(event)).toBe(false);
  });

  it('isDiogelWindowMessage accepts valid messages', () => {
    expect(isDiogelWindowMessage({ id: '123', type: 'diogel-request' })).toBe(true);
    expect(isDiogelWindowMessage({ id: 'abc', type: 'diogel-ping', extra: 'data' })).toBe(true);
  });

  it('isDiogelWindowMessage rejects invalid messages', () => {
    expect(isDiogelWindowMessage(null)).toBe(false);
    expect(isDiogelWindowMessage(undefined)).toBe(false);
    expect(isDiogelWindowMessage('not an object')).toBe(false);
    expect(isDiogelWindowMessage({})).toBe(false);
    expect(isDiogelWindowMessage({ id: '123' })).toBe(false);
    expect(isDiogelWindowMessage({ type: 'diogel-request' })).toBe(false);
    expect(isDiogelWindowMessage({ id: 123, type: 'diogel-request' })).toBe(false);
  });
});

const createBridge = (result: unknown = 'bridge-result'): WindowMessageBridge => ({
  isConnected: true,
  connectToBackground: vi.fn(async () => undefined),
  send: vi.fn(async () => result),
});

const createRequestEvent = (origin: string): MessageEvent<unknown> =>
  new MessageEvent('message', {
    data: {
      id: 'request-1',
      type: MESSAGE_TYPE_REQUEST,
      method: 'getPublicKey',
      payload: {},
    },
    origin,
    source: window,
  });

describe('handleDiogelWindowMessage', () => {
  it('sends same-origin requests to the bridge and posts the response to the page origin', async () => {
    const bridge = createBridge('pubkey-result');
    const postMessage = vi.fn<(message: unknown, targetOrigin: string) => void>();

    await handleDiogelWindowMessage(createRequestEvent(window.location.origin), {
      bridge,
      postMessage,
    });

    expect(bridge.send).toHaveBeenCalledTimes(1);
    expect(bridge.send).toHaveBeenCalledWith({
      event: 'nostr.getPublicKey',
      to: 'background',
      payload: {
        origin: window.location.origin,
      },
    });
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      {
        id: 'request-1',
        response: true,
        result: 'pubkey-result',
      },
      window.location.origin,
    );
  });

  it('ignores cross-origin requests without posting or calling the bridge', async () => {
    const bridge = createBridge('pubkey-result');
    const postMessage = vi.fn<(message: unknown, targetOrigin: string) => void>();

    await handleDiogelWindowMessage(createRequestEvent('https://malicious.example'), {
      bridge,
      postMessage,
    });

    expect(bridge.connectToBackground).not.toHaveBeenCalled();
    expect(bridge.send).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('posts readable messages for object-shaped bridge errors', async () => {
    const bridge: WindowMessageBridge = {
      isConnected: true,
      connectToBackground: vi.fn(async () => undefined),
      send: vi.fn(async () => {
        throw { error: { message: 'Vault is locked. Open the extension to unlock.' } };
      }),
    };
    const postMessage = vi.fn<(message: unknown, targetOrigin: string) => void>();

    await handleDiogelWindowMessage(createRequestEvent(window.location.origin), {
      bridge,
      postMessage,
    });

    expect(postMessage).toHaveBeenCalledWith(
      {
        id: 'request-1',
        response: true,
        error: 'Vault is locked. Open the extension to unlock.',
      },
      window.location.origin,
    );
  });
});

describe('normalizeErrorMessage', () => {
  it('extracts readable messages from object-shaped bridge errors', () => {
    expect(normalizeErrorMessage({ message: 'Permission denied' })).toBe('Permission denied');
    expect(normalizeErrorMessage({ error: 'Vault is locked' })).toBe('Vault is locked');
    expect(normalizeErrorMessage({ error: { message: 'User rejected the request' } })).toBe(
      'User rejected the request',
    );
  });
});

describe('provider error normalization source', () => {
  it('normalizes provider errors before constructing Error instances', () => {
    expect(providerSource).toContain('normalizeErrorMessage');
    expect(providerSource).toContain('new Error(normalizeErrorMessage(event.data.error))');
  });
});

