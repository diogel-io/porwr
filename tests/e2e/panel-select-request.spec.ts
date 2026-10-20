import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures/extension';
import { createVault, seedAccount } from './fixtures/vault';

/**
 * Choosing a request from the pending list (S7, porwr#334).
 *
 * The panel set the choice locally and then re-read the background, which still answered with
 * the request it had presented, so a click never switched. End to end because the bug was in that
 * seam: each side passed its unit tests on its own.
 */

const QUEUE_KEY = 'nostr:request-queue';

/** A kind 1 note whose content names it, so the panel shows which request is current. */
async function requestSignature(site: Page, label: string): Promise<void> {
  await site.evaluate((content) => {
    const provider = (
      window as unknown as { nostr?: { signEvent: (event: unknown) => Promise<unknown> } }
    ).nostr;
    if (!provider) throw new Error('window.nostr was not injected into the page');
    void provider
      .signEvent({ kind: 1, content, tags: [], created_at: Math.floor(Date.now() / 1000) })
      .catch(() => undefined);
  }, label);
}

const queuedStates = (background: Worker) =>
  background.evaluate(async (key) => {
    const stored = (await chrome.storage.session.get(key)) as Record<string, unknown>;
    const records = (stored[key] as Array<{ state: string }> | undefined) ?? [];
    return records.map((record) => record.state);
  }, QUEUE_KEY);

test.describe('the pending list', () => {
  test('switches to the request chosen from it, and stays there', async ({
    openPage,
    background,
    context,
  }) => {
    const setup = await openPage('/login');
    await createVault(setup);
    await seedAccount(setup);

    const site = await context.newPage();
    await site.goto('https://example.com');
    await requestSignature(site, 'REQUEST-A');
    // Queue order is by creation, so the second request must be created after the first.
    await expect.poll(() => queuedStates(background), { timeout: 15_000 }).toHaveLength(1);
    await requestSignature(site, 'REQUEST-B');
    await expect.poll(() => queuedStates(background), { timeout: 15_000 }).toHaveLength(2);

    const panel = await openPage('/sidebar');
    const request = panel.locator('.current-request');
    await expect(request).toContainText('REQUEST-A', { timeout: 20_000 });

    const items = panel.locator('.pending-list__item');
    await expect(items).toHaveCount(2);
    await items.nth(1).click();

    await expect(request).toContainText('REQUEST-B', { timeout: 15_000 });
    await expect(items.nth(1)).toHaveClass(/pending-list__item--current/);
    // The background holds the choice, so only the chosen request is presented.
    await expect
      .poll(() => queuedStates(background), { timeout: 15_000 })
      .toEqual(['queued', 'presented']);

    // A request arriving afterwards makes the panel re-read; the choice must survive that.
    await requestSignature(site, 'REQUEST-C');
    await expect(items).toHaveCount(3, { timeout: 15_000 });
    await expect(request).toContainText('REQUEST-B');

    await site.close();
  });
});
