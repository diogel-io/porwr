import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type firefox from 'selenium-webdriver/firefox.js';

import { expect, test } from '../fixtures/firefox';

/**
 * One-click wallet connection in Firefox (workspace#85).
 *
 * Firefox severs `window.opener` for a popup an extension page opens, so there the background opens
 * the wallet's popup itself and Porwr's content script relays the wallet's answer. A stand-in Alby
 * Hub is served on the loopback address, which Porwr accepts as a self-hosted Hub over `http:`
 * (#149), so this runs offline.
 *
 * Its answers name an unreachable relay. Porwr accepts the details, then fails to confirm the wallet
 * with `get_info`, and that error is the outcome. Reaching it proves the round trip from the wallet
 * page, through the content script and the background, to the outcome Wallet Connections listens for.
 */

const TEST_ACCOUNT = {
  alias: 'e2e',
  privkey: '1'.repeat(64),
  pubkey: '4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa',
};

const SUCCESS = {
  walletPubkey: 'a'.repeat(64),
  relayUrls: ['wss://127.0.0.1:9/'],
};

/** How the stand-in Hub answers: Alby Hub's own event, Coinos's opener call, or not at all. */
const ANSWERS: Record<string, string> = {
  event: `setInterval(() => window.dispatchEvent(new CustomEvent('nwc:success', { detail: ${JSON.stringify(SUCCESS)} })), 500);`,
  opener: `setInterval(() => { if (window.opener) window.opener.postMessage(${JSON.stringify({ type: 'nwc:success', ...SUCCESS })}, '*'); }, 500);`,
  none: '',
};

let server: Server;
let hubOrigin: string;
let answer = 'none';

test.beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(`<!doctype html><title>Alby Hub</title><script>${ANSWERS[answer]}</script>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  hubOrigin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test.describe('one-click wallet connection in Firefox', () => {
  test.beforeEach(async ({ driver, createVault }) => {
    await createVault();
    const seeded = await driver.executeAsyncScript<unknown>(
      'const [account, done] = arguments;' +
        'browser.runtime.sendMessage({ type: "accounts.add", payload: { alias: account.alias, privkey: account.privkey } })' +
        '  .then((added) => browser.storage.local.set({ "nostr:active": account.alias }).then(() => done(added)))' +
        '  .catch((e) => done("seed failed: " + String(e)));',
      TEST_ACCOUNT,
    );
    expect(seeded).toMatchObject({ id: TEST_ACCOUNT.pubkey });
    await driver.manage().setTimeouts({ script: 80_000 });
  });

  /**
   * Starts a connection the way Wallet Connections does in Firefox, and waits for its outcome on
   * `wallet-connect-channel`. `whileWaiting` runs once the background has opened the popup.
   */
  const connect = async (
    driver: firefox.Driver,
    whileWaiting?: () => Promise<void>,
  ): Promise<{ status: string; message?: string }> => {
    const extensionTab = await driver.getWindowHandle();
    const before = await driver.getAllWindowHandles();
    await driver.executeScript(
      'const [account, origin] = arguments;' +
        'window.__outcome = new Promise((resolve) => {' +
        '  const channel = new BroadcastChannel("porwr:wallet-connect");' +
        '  channel.onmessage = (event) => { if (event.data?.requestId === "req-85") resolve(event.data.outcome); };' +
        '});' +
        'window.__opened = browser.runtime.sendMessage({ type: "nip47.authorization.open",' +
        '  payload: { accountPubkey: account, provider: "alby-hub", customOrigin: origin, requestId: "req-85" } });',
      TEST_ACCOUNT.pubkey,
      hubOrigin,
    );
    const opened = await driver.executeAsyncScript<unknown>(
      'const done = arguments[arguments.length - 1]; window.__opened.then(done, (e) => done(String(e)));',
    );
    expect(opened).toHaveProperty('pendingId');

    // The background opened the wallet in a window of its own.
    await expect
      .poll(async () => (await driver.getAllWindowHandles()).length, { timeout: 20_000 })
      .toBe(before.length + 1);

    if (whileWaiting) {
      await whileWaiting();
      await driver.switchTo().window(extensionTab);
    }
    return driver.executeAsyncScript(
      'const done = arguments[arguments.length - 1]; window.__outcome.then(done);',
    );
  };

  test('relays the Alby Hub nwc:success event from the wallet page', async ({ driver }) => {
    answer = 'event';
    const windowsBefore = (await driver.getAllWindowHandles()).length;

    const outcome = await connect(driver);

    expect(outcome.status).toBe('error');
    expect(outcome.message).toMatch(/No NIP-47 wallet info event found/);
    // The background closed the wallet's window once it had the answer.
    await expect.poll(async () => (await driver.getAllWindowHandles()).length).toBe(windowsBefore);
  });

  test("relays a Coinos-style window.opener.postMessage through Porwr's stand-in opener", async ({
    driver,
  }) => {
    answer = 'opener';

    const outcome = await connect(driver);

    expect(outcome.status).toBe('error');
    expect(outcome.message).toMatch(/No NIP-47 wallet info event found/);
  });

  test('reports no response promptly when the user closes the wallet window', async ({
    driver,
  }) => {
    answer = 'none';

    const started = Date.now();
    const outcome = await connect(driver, async () => {
      const handles = await driver.getAllWindowHandles();
      await driver.switchTo().window(handles[handles.length - 1] as string);
      await driver.close();
    });

    expect(outcome).toEqual({ status: 'no-response' });
    expect(Date.now() - started).toBeLessThan(60_000);
  });
});
