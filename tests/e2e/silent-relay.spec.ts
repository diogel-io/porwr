import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/extension';
import { startSilentRelay, type SilentRelay } from './fixtures/silent-relay';
import { createVault, seedAccount } from './fixtures/vault';

/**
 * A fallback relay that accepts the connection and never answers counts as unreachable, not as an
 * account with nothing published (#424, #435). Every page that reads a replaceable event then shows
 * that it couldn't load, rather than offering to replace what the account may have published.
 */

/** Long enough for Porwr's per-relay lookup deadline (8 s) and the page to catch up. */
const UNREACHABLE_TIMEOUT_MS = 20_000;

let relay: SilentRelay;

test.beforeEach(async () => {
  relay = await startSilentRelay();
});

test.afterEach(async () => {
  await relay.close();
});

async function openWithSilentRelay(page: Page, route: string): Promise<void> {
  await createVault(page);
  await page.evaluate(
    (url) => chrome.storage.local.set({ 'nostr:fallback-relays': [url] }),
    relay.url,
  );
  await seedAccount(page);
  // Opened fresh, so the page's first lookup is the one asserted on.
  const target = page.url().replace(/#.*$/, `#${route}`);
  await page.goto('about:blank');
  await page.goto(target);
}

test('Media Management shows it could not load the list, and asks before Save', async ({
  openPage,
}) => {
  const page = await openPage('/login');
  await openWithSilentRelay(page, '/media');

  const card = page.getByTestId('blossom-server-card');
  await expect(card.getByTestId('blossom-server-load-error')).toBeVisible({
    timeout: UNREACHABLE_TIMEOUT_MS,
  });
  await expect(card.getByTestId('blossom-server-not-published')).toHaveCount(0);

  await card.getByLabel('Blossom Server URL', { exact: true }).fill('https://blossom.example');
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Replace your Blossom server list?');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
});

test('Contacts shows it could not load the list, with editing off', async ({ openPage }) => {
  const page = await openPage('/login');
  await openWithSilentRelay(page, '/contacts');

  await expect(page.getByTestId('contacts-unreachable')).toBeVisible({
    timeout: UNREACHABLE_TIMEOUT_MS,
  });
  await expect(page.getByText('No contacts found')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Contact' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Publish Changes' })).toBeDisabled();
});

test('Quick Publish shows the relays could not be reached', async ({ openPage }) => {
  const page = await openPage('/login');
  await openWithSilentRelay(page, '/dashboard');

  await expect(page.getByTestId('quick-sign-relays-unreachable')).toBeVisible({
    timeout: UNREACHABLE_TIMEOUT_MS,
  });
});
