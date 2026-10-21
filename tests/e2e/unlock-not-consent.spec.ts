import { expect, test } from './fixtures/extension';
import {
  createVault,
  lockVault,
  requestSignatureFromPage,
  seedAccount,
  VAULT_PASSWORD,
} from './fixtures/vault';

/**
 * Unlocking the vault never approves the request that was waiting for it (D14, threat model T8,
 * #144).
 *
 * The request arrives while the vault is locked. The user unlocks in the panel, and the request
 * must then be presented for a decision, with the page still waiting and holding no signature.
 */

/** A signed Nostr event carries `sig`. Anything without one is not a signature. */
const isSignature = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { sig?: unknown }).sig === 'string';

test('a request made while locked still needs a decision after unlock', async ({
  openPage,
  openPanel,
  background,
  context,
}) => {
  const setup = await openPage('/login');
  await createVault(setup);
  await seedAccount(setup);
  await lockVault(setup);

  const site = await context.newPage();
  await site.goto('https://example.com');
  await requestSignatureFromPage(site);

  await expect
    .poll(() => background.evaluate(() => chrome.action.getBadgeText({})), { timeout: 15_000 })
    .toBe('1');

  const panel = await openPanel();
  await expect(panel.getByText('Unlocking does not approve it.')).toBeVisible({ timeout: 30_000 });
  await panel.getByLabel('Password').fill(VAULT_PASSWORD);
  await panel.getByRole('button', { name: 'Unlock', exact: true }).click();

  // Presented for a decision, not decided.
  await panel.locator('.current-request').waitFor({ state: 'visible', timeout: 30_000 });
  await expect(panel.getByRole('button', { name: /approve/i }).first()).toBeVisible();

  // The page is still waiting: its promise has not settled at all.
  const settled = await site.evaluate(() =>
    Promise.race([
      (window as unknown as { __signing: Promise<unknown> }).__signing.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 1_000)),
    ]),
  );
  expect(settled).toBe(false);
  await expect.poll(() => background.evaluate(() => chrome.action.getBadgeText({}))).toBe('1');

  // Rejecting settles it, and not with a signature.
  await panel.getByRole('button', { name: 'Reject', exact: true }).first().click();
  const outcome = await site.evaluate(
    () => (window as unknown as { __signing: Promise<unknown> }).__signing,
  );
  expect(isSignature(outcome)).toBe(false);

  await site.close();
});
