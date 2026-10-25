import {
  isPageAction,
  PAGE_PORT_NAME,
  type PageAction,
  type PagePayload,
  type PageReplyMessage,
} from '../page-actions';
import { checkPagePayload } from './request-limits';
import { pageOriginOf, type PageSenderLike } from './sender-policy';

/**
 * The background's end of the page channel (#246).
 *
 * A website reaches Porwr through the content script, which runs in the site's own renderer and is
 * untrusted (#240): it could write any origin it liked into a request. So the requesting site is
 * never read from a request. It is taken once per port from `port.sender`, which the browser fills
 * in, and handed to the action's handler alongside a payload with any `origin` or `approved` removed.
 * A port whose sender names no usable site has every request refused.
 */

/** What a page handler knows about the page that asked, beyond its origin. */
export interface PageContext {
  /**
   * Aborted when the page's port disconnects: the tab closed or navigated away. A request waiting
   * on a decision for that page is interrupted, even while another tab holds the same origin
   * (#139).
   */
  signal: AbortSignal;
}

export type PageActionHandlers = {
  [A in PageAction]: (
    payload: PagePayload<A>,
    origin: string,
    page: PageContext,
  ) => Promise<unknown>;
};

export interface PagePortLike {
  name: string;
  sender?: PageSenderLike | undefined;
  postMessage: (message: PageReplyMessage) => void;
  onMessage: { addListener: (listener: (message: unknown) => void) => void };
  onDisconnect: { addListener: (listener: () => void) => void };
}

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Request failed';
};

const PAGE_DECIDES_NOTHING = new Set(['origin', 'approved']);

/** A page payload with anything the page must not decide removed. */
export const stripPagePayload = (payload: unknown): Record<string, unknown> => {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return {};
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => !PAGE_DECIDES_NOTHING.has(key)),
  );
};

export function servePagePort(
  port: PagePortLike,
  handlers: PageActionHandlers,
  extensionId: string,
  extensionOrigin: string,
): void {
  const origin = pageOriginOf(port.sender, extensionId, extensionOrigin);
  let connected = true;
  const gone = new AbortController();

  const reply = (message: PageReplyMessage): void => {
    if (!connected) return;
    try {
      port.postMessage(message);
    } catch {
      // The page went away between the request and the answer; there is no one left to tell.
    }
  };

  port.onDisconnect.addListener(() => {
    connected = false;
    gone.abort();
  });

  port.onMessage.addListener((message: unknown) => {
    if (typeof message !== 'object' || message === null) return;
    const { id, action, payload } = message as {
      id?: unknown;
      action?: unknown;
      payload?: unknown;
    };
    if (typeof id !== 'string') return;

    if (!isPageAction(action)) {
      reply({ id, error: `Unsupported action: ${String(action)}` });
      return;
    }
    if (!origin) {
      reply({ id, error: 'Porwr could not tell which site sent this request.' });
      return;
    }

    // Refused before any handler runs, so an oversized or malformed request is never queued (D18).
    const refusal = checkPagePayload(action, payload);
    if (refusal) {
      reply({ id, error: refusal });
      return;
    }
    const pagePayload = stripPagePayload(payload);

    const handler = handlers[action] as (
      payload: unknown,
      origin: string,
      page: PageContext,
    ) => Promise<unknown>;
    handler(pagePayload, origin, { signal: gone.signal }).then(
      (result) => reply({ id, result }),
      (error: unknown) => reply({ id, error: errorMessage(error) }),
    );
  });
}

/** Serves every `porwr:page` port the browser opens to this background. */
export function observePageRequests(
  handlers: PageActionHandlers,
  extensionId: string,
  extensionOrigin: string,
): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PAGE_PORT_NAME) return;
    servePagePort(port, handlers, extensionId, extensionOrigin);
  });
}
