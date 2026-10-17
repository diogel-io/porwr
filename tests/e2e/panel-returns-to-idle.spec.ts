import { expect, test } from './fixtures/extension';
import { createVault, requestSignatureFromPage, seedAccount } from './fixtures/vault';

/**
 * The panel returns to its idle view once nothing is waiting (#195).
 *
 * The defect this guards was not a missing navigation. The panel is one route rendering from
 * state, and its template already falls through to the idle view the moment `current` is null —
 * but `current` was never cleared, because the read that would have cleared it never came back.
 *
 * `nostr.requests.current` answers `null` when the queue is empty, and the raw message listener
 * withheld every `null` reply. The panel was left awaiting a promise that never settled and went
 * on showing a request the user had already approved.
 *
 * This lives end to end because the defect is in the seam between the panel and the worker, which
 * is exactly what a unit test mocks away — the same seam as #177 and #186.
 */
test.describe('after the last request is decided', () => {
  test('the panel returns to its idle view', async ({ openPage, context }) => {
    const setup = await openPage('/login');
    await createVault(setup);
    await seedAccount(setup);

    const site = await context.newPage();
    await site.goto('https://example.com');
    await requestSignatureFromPage(site);

    const panel = await openPage('/sidebar');
    await panel.locator('.current-request').waitFor({ state: 'visible', timeout: 20_000 });

    await panel
      .getByRole('button', { name: /approve/i })
      .first()
      .click();

    // The idle view, not the request screen. Generous timeout on purpose: the failure mode was a
    // 5s call timeout retried twice, so a short wait here would fail for the right reason by
    // accident and keep passing once the retries were tuned.
    await expect(panel.locator('.current-request')).toHaveCount(0, { timeout: 25_000 });
    await expect(panel.locator('.sidebar-home__account, .sidebar-home__empty')).not.toHaveCount(0);

    await site.close();
  });

  test('asking for the current request answers instead of hanging', async ({ openPage }) => {
    const panel = await openPage('/sidebar');
    await createVault(panel);

    /*
     * The mechanism under the test above.
     *
     * Without this, that test could start passing again for an unrelated reason — the queue
     * clearing by some other route — while a null reply was still being withheld. Raced against a
     * short timeout because the failure is silence, which no assertion on a returned value can
     * catch: an unanswered `sendMessage` never rejects, it simply never settles.
     */
    const reply = await panel.evaluate(async () => {
      const answered = await Promise.race([
        chrome.runtime
          .sendMessage({ type: 'nostr.requests.current' })
          .then((value: unknown) => ({ settled: true, value: value ?? null })),
        new Promise((resolve) => setTimeout(() => resolve({ settled: false }), 3_000)),
      ]);
      return answered as { settled: boolean; value?: unknown };
    });

    expect(reply.settled).toBe(true);
    expect(reply.value).toBeNull();
  });
});
