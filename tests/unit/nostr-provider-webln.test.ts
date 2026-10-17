import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The zap route a client takes through Porwr (#270): it has Porwr sign its kind 9734 zap request
 * through `window.nostr`, fetches the invoice itself, and pays it through `window.webln`.
 */
const providerSource = readFileSync('src-bex/nostr-provider.js', 'utf8');

interface PageWindow extends Window {
  nostr?: { signEvent: (event: unknown) => Promise<unknown> };
  webln?: Record<string, (...args: unknown[]) => Promise<unknown>>;
  diogelWebln?: Record<string, (...args: unknown[]) => Promise<unknown>>;
}

const page = window as PageWindow;
const listeners: ((event: MessageEvent) => void)[] = [];

function loadProvider(): void {
  new Function(providerSource)();
}

/** Answers every provider request as the content script would, recording what was asked. */
function answerRequests(): { method: string; payload: unknown }[] {
  const asked: { method: string; payload: unknown }[] = [];
  const listener = (event: MessageEvent) => {
    const data = event.data as { type?: string; id?: string; method?: string; payload?: unknown };
    if (data?.type !== 'diogel-request') return;
    asked.push({ method: data.method!, payload: data.payload });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { id: data.id, response: true, result: `${data.method} ok` },
        origin: window.location.origin,
        source: window,
      }),
    );
  };
  listeners.push(listener);
  window.addEventListener('message', listener);
  return asked;
}

beforeEach(() => {
  delete page.nostr;
  delete page.webln;
  delete page.diogelWebln;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  listeners.splice(0).forEach((listener) => window.removeEventListener('message', listener));
  vi.restoreAllMocks();
});

describe('injected provider zap route (#270)', () => {
  it('signs a zap request through window.nostr and pays the invoice through window.webln', async () => {
    const asked = answerRequests();
    loadProvider();
    const zapRequest = { kind: 9734, content: '', tags: [['amount', '21000']], created_at: 1 };

    await expect(page.nostr!.signEvent(zapRequest)).resolves.toBe('signEvent ok');
    await expect(page.webln!.enable!()).resolves.toBe('webln.enable ok');
    await expect(page.webln!.sendPayment!('lnbc210n1example')).resolves.toBe(
      'webln.sendPayment ok',
    );

    expect(asked).toEqual([
      { method: 'signEvent', payload: { event: zapRequest } },
      { method: 'webln.enable', payload: {} },
      { method: 'webln.sendPayment', payload: { paymentRequest: 'lnbc210n1example' } },
    ]);
  });

  it.each(['sendPaymentAsync', 'keysend', 'makeInvoice', 'signMessage', 'verifyMessage', 'lnurl'])(
    'rejects WebLN %s with UnsupportedMethodError rather than leaving it undefined',
    async (method) => {
      const asked = answerRequests();
      loadProvider();

      expect(typeof page.webln![method]).toBe('function');
      await expect(page.webln![method]!()).rejects.toMatchObject({
        name: 'UnsupportedMethodError',
      });
      expect(asked).toEqual([]);
    },
  );

  it("leaves another wallet's window.webln in place and offers Porwr's as window.diogelWebln", () => {
    const otherWallet = { enable: vi.fn() };
    page.webln = otherWallet as unknown as NonNullable<PageWindow['webln']>;
    loadProvider();

    expect(page.webln).toBe(otherWallet);
    expect(typeof page.diogelWebln!.sendPayment).toBe('function');
  });
});

describe('injected provider without Porwr-originated zaps (#271)', () => {
  it('exposes no window.nostr.diogel zap API and does not advertise one', () => {
    const registrations: string[][] = [];
    const onRegistration = (event: Event) =>
      registrations.push((event as CustomEvent<{ methods: string[] }>).detail.methods);
    window.addEventListener('nostr:registration', onRegistration);
    loadProvider();
    window.removeEventListener('nostr:registration', onRegistration);

    expect((page.nostr as Record<string, unknown>).diogel).toBeUndefined();
    expect(registrations).toHaveLength(1);
    expect(registrations[0]!.filter((method) => method.startsWith('diogel.'))).toEqual([]);
  });
});
