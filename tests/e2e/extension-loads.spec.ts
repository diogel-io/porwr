import { expect, test } from './fixtures/extension';

/**
 * The smoke test the rest of the suite depends on.
 *
 * If the extension does not load or the worker does not start, every other spec fails in a way that
 * looks like a product bug. This one names the real cause.
 */
test.describe('the built extension', () => {
  test('loads and starts its background worker', async ({ background, extensionId }) => {
    expect(extensionId).toMatch(/^[a-p]{32}$/);
    expect(background.url()).toContain('background');
  });

  test('asks for no permission beyond storage, sidePanel and downloads (NFR-18)', async ({
    background,
  }) => {
    const permissions = await background.evaluate(
      () => chrome.runtime.getManifest().permissions ?? [],
    );

    // Adding a permission here is a product decision, not an implementation detail: it changes the
    // install-time warning a key-protection product shows its users. `downloads` was decided on
    // 2026-10-17 so a vault backup is saved through a Save As dialog (#314).
    expect([...permissions].sort()).toEqual(['downloads', 'sidePanel', 'storage']);
  });

  test('holds no host permissions, which is why tab.url is never readable (#154)', async ({
    background,
  }) => {
    const hostPermissions = await background.evaluate(
      () => chrome.runtime.getManifest().host_permissions ?? [],
    );

    expect(hostPermissions).toEqual([]);
  });

  test('loads page scripts from the extension alone, never from a local server (#247)', async ({
    background,
  }) => {
    const csp = await background.evaluate(
      () =>
        (chrome.runtime.getManifest() as chrome.runtime.ManifestV3).content_security_policy
          ?.extension_pages ?? '',
    );

    const directives = new Map(
      csp
        .split(';')
        .map((directive) => directive.trim().split(/\s+/))
        .filter(([name]) => name)
        .map(([name, ...sources]) => [name!, sources]),
    );

    // The local script sources are for `quasar dev` only; a built extension that kept them would run
    // script served by any process on the user's machine in the pages that hold the vault.
    expect(directives.get('script-src')).toEqual(["'self'"]);
    // A local host appears only in connect-src, for loopback ws:// relays and their NIP-11 document
    // (diogel-io/workspace#142); never as a source of script or anything else.
    for (const [name, sources] of directives) {
      for (const source of sources.filter((item) => /localhost|127\.0\.0\.1/.test(item))) {
        expect([name, source]).toEqual(['connect-src', expect.stringMatching(/^(ws|http):\/\//)]);
      }
    }
  });
});
