import { readFile } from 'node:fs/promises';

import { nip19 } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';
import * as nip49 from 'nostr-tools/nip49';

import { expect, test } from './fixtures/extension';
import { createVault, seedAccount, TEST_ACCOUNT, VAULT_PASSWORD } from './fixtures/vault';

/**
 * Account flows after pages stopped holding keys (#240).
 *
 * A page now sees accounts without their keys and asks the background for one change at a time. The
 * one way a private key reaches a page is the user asking to see it, after giving the vault password
 * again (#141). An export is encrypted in the background, so the page receives only an ncryptsec.
 */

/** Answers the vault-password prompt that guards showing a key (#141). */
const confirmVaultPassword = async (page: import('@playwright/test').Page, password: string) => {
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type="password"]').fill(password);
  await dialog.getByRole('button', { name: 'Show key', exact: true }).click();
};

const TEST_NSEC = nip19.nsecEncode(hexToBytes(TEST_ACCOUNT.privkey));

test.describe('accounts', () => {
  test('the private key is fetched only when the user asks to see it, and dropped when hidden', async ({
    openPage,
  }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedAccount(page);

    await page.goto(page.url().replace(/#.*$/, `#/keys/${TEST_ACCOUNT.alias}`));
    const privateKey = page.getByLabel('Private Key', { exact: true });
    await expect(page.getByLabel('Public Key', { exact: true })).toHaveValue(
      nip19.npubEncode(TEST_ACCOUNT.pubkey),
    );
    await expect(privateKey).not.toHaveValue(TEST_NSEC);

    await page.getByLabel('Show private key').click();
    await confirmVaultPassword(page, VAULT_PASSWORD);
    await expect(privateKey).toHaveValue(TEST_NSEC);

    await page.getByLabel('Hide private key').click();
    await expect(privateKey).not.toHaveValue(TEST_NSEC);
  });

  test('a wrong vault password shows no key', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedAccount(page);

    await page.goto(page.url().replace(/#.*$/, `#/keys/${TEST_ACCOUNT.alias}`));
    await page.getByLabel('Show private key').click();
    await confirmVaultPassword(page, 'not-the-vault-password');

    await expect(page.getByText('Could not show the private key')).toBeVisible();
    await expect(page.getByLabel('Private Key', { exact: true })).not.toHaveValue(TEST_NSEC);
  });

  test('importing an nsec on the Import page adds the account under its own public key', async ({
    openPage,
  }) => {
    const page = await openPage('/login');
    await createVault(page);

    await page.goto(page.url().replace(/#.*$/, '#/keys/import'));
    await page.getByLabel('Private key (nsec or ncryptsec)', { exact: true }).fill(TEST_NSEC);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByLabel('Profile Name', { exact: true }).fill('imported');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page).toHaveURL(/#\/keys\/imported$/);
    const view = (await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'vault.getView', payload: {} }),
    )) as {
      accounts: { id: string; alias: string }[];
    };
    expect(view.accounts).toEqual([
      expect.objectContaining({ id: TEST_ACCOUNT.pubkey, alias: 'imported' }),
    ]);
    expect(JSON.stringify(view)).not.toContain(TEST_ACCOUNT.privkey);
  });

  test('exporting a backup writes an ncryptsec that decrypts to the key, and no nsec', async ({
    openPage,
  }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedAccount(page);
    await page.goto(page.url().replace(/#.*$/, `#/keys/${TEST_ACCOUNT.alias}`));
    // The pages' CSP allows no WebAssembly (#247). A dependency that tried it and fell back would
    // still pass, so a blocked attempt is recorded here instead.
    await page.evaluate(() => {
      const violations: string[] = [];
      Object.assign(window, { cspViolations: violations });
      document.addEventListener('securitypolicyviolation', (event) =>
        violations.push((event as SecurityPolicyViolationEvent).violatedDirective),
      );
    });

    await page.getByRole('button', { name: 'Export', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Password', { exact: true }).fill('backup-password');
    await dialog.getByLabel('Confirm password', { exact: true }).fill('backup-password');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: 'Export', exact: true }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^porwr-key-backup-\d{4}-\d{2}-\d{2}\.txt$/);
    const text = await readFile((await download.path())!, 'utf8');
    const ncryptsec = /ncryptsec1[0-9a-z]+/.exec(text)?.[0];
    if (!ncryptsec) throw new Error('the backup holds no ncryptsec');

    // Decrypted by an independent NIP-49 implementation, outside the extension.
    expect(Buffer.from(nip49.decrypt(ncryptsec, 'backup-password')).toString('hex')).toBe(
      TEST_ACCOUNT.privkey,
    );
    expect(() => nip49.decrypt(ncryptsec, 'wrong-password')).toThrow();
    expect(text).not.toContain(TEST_NSEC);
    expect(text).not.toContain(TEST_ACCOUNT.privkey);
    expect(text).not.toContain(TEST_ACCOUNT.alias);
    expect(text).toContain(nip19.npubEncode(TEST_ACCOUNT.pubkey));
    expect(
      await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations),
    ).toEqual([]);
  });

  test('importing an ncryptsec adds the account it encrypts', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);
    const ncryptsec = nip49.encrypt(hexToBytes(TEST_ACCOUNT.privkey), 'backup-password');

    await page.goto(page.url().replace(/#.*$/, '#/keys/import'));
    await page.getByLabel('Private key (nsec or ncryptsec)', { exact: true }).fill(ncryptsec);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page
      .getByLabel('Password for the encrypted key', { exact: true })
      .fill('backup-password');
    await page.getByLabel('Profile Name', { exact: true }).fill('restored');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page).toHaveURL(/#\/keys\/restored$/);
    const view = (await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'vault.getView', payload: {} }),
    )) as { accounts: { id: string; alias: string }[] };
    expect(view.accounts).toEqual([
      expect.objectContaining({ id: TEST_ACCOUNT.pubkey, alias: 'restored' }),
    ]);
  });
});
