import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'], // Add setup file
    include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}', 'src/**/*.spec.{ts,js}', 'src-bex/**/*.spec.{ts,js}'],
    // The end-to-end specs are Playwright's, not vitest's. They load a real browser and would fail
    // here with a confusing "test.describe is not a function" if vitest picked them up (#141).
    exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      /**
       * Measure every source file, not only the ones a test happens to import.
       *
       * Without this, 35 of 157 source files — 5,935 lines including `src-bex/background.ts` and
       * `App.vue` — were absent from the denominator rather than counted as uncovered. That
       * flatters the figure and inverts the incentive: removing the last test that imports a file
       * makes coverage go up (#143).
       */
      include: ['src/**/*.{ts,vue}', 'src-bex/**/*.ts'],
      exclude: [
        'node_modules/',
        'tests/',
        // Declaration files. `error-codes.d.ts` and `bridge.ts` carry lookup tables that are data,
        // not logic; counting them makes the number less honest rather than more (#143).
        '**/*.d.ts',
        // Message catalogues are data. 600-plus lines of translation strings would swamp the
        // figure without saying anything about whether the code is tested.
        'src/i18n/**',
        // Quasar boot files are framework wiring the app cannot run without; there is no branch
        // in them to get wrong.
        'src/boot/**',
      ],
      /**
       * A ratchet, not an achievement (#143).
       *
       * Each global figure sits just below where coverage actually stands, so a real regression
       * fails and ordinary noise does not. They are raised as coverage rises and never lowered: if a
       * change cannot meet the current floor, the answer is a test, not a smaller number.
       *
       * These are far lower than the figures quoted before `include` was set, and the earlier ones
       * were wrong rather than these being a retreat: 35 of 157 source files were absent from the
       * denominator, so the report described only the files a test happened to import.
       *
       * Branches are the lowest and matter most here. In a signing extension the untested branch is
       * the one that fails open, and closing that gap is test-writing work rather than a threshold
       * decision — see the follow-up on #143.
       *
       * Raised 2026-08-21 after #173 extracted the approval flow, the routing decision and the
       * page reconciliation out of `background.ts`, where nothing could reach them, and then
       * covered the dispatcher's switch by execution rather than by source scan.
       *
       * Measured at 1,001 tests: statements 62.56, branches 54.44, functions 53.35, lines 62.84.
       */
      thresholds: {
        statements: 62,
        branches: 54,
        functions: 53,
        lines: 62,

        /**
         * The layers that decide authority are already past the 75% target, so they are held there
         * by directory. Without this the global floor would let them slide while the component
         * layer pulls the average around.
         */
        'src/services/**': { statements: 80, branches: 70, functions: 85, lines: 80 },
        'src/composables/**': { statements: 85, branches: 70, functions: 80, lines: 85 },
        'src/utils/**': { statements: 95, branches: 80, functions: 95, lines: 95 },
        'src-bex/handlers/**': { statements: 80, branches: 58, functions: 88, lines: 82 },
        'src-bex/services/**': { statements: 86, branches: 73, functions: 81, lines: 87 },

        /**
         * `src-bex` itself is the routing layer: `dispatcher.ts` plus the modules pulled out of
         * `background.ts`. It sat at 41% while nothing executed the switch, and the floor is held
         * here so it cannot drift back once a case stops being exercised.
         *
         * `background.ts` remains excluded from measurement by the provider — it registers
         * listeners and calls `initialize()` on import, so no test can load it. That is why the
         * logic worth covering was moved out rather than mocked in place (#173).
         */
        'src-bex/*.ts': { statements: 70, branches: 57, functions: 75, lines: 71 },
      },
    },
  },
  resolve: {
    alias: {
      // Quasar supplies `@` (-> src/) at build time; extension code is reached as `@/../src-bex/`.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
