import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import { DEV_SCRIPT_SOURCES, withDevScriptSources } from '@/../src-bex/manifest-csp';

/**
 * Local script sources belong to the dev build alone (#247).
 *
 * `quasar dev` serves the extension pages' scripts from `localhost`. A released build that allowed
 * the same would load script from any process on the user's machine into the pages that hold the
 * vault, so the source manifest allows `'self'` only and `quasar.config.ts` adds the local sources
 * back for dev builds.
 */

const ROOT = resolve(__dirname, '../..');
const LOCAL_SOURCE = /localhost|127\.0\.0\.1/;

describe('the source manifest CSP', () => {
  const source = readFileSync(resolve(ROOT, 'src-bex/manifest.json'), 'utf8');
  const manifest = JSON.parse(source) as {
    all: { content_security_policy: { extension_pages: string } };
  };

  it('names no local source anywhere, so no released build can allow one', () => {
    expect(source).not.toMatch(LOCAL_SOURCE);
  });

  it('allows scripts from the extension itself and nothing else, WebAssembly included', () => {
    // zip.js, the one dependency that ships WebAssembly, exports backups without it; the export e2e
    // fails on any CSP violation, so a dependency that starts needing it is caught there.
    expect(manifest.all.content_security_policy.extension_pages).toBe(
      "script-src 'self'; object-src 'self';",
    );
  });
});

describe('withDevScriptSources', () => {
  const CSP = "script-src 'self'; object-src 'self';";

  it('adds both dev server sources to script-src', () => {
    expect(withDevScriptSources(CSP)).toBe(
      "script-src 'self' http://localhost:* http://127.0.0.1:*; object-src 'self';",
    );
  });

  it('leaves the other directives alone', () => {
    expect(withDevScriptSources(CSP)).toContain("object-src 'self';");
    expect(withDevScriptSources(CSP).match(/object-src[^;]*/)?.[0]).not.toMatch(LOCAL_SOURCE);
  });

  it('is idempotent', () => {
    const once = withDevScriptSources(CSP);
    expect(withDevScriptSources(once)).toBe(once);
  });

  it('adds only the sources still missing', () => {
    const result = withDevScriptSources("script-src 'self' http://localhost:*; object-src 'self'");
    for (const source of DEV_SCRIPT_SOURCES) {
      expect(result.split(source)).toHaveLength(2);
    }
  });
});
