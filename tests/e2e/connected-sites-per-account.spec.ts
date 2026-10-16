import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from './fixtures/extension';
import { createVault, TEST_ACCOUNT, seedAccounts } from './fixtures/vault';

/**
 * Connected Sites shows one account's sites at a time (#309).
 *
 * It listed every account's sites, so a user managing one account could disconnect another's. Each
 * site is connected through the real provider and approved in the real panel, so the bindings are
 * the ones signing actually makes.
 */

/** A second fixed identity. The pubkey is for privkey `22…22`, computed once with nostr-tools. */
const SECOND_ACCOUNT = {
  alias: 'e2e-second',
  privkey: '2'.repeat(64),
  pubkey: '466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27',
};

const FIRST_SITE = 'https://example.com';
const SECOND_SITE = 'https://example.org';

async function makeActive(page: Page, alias: string): Promise<void> {
  await page.evaluate((name) => chrome.storage.local.set({ 'nostr:active': name }), alias);
}

/** Connects `origin` as whichever account is active, by approving its getPublicKey in the panel. */
async function connect(context: BrowserContext, panel: Page, origin: string): Promise<void> {
  const site = await context.newPage();
  await site.goto(origin);
  await site.evaluate(() => {
    const provider = (window as unknown as { nostr?: { getPublicKey: () => Promise<string> } }).nostr;
    if (!provider) throw new Error('window.nostr was not injected into the page');
    (window as unknown as { __pubkey?: Promise<unknown> }).__pubkey = provider.getPublicKey();
  });
  await panel.locator('.current-request').waitFor({ state: 'visible', timeout: 20_000 });
  await panel.getByRole('button', { name: /approve/i }).first().click();
  await site.evaluate(() => (window as unknown as { __pubkey: Promise<unknown> }).__pubkey);
  await expect(panel.locator('.current-request')).toHaveCount(0, { timeout: 25_000 });
  await site.close();
}

const boundTo = (page: Page, origin: string) =>
  page.evaluate(
    async (site) =>
      ((await chrome.runtime.sendMessage({ type: 'sites.binding', payload: { origin: site } })) as {
        boundPubkey?: string;
      } | null)?.boundPubkey ?? null,
    origin,
  );

test.describe('Connected Sites per account (#309)', () => {
  test('lists only the active account’s sites, and disconnects only for that account', async ({
    openPage,
    context,
  }) => {
    const setup = await openPage('/login');
    await createVault(setup);
    await seedAccounts(setup, [TEST_ACCOUNT, SECOND_ACCOUNT]);
    const panel = await openPage('/sidebar');

    // One site connected as each account.
    await connect(context, panel, FIRST_SITE);
    await makeActive(setup, SECOND_ACCOUNT.alias);
    await connect(context, panel, SECOND_SITE);
    expect(await boundTo(setup, FIRST_SITE)).toBe(TEST_ACCOUNT.pubkey);
    expect(await boundTo(setup, SECOND_SITE)).toBe(SECOND_ACCOUNT.pubkey);

    await setup.goto(setup.url().replace(/#.*$/, '#/connected-sites'));
    await setup.reload();
    const account = setup.getByTestId('sites-account');
    await expect(account).toContainText(SECOND_ACCOUNT.alias, { timeout: 20_000 });
    await expect(setup.getByText(SECOND_SITE, { exact: true })).toBeVisible();
    await expect(setup.getByText(FIRST_SITE, { exact: true })).toHaveCount(0);

    // Switching account in place lists the other account's site instead.
    await makeActive(setup, TEST_ACCOUNT.alias);
    await expect(account).toContainText(TEST_ACCOUNT.alias);
    await expect(setup.getByText(FIRST_SITE, { exact: true })).toBeVisible();
    await expect(setup.getByText(SECOND_SITE, { exact: true })).toHaveCount(0);

    // Disconnecting here touches this account's site only.
    await setup.getByRole('button', { name: 'Disconnect', exact: true }).first().click();
    await setup.getByRole('dialog').getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(setup.getByText(FIRST_SITE, { exact: true })).toHaveCount(0);

    expect(await boundTo(setup, FIRST_SITE)).toBeNull();
    expect(await boundTo(setup, SECOND_SITE)).toBe(SECOND_ACCOUNT.pubkey);
  });
});
