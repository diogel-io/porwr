import { VAULT_PASSWORD, expect, test, until } from '../fixtures/firefox';

/**
 * Vault lifecycle in Firefox (#141).
 *
 * The Chromium suite creates, locks and unlocks a vault; the Firefox project asserted panel parity
 * only, which left the surface a user actually meets first — the vault — covered in one browser.
 *
 * NFR-17 asks for equivalent core behaviour across both, and the panel's vault states are core: a
 * locked panel must render its own unlock view rather than routing to the full-tab login page,
 * which is the regression #147 and #181 both produced in Chromium.
 */
test.describe('the vault in Firefox', () => {
  test('creates a vault and settles on the panel, not a dashboard surface', async ({
    driver,
    createVault,
    openExtensionPage,
  }) => {
    await createVault();
    await openExtensionPage('/sidebar');

    await driver.wait(
      until.elementLocated({ css: '.sidebar-root' }),
      30_000,
      'the panel never rendered',
    );

    // The panel and the management surfaces share one bundle, so nothing structural keeps a
    // dashboard layout out of a 360px panel (D2, S9).
    const dashboards = await driver.findElements({
      css: '.dashboard-layout, .dashboard-navigation',
    });
    expect(dashboards).toHaveLength(0);
  });

  test('renders its own unlock view in the panel when locked, never the full-tab login page', async ({
    driver,
    createVault,
    lockVault,
    openExtensionPage,
  }) => {
    await createVault();
    await lockVault();

    await openExtensionPage('/sidebar');
    await driver.wait(
      until.elementLocated({ css: '.sidebar-unlock' }),
      30_000,
      'the panel never offered to unlock',
    );

    // `.vault-card` is the full-tab login surface. Its presence here would mean the panel had been
    // routed away to a window it must never open (D2).
    const fullTab = await driver.findElements({ css: '.vault-card' });
    expect(fullTab).toHaveLength(0);
  });

  test('unlocks from inside the panel and stays there', async ({
    driver,
    createVault,
    lockVault,
    openExtensionPage,
  }) => {
    await createVault();
    await lockVault();

    // Unlocked from the panel's own view, which is the path that regressed. Unlocking from the
    // full-tab login page instead would exercise a different code path and prove nothing about
    // this one: verified by breaking `isPanelRoute`, which a login-page unlock does not notice.
    await openExtensionPage('/sidebar');
    await driver.wait(
      until.elementLocated({ css: '.sidebar-unlock' }),
      30_000,
      'the panel never offered to unlock',
    );

    const field = await driver.findElement({ css: '.sidebar-unlock input[type="password"]' });
    await field.sendKeys(VAULT_PASSWORD);

    const unlock = await driver.findElement({ css: '.sidebar-unlock__actions .q-btn:last-child' });
    await unlock.click();

    await driver.wait(
      until.stalenessOf(field),
      30_000,
      'the unlock view never went away, so the vault did not unlock',
    );

    // #147 fixed this for lock and #181 for unlock: the panel navigated itself to the full-tab
    // dashboard, taking a 360px surface to a window it must never open (D2, S9).
    const panel = await driver.findElements({ css: '.sidebar-root' });
    expect(panel.length).toBeGreaterThan(0);

    const strayed = await driver.findElements({ css: '.vault-card, .dashboard-navigation' });
    expect(strayed).toHaveLength(0);
  });
});
