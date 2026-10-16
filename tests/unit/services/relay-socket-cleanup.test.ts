import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';

/**
 * Relay sockets that never finish connecting are closed (#287).
 *
 * A relay can accept the TCP connection and never answer the WebSocket handshake. nostr-tools 2.23
 * gave up on it at its connection timeout but left the socket connecting, and Chromium delays every
 * new WebSocket in the extension by how many are still pending: enough of them and each relay
 * connection Porwr makes waits a random 1 to 5 s. These pin the nostr-tools behaviour Porwr relies on.
 */

/** A WebSocket that never opens, recording whether it was closed. */
class SilentWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly created: SilentWebSocket[] = [];

  readyState = SilentWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  readonly close = vi.fn(() => {
    this.readyState = SilentWebSocket.CLOSED;
  });

  constructor(readonly url: string) {
    SilentWebSocket.created.push(this);
  }
}

describe('relay socket cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    SilentWebSocket.created.length = 0;
    useWebSocketImplementation(SilentWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes a socket whose connection attempt timed out', async () => {
    const pool = new SimplePool();
    const onclose = vi.fn();
    pool.subscribeMany(['wss://silent.example'], { kinds: [10050] }, { onclose });

    await vi.advanceTimersByTimeAsync(3_000);

    expect(SilentWebSocket.created).toHaveLength(1);
    expect(SilentWebSocket.created[0]!.close).toHaveBeenCalled();
    expect(onclose).toHaveBeenCalledWith([
      { url: 'wss://silent.example/', reason: 'connection timed out' },
    ]);
  });

  it('closes a socket that is still connecting when the pool is destroyed', async () => {
    const pool = new SimplePool();
    pool.subscribeMany(['wss://silent.example'], { kinds: [10050] }, {});
    await vi.advanceTimersByTimeAsync(0);
    expect(SilentWebSocket.created).toHaveLength(1);

    pool.destroy();

    expect(SilentWebSocket.created[0]!.close).toHaveBeenCalled();
  });
});
