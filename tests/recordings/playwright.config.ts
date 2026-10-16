import { defineConfig } from '@playwright/test';

/**
 * Recordings, not tests.
 *
 * These specs drive the built extension into each sidebar state and write what it rendered to a
 * file, for the design records in the Diogel workspace. They assert only what they need to reach a
 * state, so they live outside `tests/e2e` and the main config never picks them up.
 *
 * Run with `npm run record:sidebar`. See `README.md` beside this file.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.record.ts',
  // One persistent context and one vault, driven through states in order.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 25_000 },
  reporter: [['list']],
  use: { browserName: 'chromium', trace: 'retain-on-failure', video: 'off' },
});
