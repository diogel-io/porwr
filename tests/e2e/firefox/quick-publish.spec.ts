import { finalizeEvent, SimplePool } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';

import { expect, test, until } from '../fixtures/firefox';
import { nakAvailable, startRelay } from '../fixtures/relays';
import { TEST_ACCOUNT } from '../fixtures/vault';

/**
 * Quick Publish signs and publishes in Firefox (#411).
 *
 * Firefox structured-clones extension messages and cannot clone a Vue reactive proxy, so a note
 * whose tags reached the background still reactive failed with "Proxy object could not be cloned".
 * Chromium never showed it, and the Chromium Quick Publish test only previews, so this signs for
 * real, in the browser that failed. The account's kind 10002 lives on a local relay standing in for
 * the fallback relays; nothing is published to a real relay.
 */
test('Quick Publish signs and publishes a note in Firefox', async ({ driver, createVault }) => {
  if (!nakAvailable()) {
    if (process.env.CI) throw new Error('nak is required for the Quick Publish end-to-end test.');
    test.skip(true, 'install nak to run the Quick Publish end-to-end test');
    return;
  }

  const relay = await startRelay([]);
  const pool = new SimplePool();
  try {
    await createVault();

    // Point the app at the local relay before adding the account, then add it the way the Import
    // page does. Sent from the extension page, which is where `accounts.add` is accepted.
    const seeded = await driver.executeAsyncScript<string>(
      'const [relayUrl, alias, privkey, done] = arguments;' +
        'browser.storage.local.set({ "nostr:fallback-relays": [relayUrl] })' +
        '  .then(() => browser.runtime.sendMessage({ type: "accounts.add", payload: { alias, privkey } }))' +
        '  .then((answer) => browser.storage.local.set({ "nostr:active": alias }).then(() => answer))' +
        '  .then((answer) => done(answer && answer.id), (e) => done("seed failed: " + String(e)));',
      relay.url,
      TEST_ACCOUNT.alias,
      TEST_ACCOUNT.privkey,
    );
    expect(seeded).toBe(TEST_ACCOUNT.pubkey);

    const relayList = finalizeEvent(
      {
        kind: 10002,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['r', relay.url]],
        content: '',
      },
      hexToBytes(TEST_ACCOUNT.privkey),
    );
    await Promise.all(pool.publish([relay.url], relayList));

    // A hash change from inside the page, not a WebDriver navigation, which Firefox refuses for
    // `moz-extension://`.
    await driver.executeScript('location.hash = "#/dashboard";');

    // The account's relays load after the card does; Preview refuses until there is one.
    await driver.wait(
      until.elementLocated({
        xpath: '//*[@id="quick-sign"]//*[contains(., "destinations: 1 relay")]',
      }),
      30_000,
      'Quick Publish never found the relay to publish to',
    );

    const content = `firefox quick publish ${String(Date.now())}`;
    await driver.findElement({ css: '#quick-sign textarea' }).sendKeys(content);
    // Clicked through the DOM: a toast from adding the account can sit over the button.
    await driver.executeScript(
      'arguments[0].click();',
      await driver.findElement({ xpath: '//*[@id="quick-sign"]//button[contains(., "Preview")]' }),
    );

    const sign = await driver.wait(
      until.elementLocated({
        xpath:
          '//*[contains(@class, "quick-sign-preview")]//button[contains(., "Sign and publish")]',
      }),
      15_000,
      'the preview never opened',
    );
    await driver.executeScript('arguments[0].click();', sign);

    // The card always shows a state banner, so wait for the success one. If it never comes, report
    // what the card said instead: before #411 was fixed, that was the proxy clone error.
    const success = await driver
      .wait(until.elementLocated({ css: '#quick-sign .q-banner.bg-positive' }), 30_000)
      .catch(async () => {
        // `textContent`, not `getText`: the preview dialog stays open over the card on failure.
        const said = await driver
          .findElement({ css: '#quick-sign .q-banner' })
          .getAttribute('textContent');
        throw new Error(`Quick Publish did not report success; it said: ${said}`);
      });
    expect(await success.getText()).toBe('Event signed and published successfully.');

    const published = await pool.querySync([relay.url], {
      kinds: [1],
      authors: [TEST_ACCOUNT.pubkey],
    });
    expect(published.map((event) => event.content)).toContain(content);
  } finally {
    pool.close([relay.url]);
    relay.process.kill();
  }
});
