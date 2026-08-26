import { expect, test } from './fixtures/extension';
import { createVault, lockVault, seedAccount, VAULT_PASSWORD } from './fixtures/vault';

/**
 * Answers the question that could not be asked before this harness existed: what does the panel
 * actually render, in a real browser, in each vault state?
 *
 * #113 hit this directly — the panel appeared to redirect to the full-tab login page, and there was
 * no way to tell an intended onboarding redirect from a surface-boundary bug.
 */
test.describe('the panel across vault states', () => {
  test('shows the panel once a vault exists and is unlocked', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);

    await page.goto(page.url().replace(/#.*$/, '#/sidebar'));

    await expect(page.locator('.sidebar-root')).toBeVisible();
    await expect(page.locator('.sidebar-header')).toBeVisible();
    expect(page.url()).toContain('#/sidebar');
  });

  test('renders its own unlock view when the vault is locked, never the full-tab login page', async ({
    openPage,
  }) => {
    const page = await openPage('/login');
    await createVault(page);
    await lockVault(page);

    await page.goto(page.url().replace(/#.*$/, '#/sidebar'));

    // S2: the panel owns the locked state. A redirect to /login here would be the surface-boundary
    // violation #113 suspected.
    await expect(page.locator('.sidebar-unlock')).toBeVisible();
    expect(page.url()).toContain('#/sidebar');
  });
});

/**
 * The no-vault state (#158).
 *
 * The approval contract names S16 as "no account configured" — a vault that exists and is unlocked
 * but holds no keys. It says nothing about there being no vault at all, which is why this went
 * unnoticed: the panel fell through to its unlock view and offered to unlock nothing.
 */
test.describe('the panel with no vault', () => {
  test('settles on the panel deterministically rather than racing a redirect', async ({
    openPage,
  }) => {
    const page = await openPage('/sidebar');

    expect(page.url()).toContain('#/sidebar');
    await expect(page.locator('.sidebar-root')).toBeVisible();
  });

  test('never offers to unlock a vault that does not exist', async ({ openPage }) => {
    const page = await openPage('/sidebar');

    await expect(page.locator('.sidebar-unlock')).toHaveCount(0);
    await expect(page.getByText('Unlock Vault')).toHaveCount(0);
  });

  test('prompts to set Porwr up instead', async ({ openPage }) => {
    const page = await openPage('/sidebar');

    // S17. What the prompt leads to — the creation form, in the panel rather than a tab — is
    // covered in `panel-onboarding.spec.ts` (#198).
    await expect(page.locator('.sidebar-setup')).toBeVisible();
  });
});

/**
 * The panel must never navigate itself to a dashboard surface (#116).
 *
 * Unlocking in the panel used to push to `dashboard`, so the full-tab dashboard rendered inside a
 * 360px column. Asserted end to end because it is a router behaviour in a real extension page, and
 * because it is the failure a user actually sees.
 */
test.describe('the panel keeps itself', () => {
  test('stays on the panel after unlocking, and shows the panel again', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);
    await lockVault(page);

    await page.goto(page.url().replace(/#.*$/, '#/sidebar'));
    await page.locator('.sidebar-unlock').waitFor({ state: 'visible' });

    await page.getByLabel('Password', { exact: true }).fill(VAULT_PASSWORD);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();

    // The panel re-renders from vault state rather than navigating anywhere.
    await expect(page.locator('.sidebar-root')).toBeVisible();
    await expect(page.locator('.sidebar-unlock')).toHaveCount(0);
    expect(page.url()).toContain('#/sidebar');
  });

  /**
   * #211.
   *
   * These are the steps the test above already performed, and it asserted only that the unlock view
   * had gone — which it had. What it never checked was the screen that replaced it, and against a
   * vault with no accounts in it "no active account" was the right answer anyway, so the assertion
   * could not have failed even in principle. The account is seeded here for that reason.
   */
  test('shows the account after unlocking with the panel already open', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedAccount(page);
    await lockVault(page);

    await page.goto(page.url().replace(/#.*$/, '#/sidebar'));
    await page.locator('.sidebar-unlock').waitFor({ state: 'visible' });

    await page.getByLabel('Password', { exact: true }).fill(VAULT_PASSWORD);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();

    // The panel hydrated its accounts from a locked vault and never looked again, so it told a user
    // with an account that they had none.
    await expect(page.locator('.sidebar-home__account')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('No active account')).toHaveCount(0);
  });

  test('never renders a dashboard surface inside the panel', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);
    await page.goto(page.url().replace(/#.*$/, '#/sidebar'));
    await page.locator('.sidebar-root').waitFor({ state: 'visible' });

    // The dashboard's own chrome. Any of it here means a full-tab surface reached the panel.
    await expect(page.locator('.dashboard-page-shell')).toHaveCount(0);
    await expect(page.locator('.dashboard-topbar')).toHaveCount(0);
    await expect(page.locator('.main-navigation')).toHaveCount(0);
  });
});
