/**
 * The extension pages' content security policy, and what the dev build adds to it.
 *
 * `src-bex/manifest.json` holds the released policy:
 *
 * - `script-src 'self'`: `quasar dev` for Chrome serves the extension pages' scripts from the Vite
 *   dev server on `localhost`, so the dev manifest has to allow it (#247). A released build must
 *   not: any local process could then serve script into the pages that hold the vault.
 * - `connect-src 'self' https: wss: ws://localhost:* ws://127.0.0.1:* http://localhost:*
 *   http://127.0.0.1:*`: relays over `wss:`, and plaintext `ws:` only to a loopback host, which is
 *   the rule `isAllowedRelayProtocol` applies in code (diogel-io/workspace#142, T19). HTTP requests
 *   go over `https:`, or plain `http:` to the same loopback hosts, which is how NIP-11 reaches a
 *   loopback relay. Nothing plaintext leaves the device. The policy covers the
 *   Chrome service worker and the Firefox background page as well as the pages, so the browser
 *   enforces the transport rule wherever a connection is opened. CSP cannot name an IPv6 address,
 *   so `[::1]` is not a loopback relay host.
 * - `img-src 'self' data: blob: https:`: remote profile images and banners load over `https:` only
 *   (T32).
 *
 * `quasar.config.ts` adds the dev server's sources for dev builds alone.
 */
export const DEV_SCRIPT_SOURCES = ['http://localhost:*', 'http://127.0.0.1:*'] as const;

/** What the dev build adds to each directive. HMR and module requests go to the Vite dev server. */
const DEV_SOURCES: Readonly<Record<string, readonly string[]>> = {
  'script-src': DEV_SCRIPT_SOURCES,
  'connect-src': DEV_SCRIPT_SOURCES,
  'img-src': DEV_SCRIPT_SOURCES,
};

/** Returns `csp` with the dev server's sources added to the directives that need them. */
export function withDevSources(csp: string): string {
  const directives = csp
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => directive !== '')
    .map((directive) => {
      const [name, ...sources] = directive.split(/\s+/);
      const additions = name ? DEV_SOURCES[name] : undefined;
      if (!additions) return directive;
      const missing = additions.filter((source) => !sources.includes(source));
      return [name, ...sources, ...missing].join(' ');
    });

  return `${directives.join('; ')};`;
}
