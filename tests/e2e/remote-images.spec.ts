import type { Page } from '@playwright/test';
import { finalizeEvent, getPublicKey, SimplePool } from 'nostr-tools';
import type { EventTemplate } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';

import { expect, test } from './fixtures/relays';
import { createVault, TEST_ACCOUNT, seedAccounts } from './fixtures/vault';

/**
 * "Load remote images" (threat model T32, diogel-io/workspace#148).
 *
 * A profile picture or banner is fetched from whatever host the profile names, and the fetch tells
 * that host whose profile the user is looking at. With the setting off, Porwr's pages show a
 * placeholder and contact no image host until the user loads an image, or every image on the page.
 *
 * The profiles here name a host that does not exist, `images.porwr.test`. Every request to it is
 * caught, recorded and answered with a one-pixel PNG, so the record is exactly what the pages tried
 * to load. In the style of the approval network-silence test (T7, #144), and like it Chromium only:
 * Firefox runs through WebDriver, which cannot observe requests, and `no-remote-resources.test.ts`
 * guards the source both builds share.
 */

const IMAGE_HOST = 'https://images.porwr.test';
const ALICE = {
  ...TEST_ACCOUNT,
  picture: `${IMAGE_HOST}/alice.png`,
  banner: `${IMAGE_HOST}/alice-banner.png`,
};
const BOB = {
  alias: 'bob',
  privkey: '2'.repeat(64),
  pubkey: '466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27',
  picture: `${IMAGE_HOST}/bob.png`,
};

const CAROL = {
  privkey: '3'.repeat(64),
  pubkey: getPublicKey(hexToBytes('3'.repeat(64))),
  picture: `${IMAGE_HOST}/carol.png`,
};

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function publish(relay: string, privkey: string, template: EventTemplate): Promise<void> {
  const pool = new SimplePool();
  try {
    await Promise.all(pool.publish([relay], finalizeEvent(template, hexToBytes(privkey))));
  } finally {
    pool.close([relay]);
  }
}

/** Alice and Bob in the vault, their profiles on the local relay, and Alice following Bob. */
async function seed(page: Page, relay: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await publish(relay, ALICE.privkey, {
    kind: 0,
    created_at: now,
    tags: [],
    content: JSON.stringify({ name: 'alice', picture: ALICE.picture, banner: ALICE.banner }),
  });
  await publish(relay, BOB.privkey, {
    kind: 0,
    created_at: now,
    tags: [],
    content: JSON.stringify({ name: 'bob', picture: BOB.picture }),
  });
  await publish(relay, ALICE.privkey, {
    kind: 3,
    created_at: now,
    tags: [['p', BOB.pubkey, '', 'Bob']],
    content: '',
  });

  // The local relay stands in for the fallback relays, which serve profiles and contact lists.
  await page.evaluate(
    (fallback) => chrome.storage.local.set({ 'nostr:fallback-relays': [fallback] }),
    relay,
  );
  await seedAccounts(page, [ALICE, BOB]);
  await page.evaluate(
    (active) => chrome.storage.local.set({ 'nostr:active': active }),
    ALICE.alias,
  );
}

/** Records every request to the image host, and answers it so nothing leaves the machine. */
async function watchImageHost(page: Page): Promise<string[]> {
  const requested: string[] = [];
  await page.context().route(`${IMAGE_HOST}/**`, (route) => {
    requested.push(route.request().url());
    // Never cached, so each image a page shows is a request seen here.
    return route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'cache-control': 'no-store' },
      body: PNG,
    });
  });
  return requested;
}

async function open(page: Page, hash: string): Promise<void> {
  await page.goto(page.url().replace(/#.*$/, `#${hash}`));
  await page.reload();
}

const placeholders = (page: Page) => page.getByTestId('remote-image-placeholder');

async function setLoadRemoteImages(page: Page, enabled: boolean): Promise<void> {
  await open(page, '/settings');
  const toggle = page.getByRole('switch', { name: 'Load remote images' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  if (!enabled) {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  }
}

test.describe('remote images', () => {
  test('with the setting off, no page contacts an image host until the user loads an image', async ({
    openPage,
    relays,
  }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seed(page, relays.plain);
    const requested = await watchImageHost(page);

    await setLoadRemoteImages(page, false);
    // The Settings page itself showed the header avatar while the setting was still on.
    requested.length = 0;

    // Each page is held until its profiles have arrived, shown by the placeholders standing where
    // their images would be. Only then does an empty record mean the images were held back.
    await open(page, '/profile');
    await expect(
      page.locator('.profile-header__banner').getByTestId('remote-image-placeholder'),
    ).toBeVisible();
    await expect(
      page.locator('.profile-header__avatar').getByTestId('remote-image-placeholder'),
    ).toBeVisible();
    await expect(page.getByTestId('remote-images-notice')).toBeVisible();
    await page.waitForLoadState('networkidle');

    await open(page, '/contacts');
    await expect(
      page.locator('.contacts-page__contact').getByTestId('remote-image-placeholder'),
    ).toBeVisible();
    await page.waitForLoadState('networkidle');

    await open(page, '/messages');
    await page.getByLabel('Search contacts').fill('bob');
    await expect(
      page.getByTestId('conversation-search-results').getByTestId('remote-image-placeholder'),
    ).toBeVisible();
    await page.waitForLoadState('networkidle');

    expect(requested).toEqual([]);

    // One image, when the user asks for it, and only that one.
    await open(page, '/profile');
    await page.locator('.profile-header__avatar').getByTestId('remote-image-placeholder').click();
    await expect(page.locator('.profile-header__avatar img')).toHaveAttribute('src', ALICE.picture);
    await page.waitForLoadState('networkidle');
    expect(requested).toEqual([ALICE.picture]);

    // Then the rest of the page, header avatars included.
    await page.getByTestId('remote-images-load-all').click();
    await expect(page.locator('.profile-header__banner img')).toHaveAttribute('src', ALICE.banner);
    await expect(page.getByTestId('remote-images-notice')).toHaveCount(0);
    expect(requested).toContain(ALICE.banner);

    // What was loaded stays with that page. The next one starts held back again.
    const before = requested.length;
    await page.locator('.main-navigation__item', { hasText: 'Contacts' }).first().click();
    await expect(
      page.locator('.contacts-page__contact').getByTestId('remote-image-placeholder'),
    ).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(requested.slice(before).filter((url) => url === BOB.picture)).toEqual([]);
  });

  test('"Load images on this page" loads what is waiting, not what the page shows next', async ({
    openPage,
    relays,
  }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seed(page, relays.plain);
    // Carol joins Alice's contacts, so a second search on the same page finds someone new.
    const later = Math.floor(Date.now() / 1000) + 1;
    await publish(relays.plain, CAROL.privkey, {
      kind: 0,
      created_at: later,
      tags: [],
      content: JSON.stringify({ name: 'carol', picture: CAROL.picture }),
    });
    await publish(relays.plain, ALICE.privkey, {
      kind: 3,
      created_at: later,
      tags: [
        ['p', BOB.pubkey, '', 'Bob'],
        ['p', CAROL.pubkey, '', 'Carol'],
      ],
      content: '',
    });
    const requested = await watchImageHost(page);

    await setLoadRemoteImages(page, false);
    await open(page, '/messages');
    const results = page.getByTestId('conversation-search-results');
    await page.getByLabel('Search contacts').fill('bob');
    await expect(results.getByTestId('remote-image-placeholder')).toBeVisible();
    await page.getByTestId('remote-images-load-all').click();
    await expect(results.locator('img')).toHaveAttribute('src', BOB.picture);

    await page.getByLabel('Search contacts').fill('carol');
    await expect(results.getByTestId('remote-image-placeholder')).toBeVisible();
    await expect(page.getByTestId('remote-images-notice')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(requested).not.toContain(CAROL.picture);
  });

  test('turning the setting off reaches a surface that is already open', async ({
    openPage,
    relays,
  }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seed(page, relays.plain);
    const requested = await watchImageHost(page);

    // A second Porwr tab, open with the setting still on. It has already read its settings.
    const other = await page.context().newPage();
    await other.goto(page.url().replace(/#.*$/, '#/dashboard'));
    await expect(other.locator('.dashboard-layout')).toBeVisible();

    await setLoadRemoteImages(page, false);
    requested.length = 0;

    // Navigating inside the open tab, without a reload, must still hold images back.
    await other.locator('.main-navigation__item', { hasText: 'Profile' }).first().click();
    await expect(
      other.locator('.profile-header__avatar').getByTestId('remote-image-placeholder'),
    ).toBeVisible();
    await other.waitForLoadState('networkidle');
    expect(requested).toEqual([]);
  });

  test('with the setting on, images load as they always have', async ({ openPage, relays }) => {
    const page = await openPage('/login');
    await createVault(page);
    await seed(page, relays.plain);
    const requested = await watchImageHost(page);

    await setLoadRemoteImages(page, true);
    await open(page, '/profile');

    await expect(page.locator('.profile-header__avatar img')).toHaveAttribute('src', ALICE.picture);
    await expect(page.locator('.profile-header__banner img')).toHaveAttribute('src', ALICE.banner);
    await expect(placeholders(page)).toHaveCount(0);
    await expect(page.getByTestId('remote-images-notice')).toHaveCount(0);
    await expect
      .poll(() => requested)
      .toEqual(expect.arrayContaining([ALICE.picture, ALICE.banner]));
  });
});
