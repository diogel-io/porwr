import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/extension';
import { createVault, TEST_ACCOUNT } from './fixtures/vault';

/**
 * A site connected as one account while another is active (diogel-io/workspace#23).
 *
 * A site keeps the account it first connected with (#116). Selecting another account in Porwr
 * changed nothing for that site and nothing said so, which looked like Porwr signing as the wrong
 * user. The prompt now says so and offers to reject and move the site; the site's next request then
 * comes from the active account.
 *
 * The idle panel's notice for the active tab is not driven here: the panel runs as a tab in these
 * tests, so the active tab is the panel itself and has no site origin. It is covered in the unit
 * suite (`SiteAccountNotice.test.ts`).
 */

/** A second fixed identity. The pubkey is for privkey `22…22`, computed once with nostr-tools. */
const SECOND_ACCOUNT = {
  alias: 'e2e-second',
  privkey: '2'.repeat(64),
  pubkey: '466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27',
};

const SITE = 'https://example.com';

async function seedTwoAccounts(page: Page): Promise<void> {
  const seeded = await page.evaluate(
    async (accounts) => {
      const result = (await chrome.runtime.sendMessage({
        type: 'vault.updateData',
        payload: {
          vaultData: {
            accounts: accounts.map((account) => ({
              id: account.pubkey,
              alias: account.alias,
              account: { privkey: account.privkey },
              createdAt: new Date().toISOString(),
            })),
          },
        },
      })) as { success?: boolean } | undefined;

      await chrome.storage.local.set({ 'nostr:active': accounts[0]?.alias });
      return result;
    },
    [TEST_ACCOUNT, SECOND_ACCOUNT],
  );

  if (!seeded || seeded.success === false) {
    throw new Error(`Could not seed the test accounts: ${JSON.stringify(seeded)}`);
  }
}

/** Asks the page's provider for its key, holding the promise on the page for later. */
async function askForPublicKey(site: Page): Promise<void> {
  await site.evaluate(() => {
    const provider = (window as unknown as { nostr?: { getPublicKey: () => Promise<string> } })
      .nostr;
    if (!provider) throw new Error('window.nostr was not injected into the page');
    (window as unknown as { __pubkey?: Promise<unknown> }).__pubkey = provider
      .getPublicKey()
      .catch((error: unknown) => ({ error: String(error) }));
  });
}

const publicKeyAnswer = (site: Page): Promise<unknown> =>
  site.evaluate(() => (window as unknown as { __pubkey: Promise<unknown> }).__pubkey);

test.describe('a site connected as an account that is not the active one', () => {
  test('the prompt says so, and Reject and use moves the site to the active account', async ({
    openPage,
    context,
  }) => {
    const setup = await openPage('/login');
    await createVault(setup);
    await seedTwoAccounts(setup);

    // The site connects while the first account is active, which binds it to that account.
    const site = await context.newPage();
    await site.goto(SITE);
    await askForPublicKey(site);

    const panel = await openPage('/sidebar');
    await panel.locator('.current-request').waitFor({ state: 'visible', timeout: 20_000 });
    await expect(panel.getByTestId('request-not-active')).toHaveCount(0);
    await panel
      .getByRole('button', { name: /approve/i })
      .first()
      .click();
    expect(await publicKeyAnswer(site)).toBe(TEST_ACCOUNT.pubkey);
    await expect(panel.locator('.current-request')).toHaveCount(0, { timeout: 25_000 });

    // The user selects the second account. The site is still bound to the first.
    await setup.evaluate(
      (alias) => chrome.storage.local.set({ 'nostr:active': alias }),
      SECOND_ACCOUNT.alias,
    );
    const binding = await setup.evaluate(
      (origin) => chrome.runtime.sendMessage({ type: 'sites.binding', payload: { origin } }),
      SITE,
    );
    expect(binding).toMatchObject({
      boundPubkey: TEST_ACCOUNT.pubkey,
      activePubkey: SECOND_ACCOUNT.pubkey,
      mismatch: true,
    });

    // The site asks again. The prompt names the bound account and says it is not the active one.
    await askForPublicKey(site);
    await panel.locator('.current-request').waitFor({ state: 'visible', timeout: 20_000 });
    await expect(panel.getByTestId('request-not-active')).toContainText(SECOND_ACCOUNT.alias);

    await panel.getByTestId('reject-and-switch').click();

    // Rejected: nothing was returned for either account.
    expect(await publicKeyAnswer(site)).toMatchObject({ error: expect.any(String) });
    await expect(panel.locator('.current-request')).toHaveCount(0, { timeout: 25_000 });

    const moved = await setup.evaluate(
      (origin) => chrome.runtime.sendMessage({ type: 'sites.binding', payload: { origin } }),
      SITE,
    );
    expect(moved).toMatchObject({ boundPubkey: SECOND_ACCOUNT.pubkey, mismatch: false });

    // The site's next request comes from the active account.
    await askForPublicKey(site);
    await panel.locator('.current-request').waitFor({ state: 'visible', timeout: 20_000 });
    await expect(panel.getByTestId('request-not-active')).toHaveCount(0);
    await panel
      .getByRole('button', { name: /approve/i })
      .first()
      .click();
    expect(await publicKeyAnswer(site)).toBe(SECOND_ACCOUNT.pubkey);

    await site.close();
  });

  test('a site cannot move itself', async ({ openPage, context }) => {
    const setup = await openPage('/login');
    await createVault(setup);
    await seedTwoAccounts(setup);

    const site = await context.newPage();
    await site.goto(SITE);

    // The provider exposes only the NIP-07 methods; there is no way to ask for the switch.
    const exposed = await site.evaluate(() => {
      const provider = (window as unknown as { nostr?: Record<string, unknown> }).nostr ?? {};
      return Object.keys(provider).some((key) => /site|account|bind/i.test(key));
    });
    expect(exposed).toBe(false);

    await site.close();
  });
});
