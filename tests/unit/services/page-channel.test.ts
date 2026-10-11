import { describe, it, expect, vi } from 'vitest';

import {
  servePagePort,
  stripPagePayload,
  type PageActionHandlers,
  type PagePortLike,
} from '@/../src-bex/services/page-channel';
import { PAGE_ACTIONS, PAGE_PORT_NAME, type PageReplyMessage } from '@/../src-bex/page-actions';

/**
 * Page requests are attributed to the site the browser says sent them (#246).
 *
 * The content script runs in the site's renderer, so whatever it writes into a request is the site's
 * word, or a compromised renderer's. These run the background's end of the page channel against a
 * fake port and check the origin a handler receives is always the sender's.
 */

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const EXTENSION = `chrome-extension://${ID}`;
const SITE = {
  id: ID,
  url: 'https://example.com/app',
  origin: 'https://example.com',
  frameId: 0,
  tab: { id: 4 },
};

const fakePort = (sender: PagePortLike['sender']) => {
  let onMessage: (message: unknown) => void = () => undefined;
  let onDisconnect: () => void = () => undefined;
  const replies: PageReplyMessage[] = [];
  const port: PagePortLike = {
    name: PAGE_PORT_NAME,
    sender,
    postMessage: (message) => replies.push(message),
    onMessage: { addListener: (listener) => (onMessage = listener) },
    onDisconnect: { addListener: (listener) => (onDisconnect = listener) },
  };
  return {
    port,
    replies,
    send: (message: unknown) => onMessage(message),
    disconnect: () => onDisconnect(),
  };
};

const handlersWith = (impl: (payload: unknown, origin: string) => Promise<unknown>) =>
  Object.fromEntries(
    [...PAGE_ACTIONS].map((action) => [action, vi.fn(impl)]),
  ) as unknown as PageActionHandlers & Record<string, ReturnType<typeof vi.fn>>;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the page channel (#246)', () => {
  it('hands the handler the sender’s origin, whatever origin the request claims', async () => {
    const handlers = handlersWith(() => Promise.resolve('npub'));
    const { port, replies, send } = fakePort(SITE);
    servePagePort(port, handlers, ID, EXTENSION);

    send({ id: '1', action: 'nostr.getPublicKey', payload: { origin: 'https://other.example' } });
    await settle();

    expect(handlers['nostr.getPublicKey']).toHaveBeenCalledWith({}, 'https://example.com');
    expect(replies).toEqual([{ id: '1', result: 'npub' }]);
  });

  it('removes origin and approved from the payload, and keeps the rest', async () => {
    const handlers = handlersWith(() => Promise.resolve({ preimage: 'p' }));
    const { port, send } = fakePort(SITE);
    servePagePort(port, handlers, ID, EXTENSION);

    send({
      id: '2',
      action: 'webln.sendPayment',
      payload: { paymentRequest: 'lnbc1', approved: true, origin: 'x' },
    });
    await settle();

    expect(handlers['webln.sendPayment']).toHaveBeenCalledWith(
      { paymentRequest: 'lnbc1' },
      'https://example.com',
    );
  });

  it('attributes a cross-origin iframe’s request to the iframe', async () => {
    const handlers = handlersWith(() => Promise.resolve('ok'));
    const iframe = {
      ...SITE,
      url: 'https://widget.example/x',
      origin: 'https://widget.example',
      frameId: 2,
    };
    const { port, send } = fakePort(iframe);
    servePagePort(port, handlers, ID, EXTENSION);

    send({ id: '3', action: 'nostr.getRelays', payload: {} });
    await settle();

    expect(handlers['nostr.getRelays']).toHaveBeenCalledWith({}, 'https://widget.example');
  });

  it('refuses every request when the sender names no site, and runs no handler', async () => {
    const handlers = handlersWith(() => Promise.resolve('never'));
    const { port, replies, send } = fakePort({
      ...SITE,
      url: 'file:///page.html',
      origin: undefined,
    });
    servePagePort(port, handlers, ID, EXTENSION);

    send({
      id: '4',
      action: 'nostr.signEvent',
      payload: { event: {}, origin: 'https://example.com' },
    });
    await settle();

    expect(handlers['nostr.signEvent']).not.toHaveBeenCalled();
    expect(replies).toEqual([
      { id: '4', error: 'Porwr could not tell which site sent this request.' },
    ]);
  });

  it('refuses a port opened by one of Porwr’s own pages', async () => {
    const handlers = handlersWith(() => Promise.resolve('never'));
    const { port, replies, send } = fakePort({ id: ID, url: `${EXTENSION}/www/index.html` });
    servePagePort(port, handlers, ID, EXTENSION);

    send({ id: '5', action: 'nostr.getPublicKey', payload: {} });
    await settle();

    expect(replies[0]).toMatchObject({ id: '5', error: expect.any(String) });
  });

  it('refuses an action a page may not ask for', async () => {
    const handlers = handlersWith(() => Promise.resolve('never'));
    const { port, replies, send } = fakePort(SITE);
    servePagePort(port, handlers, ID, EXTENSION);

    send({ id: '6', action: 'nostr.requests.respond', payload: { decision: 'approve' } });
    send({ id: '7', action: 'vault.getView', payload: {} });
    await settle();

    expect(replies).toEqual([
      { id: '6', error: 'Unsupported action: nostr.requests.respond' },
      { id: '7', error: 'Unsupported action: vault.getView' },
    ]);
  });

  it('answers a handler’s failure with its message', async () => {
    const handlers = handlersWith(() => Promise.reject(new Error('User rejected the request')));
    const { port, replies, send } = fakePort(SITE);
    servePagePort(port, handlers, ID, EXTENSION);

    send({ id: '8', action: 'nostr.getPublicKey', payload: {} });
    await settle();

    expect(replies).toEqual([{ id: '8', error: 'User rejected the request' }]);
  });

  it('ignores messages that are not requests, and sends nothing after the page has gone', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const handlers = handlersWith(() => new Promise((resolve) => (finish = resolve)));
    const { port, replies, send, disconnect } = fakePort(SITE);
    servePagePort(port, handlers, ID, EXTENSION);

    send('hello');
    send({ action: 'nostr.getPublicKey' });
    send({ id: '9', action: 'nostr.getPublicKey', payload: {} });
    disconnect();
    finish('late');
    await settle();

    expect(replies).toEqual([]);
  });
});

describe('stripPagePayload', () => {
  it('returns an empty payload for anything that is not a plain object', () => {
    expect(stripPagePayload(undefined)).toEqual({});
    expect(stripPagePayload('x')).toEqual({});
    expect(stripPagePayload(['origin'])).toEqual({});
  });
});
