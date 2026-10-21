import { expect, test } from './fixtures/extension';
import { createVault, requestSignatureFromPage, seedAccount } from './fixtures/vault';

/**
 * Lifecycle controls from diogel-io/workspace#139, in a real browser.
 *
 * Both are paths where the unit tests check the parts and only the browser shows the whole: the
 * auto-lock timer a freshly created vault starts, and a request interrupted when the tab that sent
 * it closes while another tab of the same site stays open.
 */

const QUEUE_KEY = 'nostr:request-queue';

test('a newly created vault locks when auto-lock comes due', async ({ openPage }) => {
  const page = await openPage('/login');
  await createVault(page);

  const isUnlocked = () =>
    page.evaluate(() => chrome.runtime.sendMessage({ type: 'vault.isUnlocked' }));
  expect(await isUnlocked()).toBe(true);

  // A timeout of a fraction of a minute, so the next 15-second check finds the vault overdue. The
  // setting is read on every check; the timer itself is what creating the vault must have started.
  await page.evaluate(() => chrome.storage.local.set({ 'vault:auto-lock-minutes': 0.001 }));

  await expect.poll(isUnlocked, { timeout: 45_000, intervals: [2_000] }).toBe(false);
});

test('closing the tab that asked interrupts its request, though the site is open elsewhere', async ({
  openPage,
  background,
  context,
}) => {
  const setup = await openPage('/login');
  await createVault(setup);
  await seedAccount(setup);

  const asking = await context.newPage();
  await asking.goto('https://example.com');
  const other = await context.newPage();
  await other.goto('https://example.com');
  await requestSignatureFromPage(asking);

  const queueStates = () =>
    background.evaluate(async (key) => {
      const stored = (await chrome.storage.session.get(key)) as Record<string, unknown>;
      return ((stored[key] as Array<{ state: string }> | undefined) ?? []).map((r) => r.state);
    }, QUEUE_KEY);

  await expect.poll(queueStates, { timeout: 15_000 }).toEqual(['queued']);

  await asking.close();

  // Another tab still holds https://example.com, which used to keep the request approvable.
  await expect.poll(queueStates, { timeout: 15_000 }).toEqual(['interrupted']);
  await expect
    .poll(() => background.evaluate(() => chrome.action.getBadgeText({})), { timeout: 15_000 })
    .toBe('');

  await other.close();
});
