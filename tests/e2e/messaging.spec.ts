import type { Page } from '@playwright/test';
import { finalizeEvent, SimplePool } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';

import { expect, test } from './fixtures/relays';
import { createVault, TEST_ACCOUNT } from './fixtures/vault';

/**
 * NIP-17 messaging end to end: two accounts in one extension, talking through local relays (#227).
 *
 * The inbox relay requires NIP-42 AUTH for everything, so every message read or delivered here
 * proves the background authenticated as the right account.
 */

const ALICE = TEST_ACCOUNT;
const BOB = {
  alias: 'bob',
  privkey: '2'.repeat(64),
  pubkey: '466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27',
};
/** A contact with no kind 10050, so nobody can message them. Not an account in the vault. */
const CAROL_PUBKEY = '3c72addb4fdf09af94f0c94d7fe92a386a7e70cf8a1d85916386bb2535c7b1b1';

async function seedAccounts(page: Page, fallbackRelay: string): Promise<void> {
  await page.evaluate(
    async ([accounts, relay]) => {
      const result = (await chrome.runtime.sendMessage({
        type: 'vault.updateData',
        payload: {
          vaultData: {
            accounts: accounts.map((account) => ({
              id: account.pubkey,
              alias: account.alias,
              account: { privkey: account.privkey },
              createdAt: new Date().toISOString(),
            })),
          },
        },
      })) as { success?: boolean } | undefined;
      if (result?.success === false) throw new Error('could not seed accounts');
      await chrome.storage.local.set({ 'nostr:fallback-relays': [relay] });
    },
    [[ALICE, BOB], fallbackRelay] as const,
  );
}

async function useAccount(page: Page, alias: string): Promise<void> {
  await page.evaluate((active) => chrome.storage.local.set({ 'nostr:active': active }), alias);
}

/** Publishes the active account's DM relay list through the same background action the Relays page uses. */
async function publishDmRelays(page: Page, relays: string[]): Promise<void> {
  const result = (await page.evaluate(
    (list) => chrome.runtime.sendMessage({ type: 'messaging.dmRelays.publish', payload: { relays: list } }),
    relays,
  )) as { accepted?: string[] };
  expect(result.accepted).toEqual(expect.arrayContaining(relays));
}

/** Publishes a kind 3 for `privkey` straight to the relay, standing in for the Contacts page. */
async function publishContacts(relay: string, privkey: string, contacts: { pubkey: string; petname: string }[]) {
  const pool = new SimplePool();
  try {
    const event = finalizeEvent(
      {
        kind: 3,
        created_at: Math.floor(Date.now() / 1000),
        tags: contacts.map((contact) => ['p', contact.pubkey, '', contact.petname]),
        content: '',
      },
      hexToBytes(privkey),
    );
    await Promise.all(pool.publish([relay], event));
  } finally {
    pool.close([relay]);
  }
}

async function openMessaging(page: Page): Promise<void> {
  await page.goto(page.url().replace(/#.*$/, '#/messages'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Messaging', level: 1 })).toBeVisible();
}

const conversation = (page: Page, pubkey: string) => page.locator(`[data-peer="${pubkey}"]`);

async function send(page: Page, text: string): Promise<void> {
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByLabel('Message', { exact: true }).press('Enter');
}

test.describe('messaging', () => {
  test('two accounts exchange private messages through an AUTH-required inbox', async ({ openPage, relays }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedAccounts(page, relays.plain);
    await publishContacts(relays.plain, ALICE.privkey, [
      { pubkey: BOB.pubkey, petname: 'Bob' },
      { pubkey: CAROL_PUBKEY, petname: 'Carol' },
    ]);

    await useAccount(page, BOB.alias);
    await publishDmRelays(page, [relays.inbox]);
    await useAccount(page, ALICE.alias);
    await publishDmRelays(page, [relays.inbox]);

    // Alice writes to Bob, a contact.
    await openMessaging(page);
    await expect(page.getByTestId('conversation-section-contacts')).toContainText('Bob');
    await expect(page.getByTestId('conversation-section-contacts')).toContainText('Carol');
    await conversation(page, BOB.pubkey).click();
    await send(page, 'hello bob');
    await expect(page.locator('[data-from="me"]')).toContainText('hello bob');

    // Bob does not follow Alice, so she arrives as a message request, unread.
    await useAccount(page, BOB.alias);
    await openMessaging(page);
    const fromAlice = conversation(page, ALICE.pubkey);
    await expect(page.getByTestId('conversation-section-requests')).toContainText('hello bob');
    await expect(fromAlice.locator('.conversation-list__unread')).toHaveText('1');

    await fromAlice.click();
    await expect(page.locator('[data-from="peer"]')).toContainText('hello bob');
    await expect(fromAlice.locator('.conversation-list__unread')).toHaveCount(0);
    // NIP-17 timestamps have one-second resolution, so two messages in the same second have no
    // knowable order. A person cannot reply that fast; the test should not either.
    await page.waitForTimeout(1_100);
    await send(page, 'hi alice');
    await expect(page.locator('[data-from="me"]')).toContainText('hi alice');

    // Read state is kept: reopening as Bob shows nothing unread.
    await openMessaging(page);
    await expect(conversation(page, ALICE.pubkey)).toBeVisible();
    await expect(conversation(page, ALICE.pubkey).locator('.conversation-list__unread')).toHaveCount(0);

    // Alice sees the reply, in order, after her own message.
    await useAccount(page, ALICE.alias);
    await openMessaging(page);
    await expect(conversation(page, BOB.pubkey).locator('.conversation-list__unread')).toHaveText('1');
    await conversation(page, BOB.pubkey).click();
    await expect(page.locator('[data-from]')).toHaveText([/hello bob/, /hi alice/]);

    // Carol has no DM relays, so nothing can reach her and Porwr says so.
    await conversation(page, CAROL_PUBKEY).click();
    await send(page, 'anyone there?');
    await expect(page.getByTestId('recipient-not-ready')).toBeVisible();
  });

  test('an account without DM relays is told how to start receiving', async ({ openPage, relays }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedAccounts(page, relays.plain);
    await useAccount(page, ALICE.alias);

    await openMessaging(page);

    await expect(page.getByTestId('no-inbox')).toBeVisible();
    // A Quasar button with `to` renders as a link.
    await page.getByRole('link', { name: 'Set up relays' }).click();
    await expect(page).toHaveURL(/#\/relays$/);
  });
});
