/**
 * Who sent a runtime message or opened a port, as far as the background can tell (#240).
 *
 * A message's payload is whatever the sender wrote, so it proves nothing. `chrome.runtime.MessageSender`
 * is filled in by the browser, and is what this decides on:
 *
 * - `extension-page`: one of Porwr's own pages — the panel, the dashboard, the popup — including
 *   a dashboard page opened in a tab. Decided by the sender's URL, not by the absence of
 *   `sender.tab`, because dashboard pages do have a tab.
 * - `content-script`: Porwr's content script, running inside a website's renderer. Chromium treats
 *   such messages as untrusted: a compromised renderer can send anything a content script can.
 * - `foreign`: anything else, or anything the browser did not describe well enough to tell.
 *
 * Works for both `chrome-extension://` and `moz-extension://`. Origins are built as `scheme://host`
 * rather than read from `URL.origin`, which is the opaque string `"null"` for these schemes in some
 * engines (Node among them): comparing two `"null"`s would make every such URL look like Porwr.
 */

export type SenderClass = 'extension-page' | 'content-script' | 'foreign';

export interface SenderLike {
  id?: string | undefined;
  url?: string | undefined;
}

export const classifySender = (
  sender: SenderLike | undefined,
  extensionId: string,
  extensionOrigin: string,
): SenderClass => {
  if (!sender || !extensionId || sender.id !== extensionId) return 'foreign';
  if (typeof sender.url !== 'string' || sender.url.length === 0) return 'foreign';

  const origin = originOf(sender.url);
  if (!origin || !extensionOrigin) return 'foreign';

  return origin === extensionOrigin ? 'extension-page' : 'content-script';
};

/**
 * `scheme://host` for a URL, e.g. `chrome-extension://<id>` or `https://example.com`, or `''` when it
 * does not parse or has no host (`data:`, `about:blank`, `chrome-extension:///x`).
 */
export const originOf = (url: string): string => {
  try {
    const parsed = new URL(url);
    return parsed.host ? `${parsed.protocol}//${parsed.host}` : '';
  } catch {
    return '';
  }
};

export interface PageSenderLike extends SenderLike {
  origin?: string | undefined;
}

/**
 * The site a page request came from, as the browser reports it (#246), or `''` when it cannot say.
 *
 * Taken from the sender of the content script's port: `sender.origin` where the browser provides it
 * (Chromium), else the origin of `sender.url` when it gives none (Firefox). Both describe the frame
 * that opened the port, never the tab around it, so a frame is only ever attributed to itself. Only
 * `http:` and `https:` sites qualify; an extension page, a foreign sender, an opaque origin or any
 * other scheme gives `''`, and the request is refused.
 */
export const pageOriginOf = (
  sender: PageSenderLike | undefined,
  extensionId: string,
  extensionOrigin: string,
): string => {
  if (classifySender(sender, extensionId, extensionOrigin) !== 'content-script') return '';

  // An opaque origin (`'null'`, e.g. a sandboxed frame) is refused, not replaced by the url: the
  // frame is deliberately not that site, and must not get its permissions.
  const reported = sender?.origin;
  const origin = reported === undefined ? originOf(sender?.url ?? '') : originOf(reported);
  return origin.startsWith('http://') || origin.startsWith('https://') ? origin : '';
};
