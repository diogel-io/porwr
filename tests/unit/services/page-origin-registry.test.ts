import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/log-service', () => ({
  LogLevel: { DEBUG: 'debug' },
  logService: { log: vi.fn() },
}));

import {
  __resetPageOriginsForTests,
  forgetPageOrigin,
  getPageOrigin,
  listPageOrigins,
  observePageConnections,
  onPageOriginChange,
  recordPageOrigin,
  restorePageOrigins,
} from '@/../src-bex/services/page-origin-registry';

type Sender = chrome.runtime.MessageSender;

const sender = (over: Partial<Sender> & { tabId?: number } = {}): Sender =>
  ({
    origin: 'https://example.com',
    frameId: 0,
    tab: { id: over.tabId ?? 1, windowId: 10 },
    ...over,
  }) as Sender;

const sessionStore: Record<string, unknown> = {};

beforeEach(() => {
  vi.clearAllMocks();
  __resetPageOriginsForTests();
  for (const key of Object.keys(sessionStore)) delete sessionStore[key];
  vi.stubGlobal('chrome', {
    storage: {
      session: {
        set: vi.fn(async (items: Record<string, unknown>) => Object.assign(sessionStore, items)),
        get: vi.fn(async (key: string) => ({ [key]: sessionStore[key] })),
      },
    },
    runtime: { onConnect: { addListener: vi.fn() } },
    tabs: { onRemoved: { addListener: vi.fn() } },
  });
});

describe('page origin registry', () => {
  describe('what it trusts', () => {
    it('records the origin the browser stamped on the sender', () => {
      recordPageOrigin(sender());

      expect(getPageOrigin(1)).toBe('https://example.com');
    });

    it('ignores subframes so an iframe cannot relabel the tab it sits in', () => {
      recordPageOrigin(sender());
      recordPageOrigin(sender({ origin: 'https://evil.example', frameId: 3 }));

      expect(getPageOrigin(1)).toBe('https://example.com');
    });

    it('ignores senders with no tab, which is every extension surface', () => {
      recordPageOrigin({ origin: 'https://example.com', frameId: 0 } as Sender);

      expect(listPageOrigins().size).toBe(0);
    });

    it('ignores schemes that name no site a user can act on', () => {
      recordPageOrigin(sender({ origin: 'chrome-extension://abc' }));
      recordPageOrigin(sender({ tabId: 2, origin: 'file://' }));
      recordPageOrigin(sender({ tabId: 3, origin: 'null' }));

      expect(listPageOrigins().size).toBe(0);
    });
  });

  describe('liveness', () => {
    it('forgets a tab and reports the change', () => {
      const seen: Array<[number, string | undefined]> = [];
      onPageOriginChange((tabId: number, record) => seen.push([tabId, record?.origin]));

      recordPageOrigin(sender());
      forgetPageOrigin(1);

      expect(getPageOrigin(1)).toBeUndefined();
      expect(seen).toEqual([
        [1, 'https://example.com'],
        [1, undefined],
      ]);
    });

    it('does not report a change for a tab it never knew', () => {
      const listener = vi.fn();
      onPageOriginChange(listener);

      forgetPageOrigin(99);

      expect(listener).not.toHaveBeenCalled();
    });

    it('drops the record when the content script port disconnects', () => {
      observePageConnections();

      const chromeMock = globalThis.chrome as unknown as {
        runtime: { onConnect: { addListener: ReturnType<typeof vi.fn> } };
      };
      const onConnect = chromeMock.runtime.onConnect.addListener.mock.calls[0]?.[0] as (
        port: chrome.runtime.Port,
      ) => void;

      const disconnectHandlers: Array<() => void> = [];
      onConnect({
        sender: sender(),
        onDisconnect: { addListener: (fn: () => void) => disconnectHandlers.push(fn) },
      } as unknown as chrome.runtime.Port);

      expect(getPageOrigin(1)).toBe('https://example.com');

      // Navigation, tab close, window close and crash all surface here.
      disconnectHandlers.forEach((fn) => fn());
      expect(getPageOrigin(1)).toBeUndefined();
    });
  });

  describe('surviving a worker restart', () => {
    it('restores what it had persisted', async () => {
      recordPageOrigin(sender());
      await Promise.resolve();

      __resetPageOriginsForTests();
      expect(getPageOrigin(1)).toBeUndefined();

      await restorePageOrigins();
      expect(getPageOrigin(1)).toBe('https://example.com');
    });

    it('survives session storage holding nothing usable', async () => {
      sessionStore['porwr.pageOrigins'] = 'not an array';

      await expect(restorePageOrigins()).resolves.toBeUndefined();
      expect(listPageOrigins().size).toBe(0);
    });
  });
});
