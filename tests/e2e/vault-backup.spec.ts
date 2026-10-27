import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/extension';
import { createVault } from './fixtures/vault';

/**
 * Backing up goes through the Vault Backup page and the browser's Save As dialog (#314, #391).
 *
 * Playwright cannot drive the browser's native Save As dialog, so `chrome.downloads` is replaced on
 * the page with a recorder that answers the way the browser would. That still proves the real page
 * reaches the downloads API with `saveAs: true` and the backup's name and contents, and shows each
 * outcome. The dialog itself is checked by hand.
 */

interface RecordedDownload {
  filename: string;
  saveAs: boolean;
  backup: { version: number; encryptedData: string; exportedAt: string };
}

/** Replaces `chrome.downloads` on the page; `outcome` decides how the "dialog" ends. */
async function recordDownloads(page: Page, outcome: 'saved' | 'cancelled'): Promise<void> {
  await page.evaluate((ending) => {
    const listeners = new Set<(change: unknown) => void>();
    const recorded: unknown[] = [];
    (window as unknown as { recordedDownloads: unknown[] }).recordedDownloads = recorded;
    const downloads = chrome.downloads as unknown as Record<string, unknown>;
    downloads.onChanged = {
      addListener: (listener: (change: unknown) => void) => listeners.add(listener),
      removeListener: (listener: (change: unknown) => void) => listeners.delete(listener),
    };
    downloads.search = () => Promise.resolve([{ filename: '/home/e2e/Backups/vault.json' }]);
    downloads.download = async (options: { url: string; filename: string; saveAs: boolean }) => {
      const backup: unknown = await fetch(options.url).then((response) => response.json());
      recorded.push({ filename: options.filename, saveAs: options.saveAs, backup });
      if (ending === 'cancelled') throw new Error('Download canceled');
      setTimeout(() => listeners.forEach((l) => l({ id: 1, state: { current: 'complete' } })), 0);
      return 1;
    };
  }, outcome);
}

const recorded = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { recordedDownloads: RecordedDownload[] }).recordedDownloads,
  );

async function openBackupPage(page: Page): Promise<void> {
  await page.goto(page.url().replace(/#.*$/, '#/keys'));
  await page.reload();
  await page
    .getByTestId('vault-backup-backup')
    .getByRole('link', { name: 'Backup' })
    .or(page.getByTestId('vault-backup-backup').getByRole('button', { name: 'Backup' }))
    .first()
    .click();
  await expect(page.locator('.backup-vault-page')).toBeVisible();
  await expect(page).toHaveURL(/#\/keys\/vault\/backup$/);
}

test.describe('Vault Backup (#314, #391)', () => {
  test('explains the backup, then saves it through a Save As dialog', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);
    await openBackupPage(page);

    const info = page.getByTestId('vault-backup-info');
    await expect(info).toContainText('Important');
    await expect(info).toContainText('encrypted copy of your entire vault');
    await expect(info).toContainText('can only be restored using its current password');
    await expect(info).toContainText('nobody will be able to open the backup');
    await expect(info).toContainText('somewhere safe, ideally offline');
    await expect(info).toContainText('Never keep your backup in the same place as the password.');
    // The note's only link is the documentation, opened in a new tab (#391).
    const docs = info.getByRole('link');
    await expect(docs).toHaveCount(1);
    await expect(docs).toHaveText('the documentation');
    await expect(docs).toHaveAttribute('href', 'https://diogel.io/docs/porwr');
    await expect(docs).toHaveAttribute('target', '_blank');
    await expect(page.getByTestId('vault-backup-confirm')).toHaveAccessibleName('Backup');
    // Reaching the page saves nothing by itself.
    await expect(page.getByTestId('vault-backup-outcome')).toHaveCount(0);

    await recordDownloads(page, 'saved');
    await page.getByTestId('vault-backup-confirm').click();

    await expect(page.getByTestId('vault-backup-outcome')).toContainText('Backup saved.');
    await expect(page.getByTestId('vault-backup-outcome')).toContainText(
      '/home/e2e/Backups/vault.json',
    );
    const [download] = await recorded(page);
    expect(download!.saveAs).toBe(true);
    expect(download!.filename).toMatch(/^diogel-vault-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(download!.backup).toEqual({
      version: 1,
      encryptedData: expect.stringMatching(/^v2:/),
      exportedAt: expect.any(String),
    });
  });

  test('says plainly that nothing was saved when the dialog is cancelled', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);
    await openBackupPage(page);

    await recordDownloads(page, 'cancelled');
    await page.getByTestId('vault-backup-confirm').click();

    const outcome = page.getByTestId('vault-backup-outcome');
    await expect(outcome).toHaveAttribute('data-status', 'cancelled');
    await expect(outcome).toContainText('Not saved. Nothing was written.');
    await expect(outcome.getByRole('alert')).toHaveCount(0);
  });
});
