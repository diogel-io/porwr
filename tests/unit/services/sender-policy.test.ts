import { describe, it, expect } from 'vitest';

import { classifySender, originOf } from '@/../src-bex/services/sender-policy';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const CHROME = `chrome-extension://${ID}`;
const MOZ_ID = 'f2b1c9d0-1111-2222-3333-444455556666';
const MOZ = `moz-extension://${MOZ_ID}`;

describe('classifySender (#240)', () => {
  it('recognises one of Porwr’s own pages on Chrome', () => {
    expect(classifySender({ id: ID, url: `${CHROME}/www/index.html#/sidebar` }, ID, CHROME)).toBe('extension-page');
  });

  it('recognises one of Porwr’s own pages on Firefox', () => {
    // Firefox's sender.id is the add-on id, while the page origin uses an internal UUID.
    expect(classifySender({ id: '@diogel', url: `${MOZ}/www/index.html#/dashboard` }, '@diogel', MOZ)).toBe(
      'extension-page',
    );
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
    expect(classifySender({ id: ID, url: `https://evil.example/${CHROME}/www/index.html` }, ID, CHROME)).toBe(
      'content-script',
    );
  });

  it('treats another extension as foreign, even on an extension url', () => {
    expect(classifySender({ id: 'someone-else', url: 'chrome-extension://someone-else/x.html' }, ID, CHROME)).toBe(
      'foreign',
    );
    expect(classifySender({ id: 'someone-else', url: `${CHROME}/www/index.html` }, ID, CHROME)).toBe('foreign');
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
