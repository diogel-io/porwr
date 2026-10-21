import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/extension';
import { createVault, requestSignatureFromPage, seedAccount } from './fixtures/vault';

/**
 * The approval panel contacts nobody while it shows a request (D13, threat model T7, #144).
 *
 * A remote fetch made to present a request tells a third party which site the user is signing
 * for, and when. The panel used to load a favicon (F3) and its stylesheet loaded a web font from
 * Google; both are gone, and this keeps it that way.
 *
 * Requests are watched across the whole browser context, so one made by the background on the
 * panel's behalf is seen as well as one made by the panel. The site's own page is left out: its
 * traffic is the site's business. Two rules follow. The panel loads nothing from outside the
 * extension. And nothing else Porwr does while the request is shown, including the service
 * worker, names the requesting site. The worker may still talk to relays it already uses; WebSocket
 * traffic is not visible here.
 *
 * Firefox runs through WebDriver, which cannot observe requests, so the static guard in
 * `tests/unit/no-remote-resources.test.ts` covers both builds' source.
 */

const LOCAL = /^(chrome-extension|data|blob):/;

test('the panel loads nothing from outside the extension while a request is shown', async ({
  openPage,
  context,
  extensionId,
}) => {
  const setup = await openPage('/login');
  await createVault(setup);
  await seedAccount(setup);

  const site = await context.newPage();
  await site.goto('https://example.com');
  const SITE_HOST = new URL(site.url()).host;

  // Watching starts before the site asks, so a lookup the worker made on receiving the request
  // is seen too.
  let panel: Page | undefined;
  const fromPanel: string[] = [];
  const fromPorwr: string[] = [];
  context.on('request', (request) => {
    let page: Page | null = null;
    try {
      page = request.serviceWorker() ? null : request.frame().page();
    } catch {
      page = null; // A worker request has no frame.
    }
    if (page === site) return;
    if (panel && page === panel) fromPanel.push(request.url());
    fromPorwr.push(request.url());
  });

  await requestSignatureFromPage(site);

  // Created by hand rather than through `openPanel`, so it is known to the listener before its
  // first request: a stylesheet font is fetched as the page loads.
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/www/index.html#/sidebar`);

  await panel.locator('.current-request').waitFor({ state: 'visible', timeout: 30_000 });
  await expect(panel.locator('.request-origin__value').first()).toHaveText('https://example.com');
  await panel.waitForLoadState('networkidle');

  // Without this the test could pass having watched nothing.
  expect(fromPanel.some((url) => LOCAL.test(url))).toBe(true);
  expect(fromPanel.filter((url) => !LOCAL.test(url))).toEqual([]);
  // Nothing Porwr requested, from any page or the worker, names the site that is asking.
  expect(fromPorwr.filter((url) => !LOCAL.test(url) && url.includes(SITE_HOST))).toEqual([]);

  await site.close();
});
