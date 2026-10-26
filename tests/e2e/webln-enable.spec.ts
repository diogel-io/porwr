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

/**
 * A WebLN call that fails rejects, rather than resolving with a failure object (porwr#370).
 *
 * `getInfo` needs no approval, so it reaches the page handler's failure path with no wallet and no
 * panel: the site has not enabled WebLN and the account has no wallet.
 */
test('getInfo for a site that has not enabled WebLN rejects', async ({ openPage, context }) => {
  const setup = await openPage('/login');
  await createVault(setup);
  await seedAccount(setup);

  const site = await context.newPage();
  await site.goto('https://example.com');
  const outcome = await site.evaluate(async () => {
    const webln = (window as unknown as { webln?: { getInfo: () => Promise<unknown> } }).webln;
    if (!webln) throw new Error('window.webln was not injected into the page');
    return webln.getInfo().then(
      (value: unknown) => ({ resolved: value }),
      (error: unknown) => ({ rejected: String(error) }),
    );
  });

  expect(outcome).toEqual({ rejected: expect.any(String) });

  await site.close();
});

/**
 * A payment that cannot be made rejects, rather than resolving with a failure object (porwr#370).
 *
 * The user approves the payment, and the account has no wallet, so it fails after approval in the
 * background. That failure used to reach the site as an ordinary result, so `sendPayment()`
 * resolved for a payment that was never made.
 */
test('sendPayment that fails after approval rejects', async ({ openPage, context }) => {
  const setup = await openPage('/login');
  await createVault(setup);
  await seedAccount(setup);

  const site = await context.newPage();
  await site.goto('https://example.com');
  await site.evaluate(() => {
    const webln = (
      window as unknown as { webln?: { sendPayment: (invoice: string) => Promise<unknown> } }
    ).webln;
    if (!webln) throw new Error('window.webln was not injected into the page');
    (window as unknown as { __paying?: Promise<unknown> }).__paying = webln
      .sendPayment('lnbc1u1pjqxyz')
      .then(
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
    () => (window as unknown as { __paying: Promise<unknown> }).__paying,
  );
  expect(outcome).toEqual({ rejected: expect.stringContaining('No wallet is configured') });

  await site.close();
});
