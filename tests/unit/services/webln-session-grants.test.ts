import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WebLN allowed "just this once" lasts while the page that asked stays open (porwr#369).
 */

const lockListeners = vi.hoisted(() => [] as Array<() => void>);
vi.mock('@/../src-bex/vault', () => ({
  onVaultLocked: (listener: () => void) => {
    lockListeners.push(listener);
    return () => undefined;
  },
}));

import {
  clearWebLnPageGrants,
  grantWebLnForPage,
  hasWebLnPageGrant,
  revokeWebLnPageGrants,
} from '@/../src-bex/services/webln-session-grants';

const SITE = 'https://jumble.social';

describe('WebLN page grants', () => {
  beforeEach(() => clearWebLnPageGrants());

  it('holds while the page is open and ends when it goes', () => {
    const page = new AbortController();
    grantWebLnForPage(SITE, 'wallet-a', page.signal);
    expect(hasWebLnPageGrant(SITE, 'wallet-a')).toBe(true);

    page.abort();
    expect(hasWebLnPageGrant(SITE, 'wallet-a')).toBe(false);
  });

  it('is for one origin and one wallet connection', () => {
    grantWebLnForPage(SITE, 'wallet-a', new AbortController().signal);

    expect(hasWebLnPageGrant(SITE, 'wallet-b')).toBe(false);
    expect(hasWebLnPageGrant('https://other.example', 'wallet-a')).toBe(false);
  });

  it('lasts until the last page that was allowed it goes', () => {
    const first = new AbortController();
    const second = new AbortController();
    grantWebLnForPage(SITE, 'wallet-a', first.signal);
    grantWebLnForPage(SITE, 'wallet-a', second.signal);

    first.abort();
    expect(hasWebLnPageGrant(SITE, 'wallet-a')).toBe(true);
    second.abort();
    expect(hasWebLnPageGrant(SITE, 'wallet-a')).toBe(false);
  });

  it('grants nothing to a page that has already gone', () => {
    const page = new AbortController();
    page.abort();
    grantWebLnForPage(SITE, 'wallet-a', page.signal);

    expect(hasWebLnPageGrant(SITE, 'wallet-a')).toBe(false);
  });

  it('can be revoked by a newer decision', () => {
    grantWebLnForPage(SITE, 'wallet-a', new AbortController().signal);
    revokeWebLnPageGrants(SITE, 'wallet-a');

    expect(hasWebLnPageGrant(SITE, 'wallet-a')).toBe(false);
  });

  it('ends for every site when the vault locks', () => {
    grantWebLnForPage(SITE, 'wallet-a', new AbortController().signal);
    grantWebLnForPage('https://other.example', 'wallet-b', new AbortController().signal);

    expect(lockListeners).toHaveLength(1);
    lockListeners[0]!();

    expect(hasWebLnPageGrant(SITE, 'wallet-a')).toBe(false);
    expect(hasWebLnPageGrant('https://other.example', 'wallet-b')).toBe(false);
  });
});
