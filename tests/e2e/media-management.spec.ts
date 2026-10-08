import { expect, test } from './fixtures/extension';
import { createVault } from './fixtures/vault';

/**
 * The Blossom server URL moved from Settings to its own Media Management page (#229).
 *
 * The storage key and default are unchanged, so this checks the user-visible half of the move: the
 * page shows the stored value, an edit survives a reload, and Settings no longer offers the field.
 */
test.describe('media management', () => {
  test('edits the Blossom server URL, which Settings no longer shows', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);

    await page.goto(page.url().replace(/#.*$/, '#/media'));
    const blossomServer = page.getByLabel('Blossom Server URL', { exact: true });
    await expect(blossomServer).toHaveValue('https://blossom.primal.net/');

    await blossomServer.fill('https://media.example.org/');
    await expect(blossomServer).toHaveValue('https://media.example.org/');

    await page.reload();
    await expect(page.getByLabel('Blossom Server URL', { exact: true })).toHaveValue(
      'https://media.example.org/',
    );

    await page.goto(page.url().replace(/#.*$/, '#/settings'));
    await expect(page.getByRole('heading', { name: 'Extension Settings', level: 1 })).toBeVisible();
    await expect(page.getByText('Blossom Server URL')).toHaveCount(0);
  });
});
