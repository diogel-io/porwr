import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import { DEV_SCRIPT_SOURCES, withDevSources } from '@/../src-bex/manifest-csp';

/**
 * The extension pages' content security policy.
 *
 * Local script sources belong to the dev build alone (#247). `quasar dev` serves the extension
 * pages' scripts from `localhost`. A released build that allowed the same would load script from
 * any process on the user's machine into the pages that hold the vault, so the source manifest
 * allows `'self'` only and `quasar.config.ts` adds the local sources back for dev builds.
 *
 * `connect-src` and `img-src` keep relays on `wss:` (plaintext `ws:` to a loopback host only),
 * HTTP on `https:`, and remote images on `https:` (diogel-io/workspace#142, T19, T32).
 */

const ROOT = resolve(__dirname, '../..');
const LOCAL_SOURCE = /localhost|127\.0\.0\.1/;

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name!, sources]),
  );
}

describe('the source manifest CSP', () => {
  const source = readFileSync(resolve(ROOT, 'src-bex/manifest.json'), 'utf8');
  const manifest = JSON.parse(source) as {
    all: { content_security_policy: { extension_pages: string } };
  };
  const csp = directives(manifest.all.content_security_policy.extension_pages);

  it('allows scripts from the extension itself and nothing else, WebAssembly included', () => {
    // No dependency needs WebAssembly; the key export e2e (NIP-49 scrypt, #141) fails on any CSP
    // violation, so a dependency that starts needing it is caught there.
    expect(csp.get('script-src')).toEqual(["'self'"]);
    expect(csp.get('object-src')).toEqual(["'self'"]);
  });

  it('names a local source only as a plaintext ws:// relay in connect-src', () => {
    for (const [name, sources] of csp) {
      for (const value of sources.filter((item) => LOCAL_SOURCE.test(item))) {
        expect([name, value]).toEqual(['connect-src', expect.stringMatching(/^ws:\/\//)]);
      }
    }
  });

  it('connects over https: and wss:, and over ws: to a loopback host only', () => {
    expect(csp.get('connect-src')).toEqual([
      "'self'",
      'https:',
      'wss:',
      'ws://localhost:*',
      'ws://127.0.0.1:*',
    ]);
  });

  it('loads images from the extension, data and blob URLs, and https: only', () => {
    expect(csp.get('img-src')).toEqual(["'self'", 'data:', 'blob:', 'https:']);
  });

  it('allows no plaintext scheme, http: or a bare ws:, anywhere', () => {
    for (const sources of csp.values()) {
      expect(sources).not.toContain('http:');
      expect(sources).not.toContain('ws:');
      expect(sources).not.toContain('*');
    }
  });
});

describe('withDevSources', () => {
  const CSP =
    "script-src 'self'; object-src 'self'; connect-src 'self' https: wss:; img-src 'self' https:;";

  it('adds both dev server sources to script-src, connect-src and img-src', () => {
    const result = directives(withDevSources(CSP));
    for (const name of ['script-src', 'connect-src', 'img-src']) {
      for (const source of DEV_SCRIPT_SOURCES) {
        expect(result.get(name)).toContain(source);
      }
    }
  });

  it('leaves the other directives alone', () => {
    expect(withDevSources(CSP).match(/object-src[^;]*/)?.[0]).toBe("object-src 'self'");
  });

  it('is idempotent', () => {
    const once = withDevSources(CSP);
    expect(withDevSources(once)).toBe(once);
  });

  it('adds only the sources still missing', () => {
    const result = withDevSources("script-src 'self' http://localhost:*; object-src 'self'");
    for (const source of DEV_SCRIPT_SOURCES) {
      expect(result.split(source)).toHaveLength(2);
    }
  });
});
