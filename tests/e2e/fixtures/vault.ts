import type { Page } from '@playwright/test';

/**
 * Vault helpers.
 *
 * The vault is the gate in front of everything else — the panel, signing, and every state in the
 * approval contract — so almost every end-to-end question needs it created and unlocked first.
 * That is precisely what could not be driven before this harness existed (#141).
 */

export const VAULT_PASSWORD = 'e2e-test-password';

const label = (page: Page, text: string) => page.getByLabel(text, { exact: true });

/**
 * Waits for the app to finish deciding which surface to show.
 *
 * `App.vue` waits on the background bridge for up to 10 seconds before routing, so anything that
 * asserts immediately after `goto` is racing the boot rather than testing the product.
 */
export async function waitForAppReady(page: Page): Promise<void> {
  // Deliberately not `.q-page`: that exists on the sidebar route before the boot logic has
  // decided anything, so waiting on it returns while the app is still mid-decision. The panel
  // shell and the vault card are the two settled outcomes.
  await page
    .locator('.sidebar-root, .vault-card')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
}

/**
 * Goes to the vault surface directly rather than letting a redirect take us there.
 *
 * Whether `#/sidebar` redirects to `#/login` is itself under investigation (#113), so a fixture
 * that depended on it would be testing the thing it is supposed to be a stable base for.
 */
async function gotoVaultSurface(page: Page): Promise<void> {
  if (!page.url().includes('#/login')) {
    await page.goto(page.url().replace(/#.*$/, '#/login'));
  }
  await page.locator('.vault-card').waitFor({ state: 'visible', timeout: 45_000 });
}

/** Creates a vault from a fresh profile, leaving it unlocked. */
export async function createVault(page: Page, password = VAULT_PASSWORD): Promise<void> {
  await gotoVaultSurface(page);
  await label(page, 'Password').fill(password);
  await label(page, 'Confirm Password').fill(password);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).waitFor({ state: 'detached' });
}

export async function unlockVault(page: Page, password = VAULT_PASSWORD): Promise<void> {
  await gotoVaultSurface(page);
  await label(page, 'Password').fill(password);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByRole('button', { name: 'Unlock', exact: true }).waitFor({ state: 'detached' });
}

/**
 * Locks the vault the way the background does on auto-lock.
 *
 * Sent from a page, not from the service worker: `chrome.runtime.sendMessage` does not deliver to
 * the sender's own listener, so a worker asking itself to lock is silently a no-op.
 */
export async function lockVault(page: Page): Promise<void> {
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'vault.lock' }));
}

/**
 * A fixed test identity.
 *
 * Deliberately not generated: a failure that only reproduces with the key that produced it is not
 * a failure anyone can act on.
 */
export const TEST_ACCOUNT = {
  alias: 'e2e',
  privkey: '1'.repeat(64),
  // The public key for that private key, computed once with nostr-tools and pinned here so the
  // fixture needs no crypto. A wrong value here would seed an account whose id does not match what
  // it signs with, which is exactly the kind of mismatch these tests exist to catch.
  pubkey: '4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa',
};

export interface SeedAccount {
  alias: string;
  privkey: string;
  pubkey: string;
}

/**
 * Puts accounts into an unlocked vault, without driving the key-management UI.
 *
 * Goes through `accounts.add`, the same narrow action the Import page uses: pages can no longer write
 * the whole vault (#240). The first account becomes active. The active account lives in
 * `chrome.storage.local` under `nostr:active`, which is what `resolveSigningAccount` reads when a
 * site has no binding yet.
 */
export async function seedAccounts(page: Page, accounts: readonly SeedAccount[]): Promise<void> {
  const results = await page.evaluate(async (list) => {
    const answers: unknown[] = [];
    for (const account of list) {
      answers.push(
        await chrome.runtime.sendMessage({ type: 'accounts.add', payload: { alias: account.alias, privkey: account.privkey } }),
      );
    }
    await chrome.storage.local.set({ 'nostr:active': list[0]?.alias });
    return answers;
  }, accounts);

  results.forEach((result, index) => {
    const expected = accounts[index]!;
    if (!result || typeof result !== 'object' || (result as { id?: string }).id !== expected.pubkey) {
      throw new Error(`Could not seed ${expected.alias}: ${JSON.stringify(result)}`);
    }
  });
}

/** Puts the one fixed test account into an unlocked vault. */
export async function seedAccount(page: Page): Promise<void> {
  await seedAccounts(page, [TEST_ACCOUNT]);
}

/**
 * Asks the extension to sign, from a real page, through the injected provider.
 *
 * Deliberately does not await the result. The promise settles only when the request is decided, and
 * the interval while it is pending is the thing under test.
 */
export async function requestSignatureFromPage(sitePage: Page): Promise<void> {
  await sitePage.evaluate(() => {
    const provider = (window as unknown as { nostr?: { signEvent: (event: unknown) => Promise<unknown> } })
      .nostr;
    if (!provider) throw new Error('window.nostr was not injected into the page');

    // Held so the promise is not garbage, and so a later test can inspect it if needed.
    (window as unknown as { __signing?: unknown }).__signing = provider
      .signEvent({ kind: 1, content: 'e2e', tags: [], created_at: Math.floor(Date.now() / 1000) })
      .catch((error: unknown) => ({ error: String(error) }));
  });
}
