import { execFileSync } from 'node:child_process';

import type { Page } from '@playwright/test';
import { finalizeEvent, SimplePool } from 'nostr-tools';
import type { Event, EventTemplate } from 'nostr-tools';
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
/**
 * Someone on another client entirely: every message to and from Dave is wrapped and unwrapped by
 * `nak`, a separate NIP-17 implementation, so Porwr is shown to interoperate rather than only to
 * agree with itself.
 */
const DAVE = {
  privkey: '4'.repeat(64),
  pubkey: '2c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991',
};

/**
 * Runs nak. With no input, stdin is closed rather than an empty pipe: nak reads a piped stdin as the
 * event to work on, and an empty one makes it silently do nothing.
 */
const nak = (args: string[], input?: string): string =>
  execFileSync('nak', args, {
    ...(input === undefined ? { stdio: ['ignore', 'pipe', 'pipe'] as const } : { input }),
    encoding: 'utf8',
    timeout: 15_000,
  }).trim();

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

/** Publishes an event, signing a relay's NIP-42 challenge with `privkey` if it asks. */
async function publishAs(relay: string, privkey: string, event: Event): Promise<void> {
  const pool = new SimplePool();
  try {
    const onauth = (template: EventTemplate) => Promise.resolve(finalizeEvent(template, hexToBytes(privkey)));
    await Promise.all(pool.publish([relay], event, { onauth }));
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

    // Locking the vault takes the decrypted conversation off the screen: the app sends every
    // dashboard page to the login page, and the background drops what it decrypted (part 2).
    await conversation(page, BOB.pubkey).click();
    await expect(page.locator('[data-from]')).toHaveCount(2);
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'vault.lock' }));
    await expect(page).toHaveURL(/#\/login/);
    await expect(page.locator('[data-from]')).toHaveCount(0);
    await expect(page.getByText('hi alice')).toHaveCount(0);
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

  test('interoperates with another NIP-17 client in both directions', async ({ openPage, relays }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedAccounts(page, relays.plain);
    await publishContacts(relays.plain, ALICE.privkey, [{ pubkey: DAVE.pubkey, petname: 'Dave' }]);
    await useAccount(page, ALICE.alias);
    await publishDmRelays(page, [relays.inbox]);
    // Dave's DM relay list, published by nak.
    nak(['event', '--sec', DAVE.privkey, '-k', '10050', '-t', `relay=${relays.inbox}`, relays.plain]);

    // Porwr -> nak: what Alice sends, Dave's client can open.
    await openMessaging(page);
    await conversation(page, DAVE.pubkey).click();
    await send(page, 'hello from porwr');
    await expect(page.locator('[data-from="me"]')).toContainText('hello from porwr');

    const wraps = nak(['req', '-k', '1059', '-p', DAVE.pubkey, '-l', '10', '--sec', DAVE.privkey, '--auth', relays.inbox]);
    const rumors = wraps
      .split('\n')
      .filter(Boolean)
      .map((wrap) => JSON.parse(nak(['gift', 'unwrap', '--sec', DAVE.privkey], wrap)) as Event);
    expect(rumors).toEqual([
      expect.objectContaining({ kind: 14, pubkey: ALICE.pubkey, content: 'hello from porwr', tags: [['p', DAVE.pubkey]] }),
    ]);

    // nak -> Porwr: a message Dave's client wraps appears in Alice's conversation, unread.
    const rumor = nak(['event', '--sec', DAVE.privkey, '-k', '14', '-c', 'hello from nak', '-t', `p=${ALICE.pubkey}`]);
    const wrap = JSON.parse(
      nak(['gift', 'wrap', '--sec', DAVE.privkey, '-p', ALICE.pubkey, '--use-our-identity-key', '--use-their-identity-key'], rumor),
    ) as Event;
    expect(wrap.kind).toBe(1059);
    expect(wrap.pubkey).not.toBe(DAVE.pubkey);
    await publishAs(relays.inbox, DAVE.privkey, wrap);

    await openMessaging(page);
    await expect(conversation(page, DAVE.pubkey).locator('.conversation-list__unread')).toHaveText('1');
    await conversation(page, DAVE.pubkey).click();
    await expect(page.locator('[data-from="peer"]')).toContainText('hello from nak');
  });

  test('the extension menu opens Messaging on its own page', async ({ openPage, relays, context }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seedAccounts(page, relays.plain);
    await useAccount(page, ALICE.alias);
    await page.goto(page.url().replace(/#.*$/, '#/'));

    await page.locator('.extension-window-header button, header button').filter({ has: page.locator('i', { hasText: 'menu' }) }).first().click();
    const [opened] = await Promise.all([
      context.waitForEvent('page'),
      page.locator('.q-menu .q-item').filter({ hasText: 'Messaging' }).first().click(),
    ]);

    await expect(opened).toHaveURL(/#\/messages$/);
    await expect(opened.getByRole('heading', { name: 'Messaging', level: 1 })).toBeVisible();
  });
});
