import type { Page, Worker } from '@playwright/test';

import { expect, test } from './fixtures/extension';
import { createVault, requestSignatureFromPage, seedAccount } from './fixtures/vault';

/**
 * The dashboard's Recent Activity shows what the user decided (diogel-io/workspace#37).
 *
 * It was filled from relays, with the events the account had published, so approvals given in
 * Porwr never appeared and the card said "No approvals or exceptions yet". It now reads the same
 * local approval log as Event History, and each request is logged once, when it is decided.
 */

const SITE = 'https://example.com';

/** Asks the page's provider for its key, holding the promise on the page. */
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

/** Decides the request the panel is showing, then waits for it to leave. */
async function decide(panel: Page, choice: RegExp): Promise<void> {
  await panel.locator('.current-request').waitFor({ state: 'visible', timeout: 20_000 });
  await panel.getByRole('button', { name: choice }).first().click();
  await expect(panel.locator('.current-request')).toHaveCount(0, { timeout: 25_000 });
}

/** Every stored approval row's outcome, read in the service worker. */
const storedOutcomes = (background: Worker) =>
  background.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('DiogelDatabase');
        open.onerror = () => reject(open.error ?? new Error('open failed'));
        open.onsuccess = () => {
          const read = open.result.transaction('approvals').objectStore('approvals').getAll();
          read.onerror = () => reject(read.error ?? new Error('read failed'));
          read.onsuccess = () => {
            open.result.close();
            resolve((read.result as { outcome?: string }[]).map((row) => row.outcome ?? ''));
          };
        };
      }),
  );

test('Recent Activity lists approvals and rejections, each logged once', async ({
  openPage,
  context,
  background,
}) => {
  const setup = await openPage('/login');
  await createVault(setup);
  await seedAccount(setup);

  const site = await context.newPage();
  await site.goto(SITE);
  const panel = await openPage('/sidebar');

  await askForPublicKey(site);
  await decide(panel, /approve/i);
  await requestSignatureFromPage(site);
  await decide(panel, /approve/i);
  await requestSignatureFromPage(site);
  await decide(panel, /reject/i);

  // One row per request, carrying what the user decided: no extra row from when the site asked.
  await expect.poll(() => storedOutcomes(background)).toHaveLength(3);
  expect((await storedOutcomes(background)).sort()).toEqual(['approved', 'approved', 'rejected']);

  const dashboard = setup;
  await dashboard.goto(dashboard.url().replace(/#.*$/, '#/dashboard'));
  await dashboard.reload();
  const card = dashboard.locator('.dashboard-card', { hasText: 'Recent Activity' });
  const rows = card.locator('.dashboard-widget-card__table-row');

  await expect(rows).toHaveCount(3, { timeout: 20_000 });
  await expect(card).not.toContainText('No approvals or exceptions yet');
  // Newest first: the rejected signature, then the approved one, then the public key.
  await expect(rows.nth(0)).toContainText('REJECTED');
  await expect(rows.nth(0)).toContainText('Kind 1: Note');
  await expect(rows.nth(1)).toContainText('APPROVED');
  await expect(rows.nth(2)).toContainText('Public key');
  await expect(rows.nth(2)).toContainText('APPROVED');
  await expect(rows.nth(2)).toContainText('example.com');
});
