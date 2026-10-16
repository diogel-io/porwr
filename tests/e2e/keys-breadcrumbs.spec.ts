import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/extension';
import { createVault, TEST_ACCOUNT, seedAccounts } from './fixtures/vault';

/**
 * The Keys sub-pages lead back to the list (#302).
 *
 * Before this, View, Import Key and Add New Key were dead ends: the only way back was the Keys item
 * in the navigation menu. Driven through the real router so the link is shown to work, not just to
 * be present.
 */

async function goTo(page: Page, hash: string): Promise<void> {
  await page.goto(page.url().replace(/#.*$/, `#${hash}`));
  await page.reload();
}

const breadcrumb = (page: Page) => page.getByRole('navigation', { name: 'Breadcrumb' });
const keysList = (page: Page) => page.locator('.key-management-page__card');
const action = (page: Page, name: string) =>
  page.getByRole('link', { name }).or(page.getByRole('button', { name })).first();

test.describe('Keys breadcrumbs (#302)', () => {
  test('the key details page names the key and leads back to the list', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedAccounts(page, [TEST_ACCOUNT]);
    await goTo(page, '/keys');

    await action(page, 'View').click();
    await expect(page.locator('.view-key-page')).toBeVisible();

    const trail = breadcrumb(page);
    await expect(trail).toBeVisible();
    await expect(trail.locator('[aria-current="page"]')).toHaveText(TEST_ACCOUNT.alias);

    // Sits just above the hero. `q-page`'s min-height once stretched the breadcrumb's grid row into
    // a gap as tall as the hero itself.
    const gap = await page.evaluate(() => {
      const crumb = document.querySelector('.dashboard-breadcrumbs')!.getBoundingClientRect();
      const hero = document.querySelector('.dashboard-hero')!.getBoundingClientRect();
      return hero.top - crumb.bottom;
    });
    expect(gap).toBeLessThanOrEqual(24);

    // Keyboard, not a click: the way back has to work without a pointer.
    await trail.getByRole('link', { name: 'Keys' }).focus();
    await page.keyboard.press('Enter');
    await expect(keysList(page)).toBeVisible();
    await expect(page).toHaveURL(/#\/keys$/);
  });

  for (const [button, current] of [
    ['Import Key', 'Import Key'],
    ['Add New Key', 'Add New Key'],
  ] as const) {
    test(`${button} leads back to the list`, async ({ openPage }) => {
      const page = await openPage('/login');
      await createVault(page);
      await seedAccounts(page, [TEST_ACCOUNT]);
      await goTo(page, '/keys');

      await action(page, button).click();

      const trail = breadcrumb(page);
      await expect(trail.locator('[aria-current="page"]')).toHaveText(current);

      await trail.getByRole('link', { name: 'Keys' }).click();
      await expect(keysList(page)).toBeVisible();
    });
  }

  test('a long alias does not widen a narrow tab', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);
    const alias = 'an-account-alias-long-enough-to-overflow-a-narrow-tab-on-its-own';
    await seedAccounts(page, [{ ...TEST_ACCOUNT, alias }]);
    await page.setViewportSize({ width: 480, height: 900 });
    await goTo(page, `/keys/${alias}`);

    const current = breadcrumb(page).locator('[aria-current="page"]');
    await expect(current).toHaveText(alias);

    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      const crumb = document.querySelector('.dashboard-breadcrumbs');
      return {
        page: root.scrollWidth > root.clientWidth,
        crumb: crumb ? crumb.scrollWidth > crumb.clientWidth : true,
      };
    });
    expect(overflow).toEqual({ page: false, crumb: false });
  });
});
