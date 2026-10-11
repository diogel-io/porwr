import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, test } from '../fixtures/firefox';

/**
 * A site's request names the site Firefox says sent it (#246).
 *
 * The background takes the requesting site from the content script port's browser-supplied sender.
 * Firefox's sender may carry no `origin`, so Porwr falls back to the sender's `url` there; this proves
 * that path end to end, from `window.nostr` on a real page to the request waiting in the queue.
 */

const TEST_ACCOUNT = {
  alias: 'e2e',
  privkey: '1'.repeat(64),
  pubkey: '4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa',
};

let server: Server;
let siteOrigin: string;

test.beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><title>site</title><p>site</p>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  siteOrigin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test.describe('page requests in Firefox', () => {
  test('are attributed to the page’s own origin', async ({ driver, createVault }) => {
    await createVault();
    const extensionTab = await driver.getWindowHandle();

    const seeded = await driver.executeAsyncScript<unknown>(
      'const [account, done] = arguments;' +
        'browser.runtime.sendMessage({ type: "accounts.add", payload: { alias: account.alias, privkey: account.privkey } })' +
        '  .then((added) => browser.storage.local.set({ "nostr:active": account.alias }).then(() => done(added)))' +
        '  .catch((e) => done("seed failed: " + String(e)));',
      TEST_ACCOUNT,
    );
    expect(seeded).toMatchObject({ id: TEST_ACCOUNT.pubkey });

    await driver.switchTo().newWindow('tab');
    await driver.get(`${siteOrigin}/page`);
    await driver.wait(
      () =>
        driver.executeScript<boolean>(
          'return typeof window.nostr === "object" && window.nostr !== null;',
        ),
      30_000,
      'window.nostr was never injected',
    );
    // Not awaited: the promise settles only when the user decides, and the waiting request is the point.
    await driver.executeScript(
      'window.__pubkey = window.nostr.getPublicKey().catch((e) => String(e)); return true;',
    );

    await driver.switchTo().window(extensionTab);
    const listQueue = () =>
      driver.executeAsyncScript<{ origin: string; state: string }[]>(
        'const done = arguments[arguments.length - 1];' +
          'browser.runtime.sendMessage({ type: "nostr.requests.list" }).then(done, () => done([]));',
      );

    await expect
      .poll(async () => (await listQueue()).map((request) => request.origin), { timeout: 30_000 })
      .toEqual([siteOrigin]);
  });
});
