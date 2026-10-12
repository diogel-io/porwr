import type { Page } from '@playwright/test';
import { finalizeEvent, SimplePool } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';

import { expect, test } from './fixtures/relays';
import { createVault, seedAccount, TEST_ACCOUNT } from './fixtures/vault';

/**
 * Quick Publish tags its notes with a NIP-89 client tag unless the user turns it off (#226).
 *
 * The preview is the event that gets signed, so what it lists is what is published. Quick Publish
 * needs a relay to publish to before it will preview, so the test account gets a kind 10002 on a local
 * relay standing in for the fallback relays; nothing is ever published to a real relay.
 */

async function publishRelayList(relay: string): Promise<void> {
  const pool = new SimplePool();
  try {
    const event = finalizeEvent(
      { kind: 10002, created_at: Math.floor(Date.now() / 1000), tags: [['r', relay]], content: '' },
      hexToBytes(TEST_ACCOUNT.privkey),
    );
    await Promise.all(pool.publish([relay], event));
  } finally {
    pool.close([relay]);
  }
}

const go = (page: Page, route: string) => page.goto(page.url().replace(/#.*$/, `#${route}`));

async function openPreview(page: Page, content: string) {
  await go(page, '/dashboard');
  // The account's relays load after the card does; Preview refuses until there is one to publish to.
  await expect(page.getByText(/destinations: 1 relay/)).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Content', { exact: true }).fill(content);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(content, { timeout: 15_000 });
  return dialog;
}

test('Quick Publish adds the client tag by default, and not once it is turned off', async ({
  openPage,
  relays,
}) => {
  const page = await openPage('/login');
  await createVault(page);
  await seedAccount(page);
  await page.evaluate(
    (relay) => chrome.storage.local.set({ 'nostr:fallback-relays': [relay] }),
    relays.plain,
  );
  await publishRelayList(relays.plain);

  const tagged = await openPreview(page, 'tagged note');
  await expect(tagged).toContainText('client: Diogel Porwr');
  await tagged.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(tagged).toBeHidden();

  await go(page, '/settings');
  const toggle = page.getByRole('switch', { name: 'Tag Quick Publish notes as from Porwr' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect
    .poll(() => page.evaluate(() => chrome.storage.local.get('nostr:quick-publish-client-tag')))
    .toEqual({ 'nostr:quick-publish-client-tag': false });

  // A fresh page reads the stored choice back.
  await page.reload();
  await go(page, '/settings');
  await expect(
    page.getByRole('switch', { name: 'Tag Quick Publish notes as from Porwr' }),
  ).toHaveAttribute('aria-checked', 'false');

  const untagged = await openPreview(page, 'untagged note');
  await expect(untagged).not.toContainText('client');
});
