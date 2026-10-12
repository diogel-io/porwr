import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from './fixtures/extension';
import { createVault, seedAccount, TEST_ACCOUNT } from './fixtures/vault';

/**
 * The unlocked vault outlives a worker restart, and its key is never readable bytes (#245).
 *
 * Porwr's pages can read `chrome.storage.session` and share the background's IndexedDB, so what is
 * stored there is checked from a page, the way a hostile script in one would see it.
 */

/** Stops the MV3 worker over CDP (Playwright cannot), then wakes it with a message. */
async function restartWorker(context: BrowserContext, page: Page): Promise<void> {
  const client = await context.newCDPSession(page);
  await client.send('ServiceWorker.enable');
  await client.send('ServiceWorker.stopAllWorkers');
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'ping' }));
}

const vaultView = (page: Page): Promise<{ accounts?: { id: string }[]; success?: boolean }> =>
  page.evaluate(() => chrome.runtime.sendMessage({ type: 'vault.getView', payload: {} }));

/** The `vaultSession` row as a page can read it straight from IndexedDB, or null. */
const storedVaultKey = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ extractable: boolean; exportable: boolean } | null>((resolve, reject) => {
        const open = indexedDB.open('DiogelDatabase');
        open.onerror = () => reject(open.error ?? new Error('open failed'));
        open.onsuccess = () => {
          const read = open.result
            .transaction('vaultSession')
            .objectStore('vaultSession')
            .get('current');
          read.onerror = () => reject(read.error ?? new Error('read failed'));
          read.onsuccess = () => {
            const row = read.result as { key: CryptoKey } | undefined;
            open.result.close();
            if (!row) return resolve(null);
            crypto.subtle.exportKey('raw', row.key).then(
              () => resolve({ extractable: row.key.extractable, exportable: true }),
              () => resolve({ extractable: row.key.extractable, exportable: false }),
            );
          };
        };
      }),
  );

test.describe('the unlocked vault (#245)', () => {
  test('keeps no key bytes where a page can read them', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedAccount(page);

    const session: Record<string, unknown> = await page.evaluate(() =>
      chrome.storage.session.get(null),
    );
    expect(session).not.toHaveProperty('vault:session-key');
    expect(session['vault:unlocked']).toBe(true);
    const rawKeyLike = Object.values(session).filter((value) => {
      if (typeof value !== 'string') return false;
      try {
        return atob(value).length === 32;
      } catch {
        return false;
      }
    });
    expect(rawKeyLike).toEqual([]);

    // The key is there to keep the vault unlocked, but a page that reaches it cannot take it away.
    expect(await storedVaultKey(page)).toEqual({ extractable: false, exportable: false });
  });

  test('stays unlocked across a worker restart, and locks after a browser restart', async ({
    openPage,
    context,
  }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedAccount(page);

    await restartWorker(context, page);
    await expect
      .poll(async () => (await vaultView(page)).accounts?.map((account) => account.id))
      .toEqual([TEST_ACCOUNT.pubkey]);

    // A browser restart empties session storage; IndexedDB survives it.
    await page.evaluate(() => chrome.storage.session.clear());
    await restartWorker(context, page);

    await expect.poll(async () => (await vaultView(page)).success).toBe(false);
    expect(await storedVaultKey(page)).toBeNull();
  });
});
