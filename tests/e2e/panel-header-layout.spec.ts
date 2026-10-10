import { expect, test } from './fixtures/extension';
import { createVault, seedAccount } from './fixtures/vault';

/**
 * The header must keep the identity legible at panel widths (#188).
 *
 * Asserted on rendered width, not on the element existing. Every check that existed before passed
 * while the account alias rendered at 14 pixels — an ellipsis and nothing else — because nothing
 * overflowed and the element was present. Presence was never the question.
 */

/** Wide enough that a truncated alias is obvious rather than arguable. */
const LEGIBLE_ALIAS_PX = 48;

const renameActiveAccount = async (page: import('@playwright/test').Page, alias: string) => {
  const renamed = await page.evaluate(async (name) => {
    const current = (await chrome.storage.local.get('nostr:active'))['nostr:active'] as string;
    return chrome.runtime.sendMessage({ type: 'accounts.rename', payload: { currentAlias: current, newAlias: name } });
  }, alias);
  if (!renamed || typeof renamed !== 'object' || (renamed as { alias?: string }).alias !== alias.trim()) {
    throw new Error(`Could not rename the account: ${JSON.stringify(renamed)}`);
  }
  await page.reload();
  await page.locator('.sidebar-root').waitFor({ state: 'visible', timeout: 20_000 });
};

const measure = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const width = (selector: string): number => {
      const el = document.querySelector(selector);
      return el ? Math.round(el.getBoundingClientRect().width) : 0;
    };
    const header = document.querySelector('.sidebar-header');
    return {
      alias: width('.account-switcher__alias'),
      aliasText: (document.querySelector('.account-switcher__alias') as HTMLElement | null)?.innerText ?? '',
      brandName: width('.sidebar-brand__name'),
      overflows: header ? header.scrollWidth > header.clientWidth : true,
    };
  });

test.describe('the panel header', () => {
  for (const width of [320, 400]) {
    test(`keeps the account alias legible at ${width}px`, async ({ openPage }) => {
      const page = await openPage('/login');
      await createVault(page);
      await seedAccount(page);
      await page.goto(page.url().replace(/#.*$/, '#/sidebar'));
      await page.locator('.sidebar-root').waitFor({ state: 'visible', timeout: 20_000 });
      await page.setViewportSize({ width, height: 700 });

      const header = await measure(page);

      expect(header.alias).toBeGreaterThan(LEGIBLE_ALIAS_PX);
      expect(header.overflows).toBe(false);
    });
  }

  test('shows a long alias without overflowing or collapsing', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedAccount(page);
    await page.goto(page.url().replace(/#.*$/, '#/sidebar'));
    await page.locator('.sidebar-root').waitFor({ state: 'visible', timeout: 20_000 });

    // Aliases are user-supplied and unbounded; a three-character one proves nothing about layout.
    await renameActiveAccount(page, 'a-very-long-account-alias');
    await page.setViewportSize({ width: 320, height: 700 });

    const header = await measure(page);

    expect(header.aliasText).toContain('a-very-long');
    expect(header.alias).toBeGreaterThan(LEGIBLE_ALIAS_PX);
    expect(header.overflows).toBe(false);
  });

  test('drops the wordmark before squeezing the identity', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedAccount(page);
    await page.goto(page.url().replace(/#.*$/, '#/sidebar'));
    await page.locator('.sidebar-root').waitFor({ state: 'visible', timeout: 20_000 });

    await page.setViewportSize({ width: 400, height: 700 });
    const roomy = await measure(page);
    expect(roomy.brandName).toBeGreaterThan(0);

    await page.setViewportSize({ width: 320, height: 700 });
    const tight = await measure(page);

    // The brand is decoration; the switcher names the identity new sites bind to. The ornamental
    // element yields first.
    expect(tight.brandName).toBe(0);
    expect(tight.alias).toBeGreaterThan(LEGIBLE_ALIAS_PX);
  });
});
