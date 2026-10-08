import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/storage-service', () => ({
  storageService: { get: vi.fn(), set: vi.fn() },
  SITE_BINDINGS_KEY: 'nostr:site-bindings',
}));

vi.mock('@/services/log-service', () => ({
  LogLevel: { INFO: 'info' },
  logService: { log: vi.fn() },
}));

import { storageService } from '@/services/storage-service';
import {
  bindOriginIfUnbound,
  clearSiteBindingCache,
  getBinding,
  listBindings,
  removeBinding,
} from '@/../src-bex/services/site-binding-store';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

let stored: unknown = [];

beforeEach(() => {
  vi.clearAllMocks();
  clearSiteBindingCache();
  stored = [];
  vi.mocked(storageService).get.mockImplementation(() => Promise.resolve(stored));
  vi.mocked(storageService).set.mockImplementation((_key, value) => {
    stored = value;
    return Promise.resolve();
  });
});

describe('site bindings', () => {
  describe('establishing one', () => {
    it('binds an unbound origin', async () => {
      const binding = await bindOriginIfUnbound('https://example.com', ALICE);

      expect(binding?.pubkey).toBe(ALICE);
      expect((await getBinding('https://example.com'))?.pubkey).toBe(ALICE);
    });

    it('never moves an existing binding', async () => {
      await bindOriginIfUnbound('https://example.com', ALICE);

      // The whole point: a second account cannot take over a site that is already bound.
      const binding = await bindOriginIfUnbound('https://example.com', BOB);

      expect(binding?.pubkey).toBe(ALICE);
      expect((await getBinding('https://example.com'))?.pubkey).toBe(ALICE);
    });

    it('binds each origin independently', async () => {
      await bindOriginIfUnbound('https://one.example', ALICE);
      await bindOriginIfUnbound('https://two.example', BOB);

      expect((await getBinding('https://one.example'))?.pubkey).toBe(ALICE);
      expect((await getBinding('https://two.example'))?.pubkey).toBe(BOB);
    });
  });

  describe('what counts as the same site', () => {
    it('matches regardless of path, case or trailing slash', async () => {
      await bindOriginIfUnbound('https://Example.com/some/path', ALICE);

      expect((await getBinding('https://example.com'))?.pubkey).toBe(ALICE);
      expect((await getBinding('https://example.com/other'))?.pubkey).toBe(ALICE);
    });

    it('treats a different scheme, host or port as a different site', async () => {
      await bindOriginIfUnbound('https://example.com', ALICE);

      expect(await getBinding('http://example.com')).toBeNull();
      expect(await getBinding('https://sub.example.com')).toBeNull();
      expect(await getBinding('https://example.com:8443')).toBeNull();
    });

    it('refuses to bind anything that is not a web origin', async () => {
      // A non-web context must never inherit a site's authority.
      expect(await bindOriginIfUnbound('moz-extension://abc', ALICE)).toBeNull();
      expect(await bindOriginIfUnbound('file:///tmp/page.html', ALICE)).toBeNull();
      expect(await bindOriginIfUnbound('', ALICE)).toBeNull();
      expect(await listBindings()).toEqual([]);
    });

    it('refuses to bind without a public key', async () => {
      expect(await bindOriginIfUnbound('https://example.com', '')).toBeNull();
      expect(await listBindings()).toEqual([]);
    });
  });

  describe('removing one', () => {
    it('lets the site bind afresh afterwards', async () => {
      await bindOriginIfUnbound('https://example.com', ALICE);
      await removeBinding('https://example.com');

      expect(await getBinding('https://example.com')).toBeNull();

      await bindOriginIfUnbound('https://example.com', BOB);
      expect((await getBinding('https://example.com'))?.pubkey).toBe(BOB);
    });

    it('leaves other origins alone', async () => {
      await bindOriginIfUnbound('https://one.example', ALICE);
      await bindOriginIfUnbound('https://two.example', BOB);

      await removeBinding('https://one.example');

      expect((await getBinding('https://two.example'))?.pubkey).toBe(BOB);
    });
  });

  describe('trusting storage', () => {
    it('discards records that are not bindings rather than propagating them', async () => {
      // This store decides which key signs for a site, so a malformed record must not survive.
      stored = [{ origin: 'https://example.com' }, 'nonsense', null, { pubkey: ALICE }];

      expect(await listBindings()).toEqual([]);
    });

    it('survives storage holding something that is not a list', async () => {
      stored = 'not-an-array';

      expect(await listBindings()).toEqual([]);
      expect(await getBinding('https://example.com')).toBeNull();
    });
  });
});
