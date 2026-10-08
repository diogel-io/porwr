import { expect, test } from './fixtures/extension';
import { createVault } from './fixtures/vault';

/**
 * A profile name is free text, so "Anne Mous" must be typeable when adding a key (#230).
 *
 * The space used to be swallowed: the form sat inside a `<q-item tag="label">`, which Quasar treats
 * as clickable and so cancels every space keydown that bubbles up to it. The unit tests stub
 * `q-item` as a plain `<div>` and could never see that, which is why this is checked with a real
 * keyboard in a real browser.
 */
test.describe('adding a key', () => {
  test('accepts spaces typed into the profile name', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);

    await page.goto(page.url().replace(/#.*$/, '#/keys/new'));
    await page.getByRole('button', { name: 'Generate Keys', exact: true }).click();

    const profileName = page.locator('#generate-keys input').first();
    await profileName.click();
    await page.keyboard.type('Anne Mous');

    await expect(profileName).toHaveValue('Anne Mous');

    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page).toHaveURL(/#\/keys\/Anne%20Mous$/);
  });
});
