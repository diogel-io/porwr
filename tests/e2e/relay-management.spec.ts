import type { Locator, Page } from '@playwright/test';

import { expect, test } from './fixtures/extension';
import { createVault } from './fixtures/vault';

/**
 * Profile Search Relays moved from Settings to the Relays page (#263), where, like the other relay
 * cards, a change is kept only once Save is pressed.
 *
 * No account is created: the list is shared by every account, so the card shows without one.
 */

const go = (page: Page, route: string) => page.goto(page.url().replace(/#.*$/, `#${route}`));

const listed = (card: Locator) =>
  card
    .getByLabel('Edit profile search relay', { exact: true })
    .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));

async function addRelay(card: Locator, url: string) {
  await card.getByLabel('Profile search relay URL', { exact: true }).fill(url);
  await card.getByRole('button', { name: 'Add profile search relay', exact: true }).click();
}

test.describe('relay management', () => {
  test('Profile Search Relays live on the Relays page and are kept only after Save', async ({
    openPage,
  }) => {
    const page = await openPage('/login');
    await createVault(page);

    await go(page, '/settings');
    await expect(page.getByRole('heading', { name: 'Extension Settings', level: 1 })).toBeVisible();
    await expect(page.getByText('Profile Search Relays')).toHaveCount(0);

    await go(page, '/relays');
    const card = page.getByTestId('profile-search-relays-card');
    await expect(card.getByText('Profile Search Relays', { exact: true })).toBeVisible();
    await expect(card.getByText(/Used by all accounts/)).toBeVisible();
    await expect(card.getByRole('button', { name: 'Save', exact: true })).toBeVisible();

    // Leaving without saving keeps the stored list.
    await addRelay(card, 'wss://unsaved.example');
    await expect.poll(() => listed(card)).toContain('wss://unsaved.example');
    await expect(card.getByText('Unsaved changes')).toBeVisible();
    await page.reload();
    await expect(card.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await expect.poll(() => listed(card)).not.toContain('wss://unsaved.example');

    // Saving keeps it across a reload.
    await addRelay(card, 'wss://saved.example');
    await card.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Profile search relays saved')).toBeVisible();
    await expect(card.getByText('Unsaved changes')).toHaveCount(0);
    await page.reload();
    await expect.poll(() => listed(card)).toContain('wss://saved.example');
  });
});
