import type { Page } from '@playwright/test';
import { finalizeEvent, SimplePool, verifyEvent } from 'nostr-tools';
import type { Event } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';

import { expect, test } from './fixtures/relays';
import { createVault, seedAccount, TEST_ACCOUNT } from './fixtures/vault';

/**
 * Media Management edits the account's Blossom User Server List, kind 10063 (porwr#417).
 *
 * The page shows the list's first server, saves only when Save is pressed, refuses a URL ending in
 * a slash, and keeps the account's other servers after the new primary.
 */

const go = (page: Page, route: string) => page.goto(page.url().replace(/#.*$/, `#${route}`));

async function latest(relay: string, author: string): Promise<Event | null> {
  const pool = new SimplePool();
  try {
    return await pool.get([relay], { kinds: [10063], authors: [author] }, { maxWait: 3_000 });
  } finally {
    pool.close([relay]);
  }
}

async function publishServerList(relay: string, servers: string[]): Promise<void> {
  const event = finalizeEvent(
    {
      kind: 10063,
      created_at: Math.floor(Date.now() / 1000) - 60,
      content: '',
      tags: servers.map((server) => ['server', server]),
    },
    hexToBytes(TEST_ACCOUNT.privkey),
  );
  const pool = new SimplePool();
  try {
    await Promise.any(pool.publish([relay], event));
  } finally {
    pool.close([relay]);
  }
}

async function openMediaPage(page: Page, relay: string): Promise<void> {
  await createVault(page);
  // Point the app at the local relay before adding the account, as dm-relays.spec.ts does.
  await page.evaluate(
    (list) => chrome.storage.local.set({ 'nostr:fallback-relays': list }),
    [relay],
  );
  await seedAccount(page);
  // Opened fresh, so the page's first load of the list is the one asserted on (see dm-relays.spec.ts).
  const mediaPage = page.url().replace(/#.*$/, '#/media');
  await page.goto('about:blank');
  await page.goto(mediaPage);
}

test.describe('media management', () => {
  test('publishes the Blossom server as kind 10063 only when Save is pressed', async ({
    openPage,
    relays,
  }) => {
    const page = await openPage('/login');
    await openMediaPage(page, relays.plain);

    const card = page.getByTestId('blossom-server-card');
    const field = card.getByLabel('Blossom Server URL', { exact: true });
    const save = card.getByRole('button', { name: 'Save', exact: true });

    // No list yet: the vault default, without its old trailing slash.
    await expect(field).toHaveValue('https://blossom.primal.net', { timeout: 6_000 });
    await expect(card.getByTestId('blossom-server-not-published')).toBeVisible();

    await field.fill('https://threenine.blossom.band/');
    await expect(save).toBeDisabled();
    await field.fill('https://threenine.blossom.band');
    await expect(save).toBeEnabled();
    expect(await latest(relays.plain, TEST_ACCOUNT.pubkey)).toBeNull();

    await save.click();
    await expect(page.getByText('Blossom server saved')).toBeVisible({ timeout: 5_000 });

    const event = await latest(relays.plain, TEST_ACCOUNT.pubkey);
    expect(event).not.toBeNull();
    expect(verifyEvent(event!)).toBe(true);
    expect(event!.content).toBe('');
    expect(event!.tags).toEqual([['server', 'https://threenine.blossom.band']]);

    await page.reload();
    await expect(page.getByLabel('Blossom Server URL', { exact: true })).toHaveValue(
      'https://threenine.blossom.band',
      { timeout: 6_000 },
    );

    await go(page, '/settings');
    await expect(page.getByRole('heading', { name: 'Extension Settings', level: 1 })).toBeVisible();
    await expect(page.getByText('Blossom Server URL')).toHaveCount(0);
  });

  test('keeps the servers another client published after the new primary', async ({
    openPage,
    relays,
  }) => {
    await publishServerList(relays.plain, ['https://old.example', 'https://mirror.example']);
    const page = await openPage('/login');
    await openMediaPage(page, relays.plain);

    const card = page.getByTestId('blossom-server-card');
    const field = card.getByLabel('Blossom Server URL', { exact: true });
    await expect(field).toHaveValue('https://old.example', { timeout: 6_000 });

    await field.fill('https://new.example');
    await card.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Blossom server saved')).toBeVisible({ timeout: 5_000 });

    const event = await latest(relays.plain, TEST_ACCOUNT.pubkey);
    expect(event!.tags).toEqual([
      ['server', 'https://new.example'],
      ['server', 'https://old.example'],
      ['server', 'https://mirror.example'],
    ]);
  });
});
