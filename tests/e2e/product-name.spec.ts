import { expect, test } from './fixtures/extension';
import { createVault } from './fixtures/vault';

/**
 * Porwr is the product; Diogel is the brand (#225).
 *
 * Checks each place the product names itself to a person or a page: the extension's own name, the
 * panel header, the tab title, and the signer name a site reads from `window.nostr`.
 */
test.describe('the product name', () => {
  test('is Porwr in the manifest, the panel and the tab title', async ({ openPage, background }) => {
    const manifest = await background.evaluate(() => chrome.runtime.getManifest());
    expect(manifest.name).toBe('Porwr');
    expect(manifest.action?.default_title).toBe('Porwr');

    const page = await openPage('/login');
    await createVault(page);
    await page.goto(page.url().replace(/#.*$/, '#/sidebar'));

    await expect(page.locator('.sidebar-brand__name')).toHaveText('Porwr');
    await expect(page).toHaveTitle('Porwr');
  });

  test('is the signer name a site reads from window.nostr', async ({ context }) => {
    const site = await context.newPage();
    await site.goto('https://example.com');

    await site.waitForFunction(() => 'nostr' in window, undefined, { timeout: 15_000 });
    const name = await site.evaluate(() => (window as unknown as { nostr: { name: string } }).nostr.name);

    expect(name).toBe('Porwr');
  });
});
