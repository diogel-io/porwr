import type { Page, Worker } from '@playwright/test';

import { expect, test } from './fixtures/extension';
import { createVault, lockVault, seedAccount, unlockVault, VAULT_PASSWORD } from './fixtures/vault';

/**
 * Restoring a vault explains itself and proves the backup's password before it writes (#313, #392).
 *
 * Before #313, Import opened a file picker and a single confirm, then wrote the backup over the
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

/** A backup file, in the shape Backup writes. */
const backupFile = (encryptedData: string) => ({
  name: 'diogel-vault-backup.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify({ version: 1, encryptedData, exportedAt: '2026-10-17' })),
});

/** From the Keys page to the vault restore page, the way the user gets there. */
async function openRestorePage(page: Page): Promise<void> {
  await goTo(page, '/keys');
  await page
    .getByTestId('vault-backup-restore')
    .getByRole('link', { name: 'Restore' })
    .or(page.getByTestId('vault-backup-restore').getByRole('button', { name: 'Restore' }))
    .first()
    .click();
  await expect(page.locator('.restore-vault-page')).toBeVisible();
  await expect(page).toHaveURL(/#\/keys\/vault\/restore$/);
}

async function restoreBackup(page: Page, encryptedData: string, password: string): Promise<void> {
  await page
    .locator('.restore-vault-page input[type="file"]')
    .setInputFiles(backupFile(encryptedData));
  await page.getByLabel("Backup's password", { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
}

test.describe('Vault Restore (#313, #392)', () => {
  test('explains the restore, refuses a wrong password, and only then replaces the vault', async ({
    openPage,
    background,
  }) => {
    const page = await openPage('/login');
    await createVault(page);
    // The backup is the empty vault; the account added next is what the restore must replace.
    const backup = await storedVault(background);
    await seedAccount(page);
    const current = await storedVault(background);
    expect(current).not.toBe(backup);

    await openRestorePage(page);
    const warning = page.getByTestId('vault-restore-warning');
    await expect(warning).toContainText('Everything in your current vault is erased');
    await expect(warning).toContainText('the password that was used when the backup was made');
    // Backing up is left to the Keys page; the note's only link is the documentation (#317, #392).
    const docs = warning.getByRole('link');
    await expect(docs).toHaveCount(1);
    await expect(docs).toHaveText('the documentation');
    await expect(docs).toHaveAttribute('href', 'https://diogel.io/docs/porwr');
    await expect(docs).toHaveAttribute('target', '_blank');
    await expect(page.getByRole('button', { name: 'Restore', exact: true })).toBeDisabled();

    // A wrong password is refused in place, and nothing is written.
    await restoreBackup(page, backup, `${VAULT_PASSWORD}-wrong`);
    await expect(page.getByTestId('vault-restore-error')).toContainText(
      'That password does not open this backup.',
    );
    await expect(page.locator('.restore-vault-page')).toBeVisible();
    expect(await storedVault(background)).toBe(current);

    // The current vault still opens with its own password.
    await lockVault(page);
    await unlockVault(page);
    expect(await storedVault(background)).toBe(current);

    // The right password replaces the vault and sends the user to unlock it.
    await openRestorePage(page);
    await restoreBackup(page, backup, VAULT_PASSWORD);
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

    await openRestorePage(page);
    await restoreBackup(page, 'not-a-vault', VAULT_PASSWORD);

    await expect(page.getByTestId('vault-restore-error')).toContainText(
      'This file is not a Porwr vault backup, or it is damaged.',
    );
    expect(await storedVault(background)).toBe(current);
  });
});
