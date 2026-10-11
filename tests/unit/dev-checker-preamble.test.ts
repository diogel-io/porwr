import { describe, it, expect } from 'vitest';

import {
  CHECKER_PREAMBLE_ENTRY,
  externaliseCheckerPreamble,
} from '@/../src-bex/dev-checker-preamble';

/**
 * The checker overlay starts from a module the extension's CSP allows (#249).
 *
 * The fixture is what `vite-plugin-checker` 0.14.5 injects (`composePreambleCode` with base "/"). A
 * version that injects something else leaves `replaced` false, which `quasar.config.ts` reports.
 */

const PREAMBLE = `<script type="module">
import { inject } from "/@vite-plugin-checker-runtime";
inject({
  overlayConfig: {},
  base: "/",
});
</script>`;

const page = (head: string): string =>
  `<!doctype html>\n<html>\n  <head>\n    ${head}\n    <script type="module" src="/@vite/client"></script>\n  </head>\n  <body>\n    <script src="/diogel-load-fallback.js"></script>\n  </body>\n</html>`;

describe('externaliseCheckerPreamble', () => {
  it('replaces the inline preamble with the checker’s own entry module', () => {
    const { html, replaced } = externaliseCheckerPreamble(page(PREAMBLE));

    expect(replaced).toBe(true);
    expect(html).toBe(page(`<script type="module" src="${CHECKER_PREAMBLE_ENTRY}"></script>`));
    expect(html).not.toMatch(/<script type="module">/);
  });

  it('leaves every other script exactly as it was', () => {
    const otherInline = '<script type="module">\nimport "/src/other.ts";\n</script>';
    const { html } = externaliseCheckerPreamble(page(`${PREAMBLE}\n    ${otherInline}`));

    expect(html).toContain(otherInline);
    expect(html).toContain('<script type="module" src="/@vite/client"></script>');
    expect(html).toContain('<script src="/diogel-load-fallback.js"></script>');
  });

  it('returns a page without the preamble unchanged, and says so', () => {
    const input = page('<title>Porwr</title>');

    expect(externaliseCheckerPreamble(input)).toEqual({ html: input, replaced: false });
  });

  it('changes nothing more when run twice', () => {
    const once = externaliseCheckerPreamble(page(PREAMBLE)).html;

    expect(externaliseCheckerPreamble(once)).toEqual({ html: once, replaced: false });
  });
});
