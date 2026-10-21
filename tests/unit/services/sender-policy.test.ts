import { describe, it, expect } from 'vitest';

import { normalizeOrigin } from '@/../src-bex/services/origin';
import { classifySender, originOf, pageOriginOf } from '@/../src-bex/services/sender-policy';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const CHROME = `chrome-extension://${ID}`;
const MOZ_ID = 'f2b1c9d0-1111-2222-3333-444455556666';
const MOZ = `moz-extension://${MOZ_ID}`;

describe('classifySender (#240)', () => {
  it('recognises one of Porwr’s own pages on Chrome', () => {
    expect(classifySender({ id: ID, url: `${CHROME}/www/index.html#/sidebar` }, ID, CHROME)).toBe(
      'extension-page',
    );
  });

  it('recognises one of Porwr’s own pages on Firefox', () => {
    // Firefox's sender.id is the add-on id, while the page origin uses an internal UUID.
    expect(
      classifySender({ id: '@diogel', url: `${MOZ}/www/index.html#/dashboard` }, '@diogel', MOZ),
    ).toBe('extension-page');
  });

  it('still recognises a dashboard page opened in a tab, which has sender.tab', () => {
    const sender = { id: ID, url: `${CHROME}/www/index.html#/messages`, tab: { id: 7 } };
    expect(classifySender(sender, ID, CHROME)).toBe('extension-page');
  });

  it('treats Porwr’s content script, running in a website, as a content script', () => {
    const sender = { id: ID, url: 'https://example.com/page', tab: { id: 3 } };
    expect(classifySender(sender, ID, CHROME)).toBe('content-script');
  });

  it('does not let a website pose as Porwr by putting the extension url in its path', () => {
    expect(
      classifySender({ id: ID, url: `https://evil.example/${CHROME}/www/index.html` }, ID, CHROME),
    ).toBe('content-script');
  });

  it('treats another extension as foreign, even on an extension url', () => {
    expect(
      classifySender(
        { id: 'someone-else', url: 'chrome-extension://someone-else/x.html' },
        ID,
        CHROME,
      ),
    ).toBe('foreign');
    expect(
      classifySender({ id: 'someone-else', url: `${CHROME}/www/index.html` }, ID, CHROME),
    ).toBe('foreign');
  });

  it('treats a sender it cannot describe as foreign', () => {
    expect(classifySender(undefined, ID, CHROME)).toBe('foreign');
    expect(classifySender({ id: ID }, ID, CHROME)).toBe('foreign');
    expect(classifySender({ id: ID, url: '' }, ID, CHROME)).toBe('foreign');
    expect(classifySender({ id: ID, url: 'not a url' }, ID, CHROME)).toBe('foreign');
    expect(classifySender({ id: ID, url: `${CHROME}/x` }, '', CHROME)).toBe('foreign');
  });
});

describe('originOf', () => {
  it('reduces an extension url to its origin', () => {
    expect(originOf(`${CHROME}/`)).toBe(CHROME);
    expect(originOf(`${MOZ}/www/index.html`)).toBe(MOZ);
    expect(originOf('https://example.com/a?b')).toBe('https://example.com');
  });

  it('has no origin for a url without a host, so two of them never look alike', () => {
    expect(originOf('data:text/html,hi')).toBe('');
    expect(originOf('about:blank')).toBe('');
    expect(originOf('chrome-extension:///x')).toBe('');
    expect(originOf('not a url')).toBe('');
  });

  it('never matches a host-less page to an extension whose own origin could not be read', () => {
    // If the extension's origin failed to resolve, nothing may be treated as one of its pages.
    expect(classifySender({ id: ID, url: 'data:text/html,hi' }, ID, '')).toBe('foreign');
    expect(classifySender({ id: ID, url: `${CHROME}/x` }, ID, '')).toBe('foreign');
  });
});

describe('pageOriginOf (#246)', () => {
  const site = (sender: object): string => pageOriginOf({ id: ID, ...sender }, ID, CHROME);

  it('takes the origin the browser stamped on the sender (Chromium)', () => {
    expect(site({ url: 'https://example.com/page?x=1', origin: 'https://example.com' })).toBe(
      'https://example.com',
    );
  });

  it('falls back to the sender url when the browser gives no origin (Firefox)', () => {
    expect(site({ url: 'https://example.com:8443/a/b' })).toBe('https://example.com:8443');
  });

  it('attributes a cross-origin iframe to the iframe, not the page around it', () => {
    const sender = {
      url: 'https://widget.example/embed',
      origin: 'https://widget.example',
      frameId: 2,
      tab: { id: 3, url: 'https://news.example/' },
    };
    expect(site(sender)).toBe('https://widget.example');
  });

  it('refuses one of Porwr’s own pages, which is not a website', () => {
    expect(site({ url: `${CHROME}/www/index.html#/sidebar`, origin: CHROME })).toBe('');
  });

  it('refuses another extension and an unknown sender', () => {
    expect(pageOriginOf({ id: 'someone-else', url: 'https://example.com/' }, ID, CHROME)).toBe('');
    expect(pageOriginOf(undefined, ID, CHROME)).toBe('');
  });

  it('refuses a page that is not an http(s) site', () => {
    expect(site({ url: 'file:///home/user/page.html' })).toBe('');
    expect(site({ url: 'data:text/html,hi' })).toBe('');
    expect(site({ url: 'ftp://files.example/x' })).toBe('');
  });

  it('refuses an opaque origin rather than guessing from the url', () => {
    expect(site({ url: 'https://example.com/sandboxed', origin: 'null' })).toBe('');
    expect(site({ url: 'about:blank', origin: 'null' })).toBe('');
  });
});

// A look-alike host written in another script must reach the approval as punycode, so `аpple.com`
// with a Cyrillic "а" reads as `xn--pple-43d.com` and not as `apple.com` (threat model T1, #144).
describe('internationalised origins', () => {
  const site = (sender: object): string => pageOriginOf({ id: ID, ...sender }, ID, CHROME);

  it('keeps the punycode origin the browser stamps on the sender (Chromium)', () => {
    expect(
      site({ url: 'https://xn--pple-43d.com/login', origin: 'https://xn--pple-43d.com' }),
    ).toBe('https://xn--pple-43d.com');
  });

  it('converts a Unicode host to punycode when it falls back to the sender url (Firefox)', () => {
    expect(site({ url: 'https://\u0430pple.com/login' })).toBe('https://xn--pple-43d.com');
    expect(site({ url: 'https://b\u00fccher.example/' })).toBe('https://xn--bcher-kva.example');
  });

  it('normalises a Unicode origin to punycode before it is stored or compared', () => {
    expect(normalizeOrigin('https://\u0430pple.com')).toBe('https://xn--pple-43d.com');
  });
});
