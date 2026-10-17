import type { Page, Worker } from '@playwright/test';

import { expect, test } from './fixtures/extension';
import { createVault, lockVault, seedAccount, unlockVault, VAULT_PASSWORD } from './fixtures/vault';

/**
 * Importing a vault explains itself and proves the backup's password before it writes (#313).
 *
 * Before this, Import opened a file picker and a single confirm, then wrote the backup over the
 * vault without ever trying its password. These drive the real page and check the stored vault in
 * the background, which is the only place that shows whether anything was overwritten.
 */

/** The stored vault's encrypted data, read in the service worker. */
const storedVault = (background: Worker) =>
  background.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open('DiogelDatabase');
        open.onerror = () => reject(open.error ?? new Error('open failed'));
        open.onsuccess = () => {
          const read = open.result.transaction('vaults').objectStore('vaults').get('master');
          read.onerror = () => reject(read.error ?? new Error('read failed'));
          read.onsuccess = () => {
            open.result.close();
            resolve((read.result as { encryptedData: string }).encryptedData);
          };
        };
      }),
  );

async function goTo(page: Page, hash: string): Promise<void> {
  await page.goto(page.url().replace(/#.*$/, `#${hash}`));
  await page.reload();
}

/** A backup file, in the shape Export writes. */
const backupFile = (encryptedData: string) => ({
  name: 'diogel-vault-backup.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify({ version: 1, encryptedData, exportedAt: '2026-10-17' })),
});

/** From the Keys page to the Import vault page, the way the user gets there. */
async function openImportPage(page: Page): Promise<void> {
  await goTo(page, '/keys');
  await page
    .getByTestId('vault-backup-import')
    .getByRole('link', { name: 'Import' })
    .or(page.getByTestId('vault-backup-import').getByRole('button', { name: 'Import' }))
    .first()
    .click();
  await expect(page.locator('.import-vault-page')).toBeVisible();
}

async function importBackup(page: Page, encryptedData: string, password: string): Promise<void> {
  await page
    .locator('.import-vault-page input[type="file"]')
    .setInputFiles(backupFile(encryptedData));
  await page.getByLabel("Backup's password", { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Replace my vault' }).click();
}

test.describe('Import vault (#313)', () => {
  test('explains the import, refuses a wrong password, and only then replaces the vault', async ({
    openPage,
    background,
  }) => {
    const page = await openPage('/login');
    await createVault(page);
    // The backup is the empty vault; the account added next is what the import must replace.
    const backup = await storedVault(background);
    await seedAccount(page);
    const current = await storedVault(background);
    expect(current).not.toBe(backup);

    await openImportPage(page);
    const warning = page.getByTestId('vault-import-warning');
    await expect(warning).toContainText('Everything in your current vault is erased');
    await expect(warning).toContainText('the password that was used when the backup was made');
    // Exporting is left to the Keys page, so the import has only one action on screen (#317).
    await expect(warning.getByRole('link')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Replace my vault' })).toBeDisabled();

    // A wrong password is refused in place, and nothing is written.
    await importBackup(page, backup, `${VAULT_PASSWORD}-wrong`);
    await expect(page.getByTestId('vault-import-error')).toContainText(
      'That password does not open this backup.',
    );
    await expect(page.locator('.import-vault-page')).toBeVisible();
    expect(await storedVault(background)).toBe(current);

    // The current vault still opens with its own password.
    await lockVault(page);
    await unlockVault(page);
    expect(await storedVault(background)).toBe(current);

    // The right password replaces the vault and sends the user to unlock it.
    await openImportPage(page);
    await importBackup(page, backup, VAULT_PASSWORD);
    await expect(page.getByText('Your vault was replaced from the backup.')).toBeVisible();
    await expect(page).toHaveURL(/#\/login/);
    expect(await storedVault(background)).toBe(backup);

    await unlockVault(page);
    expect(await storedVault(background)).toBe(backup);
  });

  test('refuses a file that is not a Porwr backup and leaves the vault as it was', async ({
    openPage,
    background,
  }) => {
    const page = await openPage('/login');
    await createVault(page);
    const current = await storedVault(background);

    await openImportPage(page);
    await importBackup(page, 'not-a-vault', VAULT_PASSWORD);

    await expect(page.getByTestId('vault-import-error')).toContainText(
      'This file is not a Porwr vault backup, or it is damaged.',
    );
    expect(await storedVault(background)).toBe(current);
  });
});
