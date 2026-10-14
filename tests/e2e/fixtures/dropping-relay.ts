import { matchFilters } from 'nostr-tools';
import type { Event, Filter } from 'nostr-tools';
import { WebSocketServer } from 'ws';

const GIFT_WRAP_KIND = 1059;

/**
 * A relay that says OK to every event and quietly throws gift wraps away, as relay.damus.io does
 * (#276). Everything else is kept in memory and served, so a kind 10050 published here can still be
 * read. `nak serve` has no way to drop one kind, hence this.
 */
export interface DroppingRelay {
  url: string;
  close(): Promise<void>;
}

export function startDroppingRelay(): Promise<DroppingRelay> {
  return new Promise((resolve, reject) => {
    const events: Event[] = [];
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    server.once('error', reject);

    server.on('connection', (socket) => {
      const send = (message: unknown[]) => socket.send(JSON.stringify(message));
      socket.on('message', (data) => {
        let message: unknown;
        try {
          message = JSON.parse(String(data));
        } catch {
          return;
        }
        if (!Array.isArray(message)) return;

        const [type, ...rest] = message as [string, ...unknown[]];
        if (type === 'EVENT') {
          const event = rest[0] as Event;
          if (event.kind !== GIFT_WRAP_KIND) events.push(event);
          send(['OK', event.id, true, '']);
        } else if (type === 'REQ') {
          const [id, ...filters] = rest as [string, ...Filter[]];
          for (const event of events) {
            if (matchFilters(filters, event)) send(['EVENT', id, event]);
          }
          send(['EOSE', id]);
        }
      });
    });

    server.once('listening', () => {
      const address = server.address();
      if (typeof address !== 'object' || !address) {
        reject(new Error('the dropping relay has no address'));
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
