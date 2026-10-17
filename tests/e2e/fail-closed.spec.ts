import { expect, test } from './fixtures/extension';
import { createVault, requestSignatureFromPage, seedAccount } from './fixtures/vault';

/**
 * The fail-closed approval paths (#141).
 *
 * `request-queue.ts` is unit tested against these, and until now nothing exercised them in a real
 * browser. They are the paths where a regression fails *open*: a request that outlives its expiry,
 * or a decision applied to a request that has already moved on. What matters is not that the queue
 * record changes state — that is the unit test's job — but that the **page never receives a
 * signature** it should not have.
 *
 * Expiry is reached by ageing the stored record rather than by waiting. The floor on
 * `REQUEST_EXPIRY_MINUTES` is one minute, and a suite that waits a minute per case is a suite that
 * stops being run. Ageing exercises the real `applyExpiry` on the real load path; only the clock
 * is shortcut.
 */

const QUEUE_KEY = 'nostr:request-queue';

/** A signed Nostr event carries `sig`. Anything without one is not a signature. */
const isSignature = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { sig?: unknown }).sig === 'string';

test.describe('a request that expires', () => {
  test('is refused at the page rather than left signable', async ({
    openPage,
    background,
    context,
  }) => {
    const extensionPage = await openPage('/login');
    await createVault(extensionPage);
    await seedAccount(extensionPage);

    const site = await context.newPage();
    await site.goto('https://example.com');
    await requestSignatureFromPage(site);

    await expect
      .poll(() => background.evaluate(() => chrome.action.getBadgeText({})), { timeout: 15_000 })
      .toBe('1');

    // Age every queued record past its expiry. This is the clock moving, not the queue being
    // rewritten into a terminal state: `state` is left alone so `applyExpiry` is what changes it.
    const aged = await background.evaluate(async (key) => {
      const stored = (await chrome.storage.session.get(key)) as Record<string, unknown>;
      const records = stored[key] as Array<{ expiresAt: number; state: string }> | undefined;
      if (!records?.length) return 0;
      await chrome.storage.session.set({
        [key]: records.map((record) => ({ ...record, expiresAt: Date.now() - 1_000 })),
      });
      return records.length;
    }, QUEUE_KEY);

    // Without this the test could pass having aged nothing at all.
    expect(aged).toBe(1);

    // Any read of the queue applies expiry. This is the one the panel itself makes.
    await extensionPage.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'nostr.requests.count' }),
    );

    await expect
      .poll(() => background.evaluate(() => chrome.action.getBadgeText({})), { timeout: 15_000 })
      .toBe('');

    // The guarantee that matters: the site's promise settles, and not with a signature.
    const outcome = await site.evaluate(
      () => (window as unknown as { __signing: Promise<unknown> }).__signing,
    );
    expect(isSignature(outcome)).toBe(false);

    await site.close();
  });

  test('cannot then be approved from a stale panel', async ({ openPage, background, context }) => {
    const extensionPage = await openPage('/login');
    await createVault(extensionPage);
    await seedAccount(extensionPage);

    const site = await context.newPage();
    await site.goto('https://example.com');
    await requestSignatureFromPage(site);

    await expect
      .poll(() => background.evaluate(() => chrome.action.getBadgeText({})), { timeout: 15_000 })
      .toBe('1');

    // Read the id before ageing, the way a panel that rendered before the expiry would hold it.
    const requestId = await background.evaluate(async (key) => {
      const stored = (await chrome.storage.session.get(key)) as Record<string, unknown>;
      const records = stored[key] as Array<{ id: string }> | undefined;
      return records?.[0]?.id ?? null;
    }, QUEUE_KEY);

    expect(requestId).not.toBeNull();

    await background.evaluate(async (key) => {
      const stored = (await chrome.storage.session.get(key)) as Record<string, unknown>;
      const records = stored[key] as Array<{ expiresAt: number }>;
      await chrome.storage.session.set({
        [key]: records.map((record) => ({ ...record, expiresAt: Date.now() - 1_000 })),
      });
    }, QUEUE_KEY);

    // The decision a stale panel would submit: approve, for a request that is already gone.
    const result = await extensionPage.evaluate(
      (id) =>
        chrome.runtime.sendMessage({
          type: 'nostr.requests.respond',
          payload: { requestId: id, approved: true, duration: 'once' },
        }),
      requestId,
    );

    expect(result).toMatchObject({ applied: false, reason: 'expired' });

    const outcome = await site.evaluate(
      () => (window as unknown as { __signing: Promise<unknown> }).__signing,
    );
    expect(isSignature(outcome)).toBe(false);

    await site.close();
  });
});

test.describe('a request that is already decided', () => {
  test('refuses a second decision rather than applying it', async ({
    openPage,
    background,
    context,
  }) => {
    const extensionPage = await openPage('/login');
    await createVault(extensionPage);
    await seedAccount(extensionPage);

    const site = await context.newPage();
    await site.goto('https://example.com');
    await requestSignatureFromPage(site);

    await expect
      .poll(() => background.evaluate(() => chrome.action.getBadgeText({})), { timeout: 15_000 })
      .toBe('1');

    const requestId = await background.evaluate(async (key) => {
      const stored = (await chrome.storage.session.get(key)) as Record<string, unknown>;
      const records = stored[key] as Array<{ id: string }> | undefined;
      return records?.[0]?.id ?? null;
    }, QUEUE_KEY);

    // Rejected through the panel, the way a user does it.
    await extensionPage.goto(extensionPage.url().replace(/#.*$/, '#/sidebar'));
    await extensionPage.locator('.current-request').waitFor({ state: 'visible', timeout: 15_000 });
    await extensionPage
      .getByRole('button', { name: /reject/i })
      .first()
      .click();

    await expect
      .poll(() => background.evaluate(() => chrome.action.getBadgeText({})), { timeout: 15_000 })
      .toBe('');

    // A second panel, or a replayed message, approving what was already rejected.
    const result = await extensionPage.evaluate(
      (id) =>
        chrome.runtime.sendMessage({
          type: 'nostr.requests.respond',
          payload: { requestId: id, approved: true, duration: 'once' },
        }),
      requestId,
    );

    expect(result).toMatchObject({ applied: false, reason: 'already-resolved' });

    const outcome = await site.evaluate(
      () => (window as unknown as { __signing: Promise<unknown> }).__signing,
    );
    expect(isSignature(outcome)).toBe(false);

    await site.close();
  });
});

test.describe('a request interrupted by a worker restart', () => {
  test('is not left approvable, and the page gets no signature', async ({
    openPage,
    background,
    context,
  }) => {
    const extensionPage = await openPage('/login');
    await createVault(extensionPage);
    await seedAccount(extensionPage);

    const site = await context.newPage();
    await site.goto('https://example.com');
    await requestSignatureFromPage(site);

    await expect
      .poll(() => background.evaluate(() => chrome.action.getBadgeText({})), { timeout: 15_000 })
      .toBe('1');

    const requestId = await background.evaluate(async (key) => {
      const stored = (await chrome.storage.session.get(key)) as Record<string, unknown>;
      const records = stored[key] as Array<{ id: string }> | undefined;
      return records?.[0]?.id ?? null;
    }, QUEUE_KEY);

    expect(requestId).not.toBeNull();

    /*
     * A canary the extension never reads.
     *
     * The queue is empty after the restart, and that is only evidence of anything if session
     * storage survived it — otherwise the record would be gone because the browser dropped it and
     * this test would prove nothing about reconciliation. The canary is what separates those two.
     */
    await extensionPage.evaluate(() => chrome.storage.session.set({ 'e2e:canary': 'alive' }));

    // Playwright cannot stop an MV3 worker; CDP can.
    const client = await context.newCDPSession(extensionPage);
    await client.send('ServiceWorker.enable');
    await client.send('ServiceWorker.stopAllWorkers');
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    // Any message revives the worker, which is what runs the startup reconciliation.
    await extensionPage.evaluate(() => chrome.runtime.sendMessage({ type: 'ping' }));

    const canary = await extensionPage.evaluate(async () => {
      const stored = await chrome.storage.session.get('e2e:canary');
      return stored['e2e:canary'] ?? null;
    });
    expect(canary).toBe('alive');

    // The live callback died with the worker, so the request can never be honoured (D7).
    const result = await extensionPage.evaluate(
      (id) =>
        chrome.runtime.sendMessage({
          type: 'nostr.requests.respond',
          payload: { requestId: id, approved: true, duration: 'once' },
        }),
      requestId,
    );

    expect(result).toMatchObject({ applied: false });

    await expect
      .poll(() => background.evaluate(() => chrome.action.getBadgeText({})), { timeout: 15_000 })
      .toBe('');

    /*
     * Raced against a timeout rather than awaited.
     *
     * The worker died holding this promise's resolver, so it may never settle at all. A request
     * left pending forever is not the failure this guards against — a signature arriving for a
     * request nobody can approve is — so the assertion is that no signature appears, not that the
     * promise settles.
     */
    const outcome = await site.evaluate(() =>
      Promise.race([
        (window as unknown as { __signing: Promise<unknown> }).__signing,
        new Promise((resolve) => setTimeout(() => resolve({ stillPending: true }), 3_000)),
      ]),
    );
    expect(isSignature(outcome)).toBe(false);

    await site.close();
  });
});
