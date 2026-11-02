import { WebSocketServer } from 'ws';

/**
 * A relay that accepts every connection and never answers anything sent to it (#424).
 *
 * nostr-tools ends a subscription on such a relay as if it had sent EOSE, so it would look like a
 * relay that has nothing for the account. `nak serve` always answers, hence this.
 */
export interface SilentRelay {
  url: string;
  close(): Promise<void>;
}

export function startSilentRelay(): Promise<SilentRelay> {
  return new Promise((resolve, reject) => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      if (typeof address !== 'object' || !address) {
        reject(new Error('the silent relay has no address'));
        return;
      }
      resolve({
        url: `ws://localhost:${address.port}`,
        close: () =>
          new Promise((done) => {
            // A server only closes once its connections have, and the extension keeps them open.
            for (const client of server.clients) client.terminate();
            server.close(() => done());
          }),
      });
    });
  });
}
