import { MESSAGE_TYPE_PING, MESSAGE_TYPE_REQUEST } from './constants';
import { normalizeErrorMessage } from './error-normalizer';
import { isPageMethod, PAGE_METHOD_TO_ACTION } from './page-actions';
import type { PagePortClient } from './page-port-client';
import {
  getCurrentWindowOrigin,
  isDiogelWindowMessage,
  isSameWindowOrigin,
} from './window-message-security';

type LogContext = Record<string, unknown>;

export interface WindowMessageHandlerDependencies {
  channel: PagePortClient;
  postMessage: (message: unknown, targetOrigin: string) => void;
  warn?: (message: string, context?: LogContext) => void;
  error?: (message: string, context?: LogContext) => void;
}

export async function handleDiogelWindowMessage(
  event: MessageEvent<unknown>,
  dependencies: WindowMessageHandlerDependencies,
): Promise<void> {
  const message = event.data;
  const validMessageTypes = new Set([MESSAGE_TYPE_REQUEST, MESSAGE_TYPE_PING]);

  if (
    event.source !== window ||
    !isSameWindowOrigin(event) ||
    !isDiogelWindowMessage(message) ||
    !validMessageTypes.has(message.type)
  ) {
    return;
  }

  const targetOrigin = getCurrentWindowOrigin();

  if (message.type === MESSAGE_TYPE_PING) {
    dependencies.postMessage({ id: message.id, response: true, result: 'pong' }, targetOrigin);
    return;
  }

  const { id, method, payload } = message;
  if (method === 'ping') {
    dependencies.postMessage({ id, response: true, result: 'pong' }, targetOrigin);
    return;
  }

  if (!isPageMethod(method)) {
    dependencies.warn?.('[BEX] Rejected disallowed window.nostr method', { method });
    dependencies.postMessage(
      {
        id,
        response: true,
        error: `Unsupported method: ${method}`,
      },
      targetOrigin,
    );
    return;
  }

  try {
    // No origin is sent: the background takes the requesting site from the port's browser-supplied
    // sender, never from anything this script, which runs in the site's renderer, could write (#246).
    const result = await dependencies.channel.send(PAGE_METHOD_TO_ACTION[method], payload ?? {});
    dependencies.postMessage(
      {
        id,
        response: true,
        result,
      },
      targetOrigin,
    );
  } catch (channelError: unknown) {
    const errorMessage = normalizeErrorMessage(channelError);
    dependencies.error?.('[BEX] Content script received error from background', {
      id,
      error: errorMessage,
    });
    dependencies.postMessage(
      {
        id,
        response: true,
        error: errorMessage,
      },
      targetOrigin,
    );
  }
}
