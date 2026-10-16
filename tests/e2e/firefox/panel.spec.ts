import { expect, test } from '../fixtures/firefox';

/**
 * Firefox parity (#141, NFR-17).
 *
 * Both browsers ship from the same tagged source and must behave equivalently on the core approval
 * path. These assert the same panel facts the Chromium suite does, so a divergence shows up as a
 * failure here rather than as a support report.
 */
test.describe('the panel in Firefox', () => {
  test('loads the extension and renders the panel shell', async ({ driver, openExtensionPage }) => {
    await openExtensionPage('/sidebar');

    expect(await driver.findElements({ css: '.sidebar-root' })).toHaveLength(1);
    expect(await driver.findElements({ css: '.sidebar-header' })).toHaveLength(1);
  });

  test('settles on the panel with no vault, rather than racing a redirect (#158)', async ({
    driver,
    openExtensionPage,
  }) => {
    await openExtensionPage('/sidebar');

    expect(await driver.getCurrentUrl()).toContain('#/sidebar');
    expect(await driver.findElements({ css: '.sidebar-setup' })).toHaveLength(1);
  });

  test('never offers to unlock a vault that does not exist (#158)', async ({
    driver,
    openExtensionPage,
  }) => {
    await openExtensionPage('/sidebar');

    expect(await driver.findElements({ css: '.sidebar-unlock' })).toHaveLength(0);
  });

  test('ships the sidebar_action manifest key, which is how Firefox reveals the panel', async ({
    driver,
    openExtensionPage,
  }) => {
    await openExtensionPage('/sidebar');

    // The panel is reached here as an extension page, so the browser-owned surface itself is not
    // exercised. Asserting the manifest key is what keeps that half honest.
    const manifest = await driver.executeScript<{
      sidebar_action?: unknown;
      permissions?: string[];
    }>('return chrome.runtime.getManifest()');

    expect(manifest.sidebar_action).toBeTruthy();
    // Firefox gets no sidePanel permission; that key is Chromium's (NFR-18).
    expect(manifest.permissions ?? []).toEqual(['storage']);
  });
});
