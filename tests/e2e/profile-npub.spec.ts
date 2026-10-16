import * as nip19 from 'nostr-tools/nip19';

import { expect, test } from './fixtures/extension';
import { createVault, seedAccount, TEST_ACCOUNT } from './fixtures/vault';

/**
 * The account npub on the panel's profile card (#303).
 *
 * Asserted at the 320px floor in the real panel: an npub is 63 characters, enough on its own to push
 * the card wider than the panel (NFR-11), and a unit test cannot see layout.
 *
 * The clipboard write is recorded rather than read back. Reading the clipboard needs a permission
 * grant the persistent extension context does not take for its own origin; what matters here is
 * that a real click in the panel hands the full npub, not the shortened one, to `writeText`.
 */
test.describe('the profile card npub', () => {
  test('shows the npub without overflowing at 320px and copies the full value', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedAccount(page);
    await page.goto(page.url().replace(/#.*$/, '#/sidebar'));
    await page.locator('.sidebar-root').waitFor({ state: 'visible', timeout: 20_000 });
    await page.setViewportSize({ width: 320, height: 700 });

    const npub = nip19.npubEncode(TEST_ACCOUNT.pubkey);
    const button = page.locator('button.profile-npub');
    await expect(button).toBeVisible({ timeout: 20_000 });
    await expect(button).toHaveAttribute('title', npub);
    await expect(button).toContainText(npub.slice(-10));

    const overflows = await page.evaluate(() => {
      const card = document.querySelector('.profile-card');
      const root = document.documentElement;
      return {
        card: card ? card.scrollWidth > card.clientWidth : true,
        page: root.scrollWidth > root.clientWidth,
      };
    });
    expect(overflows).toEqual({ card: false, page: false });

    await page.evaluate(() => {
      const written: string[] = [];
      (window as unknown as { __written: string[] }).__written = written;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text: string) => {
            written.push(text);
            return Promise.resolve();
          },
        },
      });
    });

    // Keyboard first: the control has to work without a pointer.
    await button.focus();
    await page.keyboard.press('Enter');
    await button.click();

    const written = await page.evaluate(() => (window as unknown as { __written: string[] }).__written);
    expect(written).toEqual([npub, npub]);
  });
});
