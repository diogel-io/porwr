import {
  PAGE_PORT_NAME,
  type PageAction,
  type PageReplyMessage,
  type PageRequestMessage,
} from './page-actions';

/**
 * The content script's end of the page channel (#246).
 *
 * Page requests travel over Porwr's own `porwr:page` port rather than the Quasar bridge, because the
 * background reads the requesting site from that port's browser-stamped `sender`, which a bridge
 * handler never sees. The content script opens the port as soon as it loads, as the bridge did:
 * that connection is also how the background learns which site each tab holds, for the panel and
 * for page liveness. It is reopened on the next request after the background worker restarts; a
 * request still waiting when the port drops fails, as it did over the bridge.
 */

type PortLike = Pick<chrome.runtime.Port, 'postMessage' | 'onMessage' | 'onDisconnect'>;

export interface PagePortClient {
  /** Opens the port now if it is not open. Throws if the extension context is gone. */
  connect: () => void;
  send: (action: PageAction, payload: object) => Promise<unknown>;
}

interface Pending {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

const isReply = (message: unknown): message is PageReplyMessage =>
  typeof message === 'object' &&
  message !== null &&
  typeof (message as { id?: unknown }).id === 'string' &&
  ('result' in message || 'error' in message);

export function createPagePortClient(
  connect: (name: string) => PortLike = (name) => chrome.runtime.connect({ name }),
): PagePortClient {
  let port: PortLike | null = null;
  let nextId = 0;
  const pending = new Map<string, Pending>();

  const open = (): PortLike => {
    if (port) return port;

    const opened = connect(PAGE_PORT_NAME);
    opened.onMessage.addListener((message: unknown) => {
      if (!isReply(message)) return;
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      if ('error' in message) waiting.reject(new Error(message.error));
      else waiting.resolve(message.result);
    });
    opened.onDisconnect.addListener(() => {
      if (port === opened) port = null;
      const stranded = [...pending.values()];
      pending.clear();
      for (const waiting of stranded)
        waiting.reject(new Error('Lost connection to Porwr. Please try again.'));
    });

    port = opened;
    return opened;
  };

  return {
    connect: () => {
      open();
    },
    send: (action, payload) =>
      new Promise((resolve, reject) => {
        const id = `${Date.now().toString(36)}-${(nextId += 1)}`;
        try {
          const target = open();
          pending.set(id, { resolve, reject });
          target.postMessage({ id, action, payload } satisfies PageRequestMessage);
        } catch (error: unknown) {
          pending.delete(id);
          port = null;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }),
  };
}
