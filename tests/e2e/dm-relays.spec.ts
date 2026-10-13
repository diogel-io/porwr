import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { SimplePool, verifyEvent } from 'nostr-tools';
import type { Event } from 'nostr-tools';

import { expect, test } from './fixtures/relays';
import { createVault, seedAccount, TEST_ACCOUNT } from './fixtures/vault';

/**
 * Saving Direct Message Relays with one relay that never answers (#265).
 *
 * The save used to wait on the slow relay past the page's 5 s limit, get sent again, and then
 * report a failure although the list had been published. Now the background stops at its own
 * deadline, counts the slow relay as rejected, and the save succeeds.
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

test('saving Direct Message Relays succeeds when one relay never answers', async ({
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
    await expect(save).toBeVisible({ timeout: 30_000 });
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
