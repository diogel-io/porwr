import type { Page } from '@playwright/test';
import { finalizeEvent, SimplePool } from 'nostr-tools';
import type { Event } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';

import { expect, test } from './fixtures/relays';
import { createVault, seedAccount, TEST_ACCOUNT } from './fixtures/vault';

/**
 * Contact rows stay inside the Contacts card at the panel's 320px floor and at 360px (NFR-11,
 * diogel-io/porwr#431).
 *
 * A contact with no profile shows its npub as the name and subtitle, and a relay hint has no spaces
 * either: before #431 both ran past the card. The card has `overflow: hidden`, so the page itself
 * never scrolled sideways while the rows were cut off, and after Publish the card was left scrolled
 * sideways. So this measures the card as well as the page.
 */

const LONG_RELAY_URL = `wss://relay.example.com/${'r'.repeat(300)}`;
const pubkeyAt = (index: number) => index.toString(16).padStart(64, '0');

async function publishContactList(relay: string): Promise<void> {
  // No kind 0 for any contact, so every name falls back to its npub.
  const event = finalizeEvent(
    {
      kind: 3,
      created_at: Math.floor(Date.now() / 1000) - 60,
      content: '',
      tags: [
        ['p', pubkeyAt(1)],
        ['p', pubkeyAt(2), LONG_RELAY_URL],
        ['p', pubkeyAt(3)],
      ],
    },
    hexToBytes(TEST_ACCOUNT.privkey),
  );
  const pool = new SimplePool();
  try {
    await Promise.all(pool.publish([relay], event));
  } finally {
    pool.close([relay]);
  }
}

async function latestContactList(relay: string): Promise<Event | null> {
  const pool = new SimplePool();
  try {
    return await pool.get(
      [relay],
      { kinds: [3], authors: [TEST_ACCOUNT.pubkey] },
      { maxWait: 3_000 },
    );
  } finally {
    pool.close([relay]);
  }
}

async function openContacts(page: Page, relay: string, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 560 });
  await createVault(page);
  // The local relay stands in for the fallback relays, which serve contact lists.
  await page.evaluate(
    (fallback) => chrome.storage.local.set({ 'nostr:fallback-relays': [fallback] }),
    relay,
  );
  await seedAccount(page);
  const contactsPage = page.url().replace(/#.*$/, '#/contacts');
  await page.goto('about:blank');
  await page.goto(contactsPage);
}

/** How far the page and the Contacts card are wider than they show, and how far the card is scrolled. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    const card = document.querySelector('.contacts-page__card');
    return {
      pageOverflow: root.scrollWidth - root.clientWidth,
      cardOverflow: card ? card.scrollWidth - card.clientWidth : null,
      cardScrollLeft: card ? card.scrollLeft : null,
    };
  });

test.describe('the Contacts page at panel width', () => {
  for (const width of [320, 360]) {
    test(`keeps contact rows inside the card at ${width}px`, async ({ openPage, relays }) => {
      await publishContactList(relays.plain);
      const page = await openPage('/login');
      await openContacts(page, relays.plain, width);

      await expect(page.getByText('3 contacts')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(LONG_RELAY_URL)).toHaveCount(1);
      expect(await measure(page)).toEqual({ pageOverflow: 0, cardOverflow: 0, cardScrollLeft: 0 });

      await page.getByRole('button', { name: 'Remove contact' }).first().click();
      await page.getByRole('button', { name: 'Publish Changes' }).click();
      await expect(page.getByText('Contact list published successfully.')).toBeVisible({
        timeout: 10_000,
      });
      expect((await latestContactList(relays.plain))!.tags).toHaveLength(2);
      expect(await measure(page)).toEqual({ pageOverflow: 0, cardOverflow: 0, cardScrollLeft: 0 });
    });
  }
});
