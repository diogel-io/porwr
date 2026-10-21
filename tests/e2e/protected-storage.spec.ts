import type { Page, Worker } from '@playwright/test';

import { expect, test } from './fixtures/extension';
import { createVault, requestSignatureFromPage, seedAccount } from './fixtures/vault';

/**
 * Grants, site bindings and auto-lock state live where a content script cannot reach them (#140).
 *
 * `chrome.storage.local` is open to Porwr's content scripts, which run inside every website. These
 * values used to sit there; they now live in the extension's own IndexedDB. What matters is that
 * nothing is left in `storage.local` for a compromised page to read, and that a grant planted there
 * authorises nothing.
 */

const QUEUE_KEY = 'nostr:request-queue';
const MOVED = [
  'nostr:permissions',
  'nostr:site-bindings',
  'vault:auto-lock-minutes',
  'vault:last-activity',
];

const queued = (background: Worker) =>
  background.evaluate(async (key) => {
    const stored = (await chrome.storage.session.get(key)) as Record<string, unknown>;
    return ((stored[key] as Array<{ id: string; state: string }> | undefined) ?? []).filter(
      (r) => r.state === 'queued' || r.state === 'presented',
    );
  }, QUEUE_KEY);

/** Decide the waiting request the way the panel does, by id. */
const approveFor8h = async (page: Page, background: Worker) => {
  const [request] = await queued(background);
  expect(request).toBeDefined();
  return page.evaluate(
    (id) =>
      chrome.runtime.sendMessage({
        type: 'nostr.requests.respond',
        payload: { requestId: id, approved: true, duration: '8h' },
      }),
    request!.id,
  );
};

test('keeps grants and bindings out of content-script storage, and still honours them', async ({
  openPage,
  background,
  context,
}) => {
  const setup = await openPage('/login');
  await createVault(setup);
  await seedAccount(setup);

  const site = await context.newPage();
  await site.goto('https://example.com');
  await requestSignatureFromPage(site);
  await expect.poll(async () => (await queued(background)).length, { timeout: 15_000 }).toBe(1);
  await expect(approveFor8h(setup, background)).resolves.toMatchObject({ applied: true });

  // Nothing a content script could read or write is left in storage.local.
  const local = await background.evaluate((keys) => chrome.storage.local.get(keys), MOVED);
  expect(local).toEqual({});

  // The grant still answers: a second request is signed without a prompt.
  await requestSignatureFromPage(site);
  const outcome = await site.evaluate(
    () => (window as unknown as { __signing: Promise<{ sig?: string }> }).__signing,
  );
  expect(typeof outcome.sig).toBe('string');
  expect(await queued(background)).toEqual([]);

  await site.close();
});

test('ignores a grant planted in content-script storage', async ({
  openPage,
  background,
  context,
}) => {
  const setup = await openPage('/login');
  await createVault(setup);
  await seedAccount(setup);
  const accountPubkey = await setup.evaluate(async () => {
    const view = (await chrome.runtime.sendMessage({ type: 'vault.getView' })) as {
      accounts?: Array<{ id: string }>;
    };
    return view.accounts?.[0]?.id ?? '';
  });

  // What a compromised renderer could have done before #140: write a standing grant directly.
  await background.evaluate(
    (pubkey) =>
      chrome.storage.local.set({
        'nostr:permissions': [
          {
            origin: 'https://example.com',
            accountPubkey: pubkey,
            requestType: 'sign_event',
            eventKind: 1,
            granted: true,
            timestamp: Date.now(),
          },
        ],
      }),
    accountPubkey,
  );

  const site = await context.newPage();
  await site.goto('https://example.com');
  await requestSignatureFromPage(site);

  // Asked, not answered by the planted grant.
  await expect.poll(async () => (await queued(background)).length, { timeout: 15_000 }).toBe(1);

  await site.close();
});
