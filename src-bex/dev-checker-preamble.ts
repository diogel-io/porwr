/**
 * Loads `vite-plugin-checker`'s overlay preamble as a module instead of an inline script (#249).
 *
 * In dev the checker's `transformIndexHtml` writes an inline `<script type="module">` into the page
 * that starts its type-check and lint overlay. Extension pages never run inline script, so Chrome
 * blocks it and the overlay never appears. The checker also serves the same preamble as
 * `/@vite-plugin-checker-runtime-entry`, which `script-src 'self'` allows, so the inline script is
 * swapped for that. The CSP is left as it is.
 */
export const CHECKER_PREAMBLE_ENTRY = '/@vite-plugin-checker-runtime-entry';

const INLINE_MODULE = /<script type="module">([\s\S]*?)<\/script>/g;
const IMPORTS_CHECKER_RUNTIME = /from\s+"[^"]*\/@vite-plugin-checker-runtime"/;

/** Returns `html` with the checker's inline preamble replaced, and whether there was one to replace. */
export function externaliseCheckerPreamble(html: string): { html: string; replaced: boolean } {
  let replaced = false;
  const result = html.replace(INLINE_MODULE, (script, body: string) => {
    if (!IMPORTS_CHECKER_RUNTIME.test(body)) return script;
    replaced = true;
    return `<script type="module" src="${CHECKER_PREAMBLE_ENTRY}"></script>`;
  });

  return { html: result, replaced };
}
