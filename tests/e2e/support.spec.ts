import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/relays';
import { createVault, TEST_ACCOUNT, seedAccounts } from './fixtures/vault';

/**
 * The Support page: a NIP-17 conversation with the Diogel support account, opened from the menu
 * inside Porwr rather than an external issue tracker (#228).
 *
 * Only the local relays are reachable here, and they hold no DM relay list for the real support
 * account, so delivery to support is refused. The full round trip with support is checked by hand,
 * since it needs the support account's key.
 */

async function seed(page: Page, fallbackRelay: string): Promise<void> {
  // Point the background at the local relay before adding accounts: adding one starts reads from
  // the fallback relays, and reads from the real seed relays would make Chrome hold back this
  // extension's later WebSocket connections, the local relay's included, for seconds.
  await page.evaluate((relay) => chrome.storage.local.set({ 'nostr:fallback-relays': [relay] }), fallbackRelay);
  await seedAccounts(page, [TEST_ACCOUNT]);
}

async function openSupportFromMenu(page: Page): Promise<void> {
  await page.goto(page.url().replace(/#.*$/, '#/dashboard'));
  await page.reload();
  await page.locator('.main-navigation__item', { hasText: 'Support' }).click();
  await expect(page).toHaveURL(/#\/support$/);
  await expect(page.getByRole('heading', { name: 'Support', level: 1 })).toBeVisible();
}

test.describe('support', () => {
  test('opens inside Porwr and waits for the account to have direct message relays', async ({ openPage, relays }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seed(page, relays.plain);

    await openSupportFromMenu(page);

    await expect(page.getByTestId('no-inbox')).toBeVisible();
    await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  });

  test('says support cannot be reached when support has no inbox the account can find', async ({ openPage, relays }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seed(page, relays.plain);
    const result = (await page.evaluate(
      (list) => chrome.runtime.sendMessage({ type: 'messaging.dmRelays.publish', payload: { relays: list } }),
      [relays.inbox],
    )) as { accepted?: string[] };
    expect(result.accepted).toEqual(expect.arrayContaining([relays.inbox]));

    await openSupportFromMenu(page);
    await expect(page.getByTestId('no-inbox')).toHaveCount(0);
    await page.getByLabel('Message', { exact: true }).fill('hello support');
    await page.getByLabel('Message', { exact: true }).press('Enter');

    await expect(page.getByTestId('support-not-reachable')).toBeVisible();
    await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  });
});
