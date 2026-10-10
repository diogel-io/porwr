import type { Page } from '@playwright/test';
import { SimplePool, verifyEvent } from 'nostr-tools';
import type { Event } from 'nostr-tools';

import { expect, test } from './fixtures/relays';
import { createVault, TEST_ACCOUNT, seedAccounts as seedVaultAccounts } from './fixtures/vault';

/**
 * Porwr's pages have the background sign for them (#240).
 *
 * The pages used to sign with a private key they held. Now they send a template and get a signed
 * event back. This checks that through the real extension: a save on the Relays page reaches a relay
 * correctly signed, and the action signs as the account asked for, including one that is not active.
 */

const SECOND = {
  alias: 'second',
  privkey: '2'.repeat(64),
  pubkey: '466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27',
};

async function seedTwoAccounts(page: Page, fallbackRelay: string): Promise<void> {
  await seedVaultAccounts(page, [TEST_ACCOUNT, SECOND]);
  await page.evaluate((relay) => chrome.storage.local.set({ 'nostr:fallback-relays': [relay] }), fallbackRelay);
}

async function latest(relay: string, kind: number, author: string): Promise<Event | null> {
  const pool = new SimplePool();
  try {
    return await pool.get([relay], { kinds: [kind], authors: [author] }, { maxWait: 3_000 });
  } finally {
    pool.close([relay]);
  }
}

const signAs = (page: Page, accountPubkey: string, kind: number) =>
  page.evaluate(
    ([pubkey, eventKind]) =>
      chrome.runtime.sendMessage({
        type: 'account.signEvent',
        payload: { accountPubkey: pubkey, template: { kind: eventKind, content: 'from e2e', tags: [] } },
      }),
    [accountPubkey, kind] as const,
  ) as Promise<Event | { success: false; error: string }>;

test.describe('signing in the background', () => {
  test('the Relays page publishes a relay list the background signed', async ({ openPage, relays }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedTwoAccounts(page, relays.plain);

    await page.goto(page.url().replace(/#.*$/, '#/relays'));
    await page.reload();
    await page.getByLabel('Relay URL', { exact: true }).fill(relays.plain);
    await page.getByLabel('Relay URL', { exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Save Relay List' }).click();
    await expect(page.getByText('Relay list updated successfully')).toBeVisible();

    const event = await latest(relays.plain, 10002, TEST_ACCOUNT.pubkey);
    expect(event).not.toBeNull();
    expect(verifyEvent(event!)).toBe(true);
    expect(event!.tags).toEqual(expect.arrayContaining([expect.arrayContaining(['r', relays.plain])]));
  });

  test('signs as the account asked for, even when it is not active, and refuses other kinds', async ({ openPage, relays }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedTwoAccounts(page, relays.plain);

    const asSecond = (await signAs(page, SECOND.pubkey, 1)) as Event;
    expect(asSecond.pubkey).toBe(SECOND.pubkey);
    expect(verifyEvent(asSecond)).toBe(true);

    expect(await signAs(page, SECOND.pubkey, 4)).toMatchObject({ success: false });
    expect(await signAs(page, 'c'.repeat(64), 1)).toEqual({ success: false, error: 'Account not found' });
  });
});
