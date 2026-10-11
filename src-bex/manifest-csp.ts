/**
 * Script sources the dev build adds to the extension pages' CSP (#247).
 *
 * `quasar dev` for Chrome serves the extension pages' scripts from the Vite dev server on
 * `localhost`, so the dev manifest has to allow it. A released build must not: any local process
 * could then serve script into the pages that hold the vault. `src-bex/manifest.json` therefore
 * allows only `'self'`, and `quasar.config.ts` adds these back for dev builds alone.
 */
export const DEV_SCRIPT_SOURCES = ['http://localhost:*', 'http://127.0.0.1:*'] as const;

/** Returns `csp` with the dev server's sources added to `script-src`, leaving every other directive alone. */
export function withDevScriptSources(csp: string): string {
  const directives = csp
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => directive !== '')
    .map((directive) => {
      const [name, ...sources] = directive.split(/\s+/);
      if (name !== 'script-src') return directive;
      const missing = DEV_SCRIPT_SOURCES.filter((source) => !sources.includes(source));
      return [name, ...sources, ...missing].join(' ');
    });

  return `${directives.join('; ')};`;
}
