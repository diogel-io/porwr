/**
 * Importing the file below initializes the content script.
 *
 * Warning:
 *   Do not remove the import statement below. It is required for the extension to work.
 *   If you don't need createBridge(), leave it as "import '#q-app/bex/content'".
 *
 * Page requests no longer use the Quasar bridge: they travel over Porwr's own port, so the background
 * can read the requesting site from the browser rather than from this script (#246). The import
 * stays for dev hot reload, which opens its own port.
 */
import '#q-app/bex/content';
import { createPagePortClient } from './page-port-client';
import { handleDiogelWindowMessage } from './window-message-handler';

const channel = createPagePortClient();

type LogContext = Record<string, unknown>;

const warn = (message: string, context?: LogContext): void => {
  console.warn(message, context);
};

const error = (message: string, context?: LogContext): void => {
  console.error(message, context);
};

const injectProvider = () => {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('nostr-provider.js');
  script.onerror = (event) => {
    error('[BEX] Failed to load provider script', {
      event: typeof event === 'string' ? event : undefined,
    });
  };
  const container = document.head || document.documentElement;
  if (container) {
    container.appendChild(script);
    script.onload = () => {
      script.remove();
    };
  } else {
    error('[BEX] Could not find container to inject script');
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    injectProvider();
  });
} else {
  injectProvider();
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  void handleDiogelWindowMessage(event, {
    channel,
    postMessage: (message, targetOrigin) => window.postMessage(message, targetOrigin),
    warn,
    error,
  });
});

try {
  channel.connect();
} catch (connectError: unknown) {
  error('[BEX] Failed to connect to background', {
    error: connectError instanceof Error ? connectError.message : String(connectError),
  });
}
