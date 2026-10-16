import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/extension';
import { createVault, seedAccounts, TEST_ACCOUNT } from './fixtures/vault';

/**
 * Each account has its own wallets (#304).
 *
 * Before this, one wallet connection served every account in the vault. Driven through the real
 * background and Wallet Management, so the scoping is shown end to end rather than in a mocked
 * handler. A connection string is imported rather than connected, because import does not contact
 * the wallet and so runs offline.
 *
 * The 0.2.x migration is covered by unit tests: a page cannot write the raw vault (#240), so there is
 * no way to plant an unowned connection from here.
 */

const SECOND_ACCOUNT = {
  alias: 'work',
  privkey: '2'.repeat(64),
  // Pinned, as TEST_ACCOUNT's is: computed once with nostr-tools from the private key above.
  pubkey: '466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27',
};

const NWC_URI =
  `nostr+walletconnect://${'b'.repeat(64)}?relay=${encodeURIComponent('wss://127.0.0.1:9/')}&secret=${'3'.repeat(64)}`;

async function importWalletFor(page: Page, accountPubkey: string, label: string): Promise<void> {
  const result = await page.evaluate(
    ({ accountPubkey, label, uri }) =>
      chrome.runtime.sendMessage({ type: 'nip47.connections.import', payload: { accountPubkey, uri, label } }),
    { accountPubkey, label, uri: NWC_URI },
  );
  if (!result || typeof result !== 'object' || (result as { label?: string }).label !== label) {
    throw new Error(`Could not import a wallet: ${JSON.stringify(result)}`);
  }
}

async function makeActive(page: Page, alias: string): Promise<void> {
  await page.evaluate((name) => chrome.storage.local.set({ 'nostr:active': name }), alias);
}

async function openWalletManagement(page: Page): Promise<void> {
  await page.goto(page.url().replace(/#.*$/, '#/wallet-connections'));
  await page.reload();
  await expect(page.getByTestId('wallet-account')).toBeVisible({ timeout: 20_000 });
}

test.describe('wallets per account (#304)', () => {
  test('a wallet added for one account is not another account’s', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedAccounts(page, [TEST_ACCOUNT, SECOND_ACCOUNT]);
    await importWalletFor(page, TEST_ACCOUNT.pubkey, 'Main wallet');

    await makeActive(page, SECOND_ACCOUNT.alias);
    await openWalletManagement(page);
    await expect(page.getByTestId('wallet-account')).toContainText(SECOND_ACCOUNT.alias);
    await expect(page.getByText('Main wallet')).toHaveCount(0);
    // No wallet, so the page offers to connect one for this account.
    await expect(page.getByTestId('connect-coinos')).toBeVisible();

    // Switching account in place reloads that account's wallets.
    await makeActive(page, TEST_ACCOUNT.alias);
    await expect(page.getByTestId('wallet-account')).toContainText(TEST_ACCOUNT.alias);
    await expect(page.getByText('Main wallet').first()).toBeVisible();
  });

  test('the background refuses another account’s connection, and wallet calls that name no account', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedAccounts(page, [TEST_ACCOUNT, SECOND_ACCOUNT]);
    await importWalletFor(page, TEST_ACCOUNT.pubkey, 'Main wallet');

    const answers = await page.evaluate(
      async ({ main, second }) => {
        const send = (type: string, payload: unknown) => chrome.runtime.sendMessage({ type, payload });
        const [connection] = (await send('nip47.connections.list', { accountPubkey: main })) as Array<{ id: string }>;
        return {
          mainCount: ((await send('nip47.connections.list', { accountPubkey: main })) as unknown[]).length,
          secondList: await send('nip47.connections.list', { accountPubkey: second }),
          crossBalance: await send('nip47.getBalance', { accountPubkey: second, connectionId: connection!.id }),
          noAccount: await send('nip47.connections.list', {}),
        };
      },
      { main: TEST_ACCOUNT.pubkey, second: SECOND_ACCOUNT.pubkey },
    );

    expect(answers.mainCount).toBe(1);
    expect(answers.secondList).toEqual([]);
    expect(answers.crossBalance).toMatchObject({ success: false, error: 'NIP-47 connection not found' });
    expect(answers.noAccount).toMatchObject({ success: false });
  });

  test('removing an account removes its wallets', async ({ openPage }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedAccounts(page, [TEST_ACCOUNT, SECOND_ACCOUNT]);
    await importWalletFor(page, SECOND_ACCOUNT.pubkey, 'Work wallet');

    const after = await page.evaluate(
      async ({ second }) => {
        await chrome.runtime.sendMessage({ type: 'accounts.remove', payload: { accountPubkey: second } });
        // Re-adding the same key must not bring the old wallet back with it.
        await chrome.runtime.sendMessage({ type: 'accounts.add', payload: { alias: 'work', privkey: '2'.repeat(64) } });
        return chrome.runtime.sendMessage({ type: 'nip47.connections.list', payload: { accountPubkey: second } });
      },
      { second: SECOND_ACCOUNT.pubkey },
    );

    expect(after).toEqual([]);
  });
});
