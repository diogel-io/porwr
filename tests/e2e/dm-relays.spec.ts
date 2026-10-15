import type { Locator, Page } from '@playwright/test';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { SimplePool, verifyEvent } from 'nostr-tools';
import type { Event } from 'nostr-tools';

import { expect, test } from './fixtures/relays';
import { createVault, seedAccount, TEST_ACCOUNT } from './fixtures/vault';

/**
 * Loading and saving Direct Message Relays with one relay that never answers (#265).
 *
 * Both used to wait on the slow relay past the page's 5 s limit. The save was then sent again and
 * reported a failure although the list had been published. Now the background stops at its own
 * deadlines: the card loads from the relays that answered, and the save counts the slow relay as
 * rejected.
 */

/** Accepts TCP connections and never completes the WebSocket handshake, like an unreachable relay. */
async function startSilentRelay(): Promise<{ url: string; server: Server; sockets: Socket[] }> {
  const sockets: Socket[] = [];
  const server = createServer((socket) => sockets.push(socket));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  return { url: `ws://localhost:${port}`, server, sockets };
}

async function latest(relay: string, kind: number, author: string): Promise<Event | null> {
  const pool = new SimplePool();
  try {
    return await pool.get([relay], { kinds: [kind], authors: [author] }, { maxWait: 3_000 });
  } finally {
    pool.close([relay]);
  }
}

test('Direct Message Relays load and save when one relay never answers', async ({
  openPage,
  relays,
}) => {
  const silent = await startSilentRelay();
  try {
    const page = await openPage('/login');
    await createVault(page);
    await seedAccount(page);
    await page.evaluate(
      (list) => chrome.storage.local.set({ 'nostr:fallback-relays': list }),
      [relays.plain, silent.url],
    );
    await page.goto(page.url().replace(/#.*$/, '#/relays'));
    await page.reload();

    const card = page.getByTestId('dm-relays-card');
    const save = card.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeVisible({ timeout: 6_000 });
    await expect(card.getByText('You have not published a direct message relay list yet.')).toBeVisible();
    await expect(card.getByText(/Could not load your direct message relays/)).toHaveCount(0);
    await card.getByLabel('Direct message relay URL', { exact: true }).fill(relays.plain);
    await card.getByRole('button', { name: 'Add direct message relay', exact: true }).click();

    await save.click();
    // One relay took it: the local relay is both a fallback and the DM relay; the silent one timed out.
    await expect(page.getByText('Direct message relays published to 1 relays')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText('Failed to publish direct message relays')).toHaveCount(0);

    const event = await latest(relays.plain, 10050, TEST_ACCOUNT.pubkey);
    expect(event).not.toBeNull();
    expect(verifyEvent(event!)).toBe(true);
    expect(event!.tags).toEqual([['relay', relays.plain]]);
  } finally {
    silent.sockets.forEach((socket) => socket.destroy());
    silent.server.close();
  }
});

/**
 * Saving checks each DM relay with a throwaway gift wrap first (#277). `dropping` says OK to gift
 * wraps and keeps none, like relay.damus.io; `inbox` requires NIP-42 AUTH and keeps them.
 */
test.describe('Direct Message Relays are checked before they are published (#277)', () => {
  async function openRelaysPage(page: Page, fallback: string) {
    await createVault(page);
    await seedAccount(page);
    await page.evaluate((list) => chrome.storage.local.set({ 'nostr:fallback-relays': list }), [fallback]);
    await page.goto(page.url().replace(/#.*$/, '#/relays'));
    await page.reload();
    const card = page.getByTestId('dm-relays-card');
    await expect(card.getByRole('button', { name: 'Save', exact: true })).toBeVisible({ timeout: 6_000 });
    return card;
  }

  async function addRelay(card: Locator, url: string) {
    await card.getByLabel('Direct message relay URL', { exact: true }).fill(url);
    await card.getByRole('button', { name: 'Add direct message relay', exact: true }).click();
  }

  const row = (card: Locator, url: string) =>
    card.getByRole('listitem').filter({ hasText: url });

  test('a list where every relay drops gift wraps is not published', async ({ openPage, relays }) => {
    const page = await openPage('/login');
    const card = await openRelaysPage(page, relays.plain);
    await addRelay(card, relays.dropping);

    await card.getByRole('button', { name: 'Save', exact: true }).click();

    const blocked = card.getByTestId('dm-relays-all-drop');
    await expect(blocked).toBeVisible({ timeout: 6_000 });
    await expect(blocked).toContainText(relays.dropping);
    await expect(row(card, relays.dropping).getByTestId('dm-relay-status-drops')).toHaveText('Drops messages');
    await expect(page.getByText(/Direct message relays published/)).toHaveCount(0);
    expect(await latest(relays.plain, 10050, TEST_ACCOUNT.pubkey)).toBeNull();
  });

  test('a relay that drops gift wraps is named before the list is published', async ({ openPage, relays }) => {
    const page = await openPage('/login');
    const card = await openRelaysPage(page, relays.plain);
    await addRelay(card, relays.inbox);
    await addRelay(card, relays.dropping);

    await card.getByRole('button', { name: 'Save', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 6_000 });
    await expect(dialog).toContainText('Some relays drop messages');
    await expect(dialog).toContainText(relays.dropping);
    await expect(dialog).not.toContainText(relays.inbox);
    // The inbox only serves a wrap to its recipient, and the check authenticated as that recipient.
    await expect(row(card, relays.inbox).getByTestId('dm-relay-status-keeps')).toHaveText('Keeps messages');
    await expect(row(card, relays.dropping).getByTestId('dm-relay-status-drops')).toBeVisible();

    await dialog.getByRole('button', { name: 'Publish anyway' }).click();
    await expect(page.getByText(/Direct message relays published to \d+ relays/)).toBeVisible({ timeout: 6_000 });

    const event = await latest(relays.plain, 10050, TEST_ACCOUNT.pubkey);
    expect(event!.tags).toEqual([
      ['relay', relays.inbox],
      ['relay', relays.dropping],
    ]);
    // Nothing the check published was signed by the account.
    const pool = new SimplePool();
    try {
      const own = await pool.querySync([relays.dropping], { kinds: [1059], authors: [TEST_ACCOUNT.pubkey] }, { maxWait: 2_000 });
      expect(own).toEqual([]);
    } finally {
      pool.close([relays.dropping]);
    }
  });

  test("an unreachable relay is shown as couldn't check and does not block the list", async ({ openPage, relays }) => {
    const silent = await startSilentRelay();
    try {
      const page = await openPage('/login');
      const card = await openRelaysPage(page, relays.plain);
      await addRelay(card, relays.plain);
      await addRelay(card, silent.url);

      await card.getByRole('button', { name: 'Save', exact: true }).click();

      await expect(row(card, silent.url).getByTestId('dm-relay-status-unchecked')).toHaveText("Couldn't check", {
        timeout: 6_000,
      });
      await expect(row(card, relays.plain).getByTestId('dm-relay-status-keeps')).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByText('Direct message relays published to 1 relays')).toBeVisible({ timeout: 6_000 });
    } finally {
      silent.sockets.forEach((socket) => socket.destroy());
      silent.server.close();
    }
  });
});
