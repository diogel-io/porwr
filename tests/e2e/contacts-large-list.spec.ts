import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/relays';
import { createVault, seedAccount, TEST_ACCOUNT } from './fixtures/vault';

/**
 * The Contacts page stays usable with the largest list Porwr keeps (#428).
 *
 * The list is seeded straight into the contact cache: nak's relay refuses a kind 3 this long, and
 * the page shows whatever the cache holds. The relay has no kind 3, so the page's own refresh keeps
 * the seeded list. Only the rows in view are rendered, so showing it and editing it stay quick.
 */

const COUNT = 10_000;
/** Far above the ~1 s these take on a developer machine, so a slow CI runner does not fail them. */
const BUDGET_MS = 5_000;
const pubkeyAt = (index: number) => index.toString(16).padStart(64, '0');

async function seedContacts(page: Page): Promise<void> {
  await page.evaluate(
    ({ account, count, first }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('DiogelDatabase');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction(['contactLists', 'contactProfiles'], 'readwrite');
          tx.objectStore('contactLists').put({
            accountPubkey: account,
            contacts: Array.from({ length: count }, (_, index) => ({
              pubkey: (index + 1).toString(16).padStart(64, '0'),
              relayUrl: '',
              petname: `Contact ${index + 1}`,
            })),
            sourceEventId: 'seeded',
            sourceCreatedAt: Math.floor(Date.now() / 1000) - 60,
            fetchedAt: Date.now(),
          });
          tx.objectStore('contactProfiles').put({
            accountPubkey: account,
            pubkey: first,
            name: 'First Contact',
            displayName: '',
            about: 'The bio of the first contact',
            picture: '',
            nip05: '',
            updatedAt: 1,
            fetchedAt: Date.now(),
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
    { account: TEST_ACCOUNT.pubkey, count: COUNT, first: pubkeyAt(1) },
  );
}

test('the Contacts page shows, edits and scrolls a 10,000-contact list quickly', async ({
  openPage,
  relays,
}) => {
  test.setTimeout(120_000);
  const page = await openPage('/login');
  await page.setViewportSize({ width: 360, height: 560 });
  await createVault(page);
  await page.evaluate(
    (relay) => chrome.storage.local.set({ 'nostr:fallback-relays': [relay] }),
    relays.plain,
  );
  await seedAccount(page);
  await seedContacts(page);
  const contactsPage = page.url().replace(/#.*$/, '#/contacts');
  await page.goto('about:blank');

  let started = Date.now();
  await page.goto(contactsPage);
  await expect(page.getByText(`${COUNT} contacts`, { exact: true })).toBeVisible({
    timeout: BUDGET_MS,
  });
  await expect(page.getByText('First Contact')).toBeVisible({ timeout: BUDGET_MS });
  console.log(`first rows after ${Date.now() - started} ms`);

  // Only the rows in view are in the page.
  const rows = page.locator('.contacts-page__contact');
  expect(await rows.count()).toBeLessThan(100);
  // Assistive technology still learns the whole list's size.
  await expect(rows.first()).toHaveAttribute('aria-posinset', '1');
  await expect(rows.first()).toHaveAttribute('aria-setsize', String(COUNT));

  // The bio tooltip still shows on a row's avatar.
  await rows.first().locator('.q-avatar').hover();
  await expect(page.getByText('The bio of the first contact')).toBeVisible();

  started = Date.now();
  await page.getByRole('button', { name: 'Remove contact' }).first().click();
  await expect(page.getByText(`${COUNT - 1} contacts`, { exact: true })).toBeVisible({
    timeout: BUDGET_MS,
  });
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  console.log(`remove updated after ${Date.now() - started} ms`);
  await expect(page.getByText('First Contact')).toHaveCount(0);

  // Scrolling to the end renders the last contact.
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        return page.getByText(`Contact ${COUNT}`, { exact: true }).isVisible();
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  expect(await rows.count()).toBeLessThan(100);
});
