import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  chromium,
  test as base,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';

// The package is ESM, so `__dirname` does not exist here.
const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, '../../../dist/bex-chrome');

export interface ExtensionFixtures {
  context: BrowserContext;
  /** The unpacked extension's runtime id, needed to address any of its pages. */
  extensionId: string;
  /** The MV3 background service worker, for asserting state the UI does not show. */
  background: Worker;
  /** Opens any extension route in a fresh page, waiting for the app to settle. */
  openPage: (hash: string) => Promise<Page>;
  /** Opens the panel as an extension page. See the note below on why not the real side panel. */
  openPanel: () => Promise<Page>;
}

export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use) => {
    if (!existsSync(join(DIST, 'manifest.json'))) {
      throw new Error(
        `No built extension at ${DIST}. Run \`npm run build:chrome\` first, or use \`npm run test:e2e\` which builds for you.`,
      );
    }

    // A fresh profile per run: the vault lives in extension storage, so a reused profile would
    // carry a vault between runs and make setup tests pass for the wrong reason.
    const userDataDir = await mkdtemp(join(tmpdir(), 'porwr-e2e-'));

    const context = await chromium.launchPersistentContext(userDataDir, {
      // `channel: 'chromium'` forces the full browser. Playwright's default headless binary is
      // `chrome-headless-shell`, which cannot load extensions at all — the symptom is a context
      // that starts fine and simply never produces a service worker.
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--no-first-run'],
    });

    await use(context);

    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  },

  background: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },

  extensionId: async ({ background }, use) => {
    await use(new URL(background.url()).host);
  },

  openPage: async ({ context, extensionId }, use) => {
    await use(async (hash: string) => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/www/index.html#${hash}`);
      // The first navigation of a run is the slowest thing the suite does: the service worker is
      // cold and App.vue waits on the background bridge for up to 10s before routing anywhere.
      // Navigating again before it settles leaves the app mid-decision, which is the single
      // biggest source of flakiness here.
      await page
        .locator('.sidebar-root, .vault-card')
        .first()
        .waitFor({ state: 'visible', timeout: 45_000 });
      return page;
    });
  },

  openPanel: async ({ context, extensionId }, use) => {
    /**
     * The panel is opened as an extension page rather than through the real side panel.
     *
     * Neither `chrome.sidePanel.open()` nor Firefox's equivalent may be called outside a user
     * gesture, and no automation API drives the browser chrome that provides one. The panel is the
     * same page either way — the same route, layout and components — and this is how the panel is
     * run during development (#142), which is why panel presence is detected by port name alone
     * rather than by the absence of a tab (#113).
     *
     * What this cannot cover is the browser-owned surface itself: that the manifest wires
     * `side_panel`/`sidebar_action`, and that the toolbar reveals it. The manifest half is asserted
     * in the unit suite; the toolbar half is manual.
     */
    await use(async () => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/www/index.html#/sidebar`);
      return page;
    });
  },
});

export const expect = test.expect;
