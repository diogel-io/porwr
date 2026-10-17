import { expect, test } from './fixtures/extension';
import { TEST_ACCOUNT, createVault, requestSignatureFromPage, seedAccount } from './fixtures/vault';

/**
 * The closed-panel attention path (#177, #113's last acceptance criterion).
 *
 * While the panel is closed the toolbar badge and title are the *only* thing telling a user that
 * something is waiting (D4). Unit tests cover the formatting; nothing covered the whole path —
 * request arrives, queue writes, `chrome.action` is called — in a real browser.
 */
test.describe('the toolbar while a request waits', () => {
  test('shows the pending count and says what is waiting', async ({
    openPage,
    background,
    context,
  }) => {
    const extensionPage = await openPage('/login');
    await createVault(extensionPage);
    await seedAccount(extensionPage);

    const site = await context.newPage();
    await site.goto('https://example.com');
    await requestSignatureFromPage(site);

    // The badge is written after the queue write, so this polls rather than reading once — an
    // immediate read would pass or fail on machine speed.
    await expect
      .poll(() => background.evaluate(() => chrome.action.getBadgeText({})), { timeout: 15_000 })
      .toBe('1');

    const title = await background.evaluate(() => chrome.action.getTitle({}));
    expect(title).toMatch(/1 request waiting/);

    await site.close();
  });

  test('clears once the request is decided', async ({ openPage, background, context }) => {
    const extensionPage = await openPage('/login');
    await createVault(extensionPage);
    await seedAccount(extensionPage);

    const site = await context.newPage();
    await site.goto('https://example.com');
    await requestSignatureFromPage(site);

    await expect
      .poll(() => background.evaluate(() => chrome.action.getBadgeText({})), { timeout: 15_000 })
      .toBe('1');

    // Decided through the panel, so the assertion covers the path a user actually takes.
    await extensionPage.goto(extensionPage.url().replace(/#.*$/, '#/sidebar'));
    await extensionPage.locator('.current-request').waitFor({ state: 'visible', timeout: 15_000 });
    await extensionPage
      .getByRole('button', { name: /reject/i })
      .first()
      .click();

    await expect
      .poll(() => background.evaluate(() => chrome.action.getBadgeText({})), { timeout: 15_000 })
      .toBe('');

    await site.close();
  });

  test('presents the request in the panel, signed for the seeded identity', async ({
    openPage,
    context,
  }) => {
    const extensionPage = await openPage('/login');
    await createVault(extensionPage);
    await seedAccount(extensionPage);

    const site = await context.newPage();
    await site.goto('https://example.com');
    await requestSignatureFromPage(site);

    await extensionPage.goto(extensionPage.url().replace(/#.*$/, '#/sidebar'));
    await extensionPage.locator('.current-request').waitFor({ state: 'visible', timeout: 15_000 });

    // The origin is the site's own, not the tab the user happens to be looking at (D2, S8), and the
    // identity it will be signed by is named beside it. Both render in `.request-origin__value`.
    const origin = extensionPage.locator('.request-origin__value').first();
    await expect(origin).toHaveText('https://example.com');
    await expect(extensionPage.locator('.request-origin')).toContainText(TEST_ACCOUNT.alias);

    await site.close();
  });
});
