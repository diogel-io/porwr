import { expect, test } from './fixtures/extension';
import { createVault, requestSignatureFromPage, seedAccount } from './fixtures/vault';

/**
 * The expired and interrupted notice (S13, S14, diogel-io/workspace#97).
 *
 * The request the user is reading must not vanish when it expires or is interrupted. The panel
 * says what happened and offers only Dismiss, while the badge drops at once, because the notice is
 * not pending. Before this, the queue reads dropped every terminal record and the panel moved on
 * without a word.
 *
 * End to end because the notice lives in the seam this suite exists for: the background holds it,
 * the panel re-reads on a push, and a unit test mocks both sides of that away.
 *
 * Expiry is reached by ageing the stored record, as in `fail-closed.spec.ts`: the floor on the
 * expiry setting is a minute, and only the clock is shortcut.
 */

const QUEUE_KEY = 'nostr:request-queue';

test.describe('the request on screen', () => {
  test('shows an expired notice when it expires, then Dismiss moves on', async ({
    openPage,
    background,
    context,
  }) => {
    const setup = await openPage('/login');
    await createVault(setup);
    await seedAccount(setup);

    const site = await context.newPage();
    await site.goto('https://example.com');
    await requestSignatureFromPage(site);

    const panel = await openPage('/sidebar');
    await panel.locator('.current-request').waitFor({ state: 'visible', timeout: 20_000 });

    const aged = await background.evaluate(async (key) => {
      const stored = (await chrome.storage.session.get(key)) as Record<string, unknown>;
      const records = stored[key] as Array<{ expiresAt: number; state: string }> | undefined;
      if (!records?.length) return [];
      await chrome.storage.session.set({
        [key]: records.map((record) => ({ ...record, expiresAt: Date.now() - 1_000 })),
      });
      return records.map((record) => record.state);
    }, QUEUE_KEY);

    // Only a request the user was looking at raises a notice, so it must have been presented.
    expect(aged).toEqual(['presented']);

    // Any read applies expiry; the write it causes is what tells the panel to re-read.
    await setup.evaluate(() => chrome.runtime.sendMessage({ type: 'nostr.requests.count' }));

    const notice = panel.locator('.current-request__terminal');
    await expect(notice).toContainText(/expired/i, { timeout: 15_000 });
    await expect(panel.getByRole('button', { name: /approve/i })).toHaveCount(0);

    // The badge does not wait for the dismissal: the notice is not pending.
    await expect
      .poll(() => background.evaluate(() => chrome.action.getBadgeText({})), { timeout: 15_000 })
      .toBe('');

    await panel.getByTestId('dismiss-notice').click();

    await expect(panel.locator('.current-request')).toHaveCount(0, { timeout: 15_000 });

    await site.close();
  });

  test('shows an interrupted notice when its page goes away', async ({ openPage, context }) => {
    const setup = await openPage('/login');
    await createVault(setup);
    await seedAccount(setup);

    const site = await context.newPage();
    await site.goto('https://example.com');
    await requestSignatureFromPage(site);

    const panel = await openPage('/sidebar');
    await panel.locator('.current-request').waitFor({ state: 'visible', timeout: 20_000 });

    // The last tab holding the origin closes, which interrupts its requests (D7).
    await site.close();

    await expect(panel.locator('.current-request__terminal')).toContainText(/interrupted/i, {
      timeout: 15_000,
    });

    await panel.getByTestId('dismiss-notice').click();

    await expect(panel.locator('.current-request')).toHaveCount(0, { timeout: 15_000 });
  });
});
