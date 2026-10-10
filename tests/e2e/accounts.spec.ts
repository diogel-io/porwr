import { readFile } from 'node:fs/promises';

import { nip19 } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';
import { TextWriter, Uint8ArrayReader, ZipReader } from '@zip.js/zip.js';

import { expect, test } from './fixtures/extension';
import { createVault, seedAccount, TEST_ACCOUNT } from './fixtures/vault';

/**
 * Account flows after pages stopped holding keys (#240).
 *
 * A page now sees accounts without their keys and asks the background for one change at a time. The
 * one way a private key reaches a page is the user asking for it: showing it, or exporting a backup.
 */

const TEST_NSEC = nip19.nsecEncode(hexToBytes(TEST_ACCOUNT.privkey));

test.describe('accounts', () => {
  test('the private key is fetched only when the user asks to see it, and dropped when hidden', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedAccount(page);

    await page.goto(page.url().replace(/#.*$/, `#/keys/${TEST_ACCOUNT.alias}`));
    const privateKey = page.getByLabel('Private Key', { exact: true });
    await expect(page.getByLabel('Public Key', { exact: true })).toHaveValue(nip19.npubEncode(TEST_ACCOUNT.pubkey));
    await expect(privateKey).not.toHaveValue(TEST_NSEC);

    await page.getByLabel('Show private key').click();
    await expect(privateKey).toHaveValue(TEST_NSEC);

    await page.getByLabel('Hide private key').click();
    await expect(privateKey).not.toHaveValue(TEST_NSEC);
  });

  test('importing an nsec on the Import page adds the account under its own public key', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);

    await page.goto(page.url().replace(/#.*$/, '#/keys/import'));
    await page.getByLabel('NSEC Private Key', { exact: true }).fill(TEST_NSEC);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByLabel('Profile Name', { exact: true }).fill('imported');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page).toHaveURL(/#\/keys\/imported$/);
    const view = (await page.evaluate(() => chrome.runtime.sendMessage({ type: 'vault.getView', payload: {} }))) as {
      accounts: { id: string; alias: string }[];
    };
    expect(view.accounts).toEqual([expect.objectContaining({ id: TEST_ACCOUNT.pubkey, alias: 'imported' })]);
    expect(JSON.stringify(view)).not.toContain(TEST_ACCOUNT.privkey);
  });

  test('exporting a backup writes the revealed nsec into the password-protected file', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedAccount(page);
    await page.goto(page.url().replace(/#.*$/, `#/keys/${TEST_ACCOUNT.alias}`));
    // The pages' CSP allows no WebAssembly (#247). If zip.js tried it and fell back, the export would
    // still pass, so a blocked attempt is recorded here instead.
    await page.evaluate(() => {
      const violations: string[] = [];
      Object.assign(window, { cspViolations: violations });
      document.addEventListener('securitypolicyviolation', (event) =>
        violations.push((event as SecurityPolicyViolationEvent).violatedDirective),
      );
    });

    await page.getByRole('button', { name: 'Export', exact: true }).first().click();
    await page.getByLabel('Password', { exact: true }).fill('backup-password');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('dialog').getByRole('button', { name: 'Export', exact: true }).click(),
    ]);

    const bytes = new Uint8Array(await readFile((await download.path())!));
    const reader = new ZipReader(new Uint8ArrayReader(bytes), { password: 'backup-password' });
    const [entry] = await reader.getEntries();
    if (!entry || entry.directory) throw new Error('the backup has no key file');
    const text = await entry.getData(new TextWriter());
    await reader.close();

    expect(text).toContain(`nsec (Private Key): ${TEST_NSEC}`);
    expect(text).toContain(nip19.npubEncode(TEST_ACCOUNT.pubkey));
    expect(await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations)).toEqual([]);
  });
});
