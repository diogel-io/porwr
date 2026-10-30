import { expect, test } from './fixtures/extension';
import { createVault, seedAccount, TEST_ACCOUNT } from './fixtures/vault';

/**
 * Leaving the Profile page takes its upload listeners with it (#252).
 *
 * `ImageUploader` listens to `chrome.storage` for an upload's status. Its cleanup was registered after
 * an `await`, so Vue dropped it, and every visit left a listener behind; a later status was then
 * handled once per visit, each showing its own error. One status must show one notification.
 */
test('an upload status after several Profile visits is handled once', async ({ openPage }) => {
  const page = await openPage('/login');
  await createVault(page);
  await seedAccount(page);

  const go = (route: string) => page.goto(page.url().replace(/#.*$/, `#${route}`));
  const avatarCard = page.getByText('Avatar', { exact: true });

  for (let visit = 0; visit < 4; visit += 1) {
    await go('/profile');
    await expect(avatarCard).toBeVisible({ timeout: 15_000 });
    if (visit < 3) {
      await go('/relays');
      await expect(avatarCard).toBeHidden();
    }
  }

  await page.evaluate(
    (key) =>
      // A code, as the background stores it: the status never holds a server's own text (porwr#370).
      chrome.storage.local.set({ [key]: { error: 'too_large' } }),
    // Named for the account since #400; the unscoped key is dropped unread.
    `blossom:upload_status:avatar:${TEST_ACCOUNT.pubkey}`,
  );

  // Quasar folds identical notifications into one and counts the repeats in a badge, so a single
  // notification is not enough: it must also carry no repeat count. Read once rather than with a
  // retrying assertion, which would pass as soon as the notification timed out and took its badge.
  const notices = page.locator('.q-notification', { hasText: 'refused the image as too large' });
  await expect(notices).toHaveCount(1);
  // Long enough for any listener left behind by an earlier visit to have shown its own.
  await page.waitForTimeout(1_000);
  expect(await notices.count()).toBe(1);
  expect(await page.locator('.q-notification__badge').allTextContents()).toEqual([]);
});
