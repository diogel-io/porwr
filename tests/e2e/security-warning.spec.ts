import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/extension';
import { createVault, TEST_ACCOUNT, seedAccounts } from './fixtures/vault';

/**
 * The key-safety warning is a yellow icon in the corner of the card (#298), not a banner. Its text
 * opens on hover and on keyboard focus, and Escape closes it, so it never depends on a pointer.
 */

async function goTo(page: Page, hash: string): Promise<void> {
  await page.goto(page.url().replace(/#.*$/, `#${hash}`));
  await page.reload();
}

const panel = (page: Page) => page.locator('.security-warning__panel');

test.describe('security warning (#298)', () => {
  test('sits in the Keys card and opens on hover and on focus', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedAccounts(page, [TEST_ACCOUNT]);
    await goTo(page, '/keys');

    const warning = page.locator('.key-management-page__card .security-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toHaveAccessibleName('Security Warning');
    await expect(warning).toHaveAccessibleDescription(/Never share private keys or nsec values/);

    await warning.hover();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toContainText('Never share private keys or nsec values.');
    await page.mouse.move(0, 0);
    await expect(panel(page)).toBeHidden();

    await warning.focus();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
  });

  test('sits in the View Key card with its own message', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedAccounts(page, [TEST_ACCOUNT]);
    await goTo(page, '/keys');
    await page.getByRole('button', { name: 'View' }).or(page.getByRole('link', { name: 'View' })).first().click();

    const warning = page.locator('.view-key-page__card .security-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toHaveAccessibleName('Important');

    await warning.focus();
    await expect(panel(page)).toContainText('Ensure you export and securely store your keys.');
  });
});
