import { expect, test } from './fixtures/extension';
import { createVault, seedAccount } from './fixtures/vault';

/**
 * `webln.enable()` rejects when Porwr cannot enable WebLN (porwr#369).
 *
 * The background used to return a handler's failure, so it reached the page as an ordinary result
 * and `enable()` resolved: a site with no wallet behind it was told WebLN was ready. The page handler
 * cannot be imported in a unit test, so this runs the whole path: the site asks, the user approves,
 * and the account has no wallet.
 */
test('enabling WebLN with no wallet rejects, even once the user has approved', async ({
  openPage,
  context,
}) => {
  const setup = await openPage('/login');
  await createVault(setup);
  await seedAccount(setup);

  const site = await context.newPage();
  await site.goto('https://example.com');
  await site.evaluate(() => {
    const webln = (window as unknown as { webln?: { enable: () => Promise<unknown> } }).webln;
    if (!webln) throw new Error('window.webln was not injected into the page');
    (window as unknown as { __enabling?: Promise<unknown> }).__enabling = webln.enable().then(
      (value: unknown) => ({ resolved: value }),
      (error: unknown) => ({ rejected: String(error) }),
    );
  });

  const panel = await openPage('/sidebar');
  await panel.locator('.current-request').waitFor({ state: 'visible', timeout: 20_000 });
  await panel
    .getByRole('button', { name: /approve/i })
    .first()
    .click();

  const outcome = await site.evaluate(
    () => (window as unknown as { __enabling: Promise<unknown> }).__enabling,
  );
  expect(outcome).toEqual({ rejected: expect.stringContaining('No wallet is configured') });

  await site.close();
});
