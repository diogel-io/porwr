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

/** Where focus is: a contact row's Remove button as `remove@<row>`, or what else holds it. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    const row = element?.closest('.contacts-page__contact');
    if (row && element?.classList.contains('contacts-page__remove')) {
      return `remove@${row.getAttribute('aria-posinset')}`;
    }
    return element?.getAttribute('aria-label') || `${element?.tagName}.${element?.className}`;
  });

async function openLargeList(page: Page, relay: string): Promise<void> {
  await page.setViewportSize({ width: 360, height: 560 });
  await createVault(page);
  await page.evaluate((url) => chrome.storage.local.set({ 'nostr:fallback-relays': [url] }), relay);
  await seedAccount(page);
  await seedContacts(page);
  const contactsPage = page.url().replace(/#.*$/, '#/contacts');
  await page.goto('about:blank');
  await page.goto(contactsPage);
  await expect(page.getByText('First Contact')).toBeVisible({ timeout: BUDGET_MS });
}

test.describe('keyboard focus in a 10,000-contact list (#440)', () => {
  test('Tab and Shift+Tab held down stay in the list, row by row', async ({ openPage, relays }) => {
    test.setTimeout(120_000);
    const page = await openPage('/login');
    await openLargeList(page, relays.plain);
    await page.locator('.contacts-page__remove').first().focus();

    // No pause between presses, as when the key is held down. While rows are rearranged, Quasar
    // can park focus on the list's content element for a frame before the page puts it back on
    // the row; focus never leaves the list, and the rows it visits never go back.
    const rowsVisited = async (key: string) => {
      const visited: string[] = [];
      for (let press = 0; press < 40; press++) {
        await page.keyboard.press(key);
        visited.push(await focused(page));
      }
      return visited;
    };
    const PARKED = 'DIV.q-virtual-scroll__content';
    const inList = (entry: string) => /^remove@\d+$/.test(entry) || entry === PARKED;
    const rowsOf = (visited: string[]) =>
      visited.filter((entry) => entry !== PARKED).map((entry) => Number(entry.split('@')[1]));

    const forwards = await rowsVisited('Tab');
    expect(forwards.every(inList)).toBe(true);
    expect(rowsOf(forwards)).toEqual([...rowsOf(forwards)].sort((a, b) => a - b));
    await expect.poll(() => focused(page)).toBe('remove@41');

    const backwards = await rowsVisited('Shift+Tab');
    expect(backwards.every(inList)).toBe(true);
    expect(rowsOf(backwards)).toEqual([...rowsOf(backwards)].sort((a, b) => b - a));
    await expect.poll(() => focused(page)).toBe('remove@1');
  });

  test('a focused row scrolled away hands focus to a row in view', async ({ openPage, relays }) => {
    const page = await openPage('/login');
    await openLargeList(page, relays.plain);
    await page.locator('.contacts-page__remove').first().focus();
    expect(await focused(page)).toBe('remove@1');

    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 8));
    // Quasar re-slices on the scroll, after which a row further down holds focus.
    await expect.poll(() => focused(page)).toMatch(/^remove@([2-9]|\d{2,})$/);
    const recovered = Number((await focused(page)).split('@')[1]);
    expect(recovered).toBeGreaterThan(1);

    // Focus moved without scrolling: the button is in view, and the page stayed put.
    const scrolledTo = await page.evaluate(() => window.scrollY);
    const box = await page.evaluate(() =>
      (document.activeElement as HTMLElement).getBoundingClientRect().toJSON(),
    );
    expect(box.bottom).toBeGreaterThan(0);
    expect(box.top).toBeLessThan(560);

    await page.keyboard.press('Tab');
    expect(await focused(page)).toBe(`remove@${recovered + 1}`);
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrolledTo)).toBeLessThan(560);
  });

  test('removing a contact by keyboard moves focus to the one in its place', async ({
    openPage,
    relays,
  }) => {
    const page = await openPage('/login');
    await openLargeList(page, relays.plain);
    await page.locator('.contacts-page__remove').nth(2).focus();
    expect(await focused(page)).toBe('remove@3');

    await page.keyboard.press('Enter');
    await expect(page.getByText(`${COUNT - 1} contacts`, { exact: true })).toBeVisible();
    // Contact 3 is gone, so position 3 now holds Contact 4, and focus is on it.
    await expect.poll(() => focused(page)).toBe('remove@3');
    const focusedRowText = await page.evaluate(
      () => (document.activeElement?.closest('.contacts-page__contact') as HTMLElement).innerText,
    );
    expect(focusedRowText).toContain('Contact 4');
  });

  test('clicking away from a focused row lets focus go', async ({ openPage, relays }) => {
    const page = await openPage('/login');
    await openLargeList(page, relays.plain);
    await page.locator('.contacts-page__remove').first().focus();
    await page.mouse.click(5, 300);
    const away = await focused(page);
    expect(away).not.toMatch(/^remove@/);

    // Scrolling afterwards does not pull focus back into the list.
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 8));
    await page.waitForTimeout(1_000);
    expect(await focused(page)).toBe(away);
  });

  test('Tab at typing speed, and leaving the list at either end, work as before', async ({
    openPage,
    relays,
  }) => {
    test.setTimeout(120_000);
    const page = await openPage('/login');
    await openLargeList(page, relays.plain);
    await page.locator('.contacts-page__remove').first().focus();
    for (let press = 0; press < 5; press++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(300);
    }
    expect(await focused(page)).toBe('remove@6');

    // Shift+Tab from the first row leaves the list upwards.
    await page.locator('.contacts-page__remove').first().focus();
    await page.keyboard.press('Shift+Tab');
    expect(await focused(page)).not.toMatch(/^remove@/);

    // Tab from the last row leaves the list downwards.
    await expect
      .poll(
        async () => {
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          return page.getByText(`Contact ${COUNT}`, { exact: true }).isVisible();
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    await page
      .locator(`.contacts-page__contact[aria-posinset="${COUNT}"] .contacts-page__remove`)
      .focus();
    await page.keyboard.press('Tab');
    expect(await focused(page)).not.toMatch(/^remove@/);
  });
});
