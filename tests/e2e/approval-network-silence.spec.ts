import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/extension';
import { createVault, requestSignatureFromPage, seedAccount } from './fixtures/vault';

/**
 * The approval panel contacts nobody while it shows a request (D13, threat model T7, #144).
 *
 * A remote fetch made to present a request tells a third party which site the user is signing
 * for, and when. The panel used to load a favicon (F3) and its stylesheet loaded a web font from
 * Google; both are gone, and this keeps it that way. Only the panel page is watched: the site
 * page is the site's own business, and the worker's relay sockets are not part of presenting a
 * request.
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
  await requestSignatureFromPage(site);

  // Created by hand rather than through `openPanel`, so the listener is in place before the
  // panel's first request: a stylesheet font is fetched as the page loads.
  const panel: Page = await context.newPage();
  const seen: string[] = [];
  panel.on('request', (request) => seen.push(request.url()));
  await panel.goto(`chrome-extension://${extensionId}/www/index.html#/sidebar`);

  await panel.locator('.current-request').waitFor({ state: 'visible', timeout: 30_000 });
  await expect(panel.locator('.request-origin__value').first()).toHaveText('https://example.com');
  await panel.waitForLoadState('networkidle');

  // Without this the test could pass having watched nothing.
  expect(seen.some((url) => LOCAL.test(url))).toBe(true);
  expect(seen.filter((url) => !LOCAL.test(url))).toEqual([]);

  await site.close();
});
