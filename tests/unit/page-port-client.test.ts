import { describe, it, expect, vi } from 'vitest';

import { createPagePortClient } from '@/../src-bex/page-port-client';
import { PAGE_PORT_NAME } from '@/../src-bex/page-actions';

/**
 * The content script's end of the page channel (#246): one port, opened at load and reopened after
 * the background restarts, with each request matched to its answer by id.
 */

const fakePort = () => {
  const messageListeners: Array<(message: unknown) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  const sent: Array<{ id: string; action: string; payload: unknown }> = [];
  return {
    sent,
    port: {
      postMessage: vi.fn((message: { id: string; action: string; payload: unknown }) =>
        sent.push(message),
      ),
      onMessage: {
        addListener: (listener: (message: unknown) => void) => messageListeners.push(listener),
      },
      onDisconnect: { addListener: (listener: () => void) => disconnectListeners.push(listener) },
    },
    reply: (message: unknown) => messageListeners.forEach((listener) => listener(message)),
    disconnect: () => disconnectListeners.forEach((listener) => listener()),
  };
};

const setup = () => {
  const ports: Array<ReturnType<typeof fakePort>> = [];
  const connect = vi.fn((name: string) => {
    expect(name).toBe(PAGE_PORT_NAME);
    const created = fakePort();
    ports.push(created);
    return created.port as unknown as chrome.runtime.Port;
  });
  return { client: createPagePortClient(connect), connect, ports };
};

describe('createPagePortClient', () => {
  it('opens the porwr:page port once, and sends requests without any origin', async () => {
    const { client, connect, ports } = setup();
    client.connect();

    const answer = client.send('nostr.getPublicKey', {});
    const [port] = ports;
    expect(connect).toHaveBeenCalledTimes(1);
    expect(port!.sent).toEqual([
      { id: expect.any(String), action: 'nostr.getPublicKey', payload: {} },
    ]);

    port!.reply({ id: port!.sent[0]!.id, result: 'npub1' });
    await expect(answer).resolves.toBe('npub1');
  });

  it('matches each answer to its own request', async () => {
    const { client, ports } = setup();
    const first = client.send('nostr.getRelays', {});
    const second = client.send('nostr.getPublicKey', {});
    const [port] = ports;

    port!.reply({ id: port!.sent[1]!.id, result: 'second' });
    port!.reply({ id: port!.sent[0]!.id, error: 'User rejected the request' });

    await expect(second).resolves.toBe('second');
    await expect(first).rejects.toThrow('User rejected the request');
  });

  it('fails a request still waiting when the port drops, and reconnects for the next one', async () => {
    const { client, connect, ports } = setup();
    const stranded = client.send('nostr.signEvent', { event: {} });
    ports[0]!.disconnect();

    await expect(stranded).rejects.toThrow('Lost connection to Porwr');

    const next = client.send('nostr.getPublicKey', {});
    expect(connect).toHaveBeenCalledTimes(2);
    ports[1]!.reply({ id: ports[1]!.sent[0]!.id, result: 'again' });
    await expect(next).resolves.toBe('again');
  });

  it('rejects when the port cannot be opened, and tries again next time', async () => {
    const connect = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('Extension context invalidated.');
      })
      .mockImplementation(() => fakePort().port);
    const client = createPagePortClient(connect);

    await expect(client.send('nostr.getPublicKey', {})).rejects.toThrow(
      'Extension context invalidated.',
    );
    void client.send('nostr.getPublicKey', {});
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('ignores messages that are not answers to a pending request', () => {
    const { client, ports } = setup();
    void client.send('nostr.getPublicKey', {});

    expect(() => {
      ports[0]!.reply('noise');
      ports[0]!.reply({ id: 'unknown', result: 1 });
    }).not.toThrow();
  });
});
