import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from './fixtures/extension';
import { createVault } from './fixtures/vault';

/**
 * The wallet's approval popup keeps `window.opener`, because that is how Alby Hub and Coinos post
 * `nwc:success` back. An opener can also be navigated, so the popup is opened from a throwaway
 * connect window rather than from Wallet Connections (workspace#76).
 *
 * The real Coinos page is replaced with a stand-in at the same origin, so these run offline.
 */

const PHISH_URL = 'https://phish.test/';

/**
 * Serves `script` as the Coinos approval page, and a plain page for the look-alike.
 *
 * @returns A count of how many times the approval page was loaded.
 */
async function fakeCoinos(context: BrowserContext, script: string): Promise<{ loads: number }> {
  const served = { loads: 0 };
  await context.route('https://coinos.io/**', (route) => {
    served.loads += 1;
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Coinos</title><script>${script}</script>` });
  });
  await context.route(`${PHISH_URL}**`, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Porwr</title><p>Enter your mnemonic</p>' }),
  );
  return served;
}

async function openWalletConnections(page: Page): Promise<void> {
  await page.goto(page.url().replace(/#.*$/, '#/wallet-connections'));
  await page.reload();
  await expect(page.getByTestId('connect-coinos')).toBeVisible();
}

/** Clicks Connect Coinos and returns the connect window and the wallet popup it opens. */
async function connectCoinos(context: BrowserContext, page: Page): Promise<{ connectWindow: Page; wallet: Page }> {
  await page.getByTestId('connect-coinos').click();

  // Both windows start at `about:blank` before they navigate, so they are found by where they end
  // up rather than by the URL they were created with. The connect window may already have been
  // replaced by the time it is looked for.
  const find = (matches: (url: string) => boolean) => context.pages().find((p) => matches(p.url()));
  let wallet: Page | undefined;
  await expect.poll(() => (wallet = find((url) => url.startsWith('https://coinos.io/'))) !== undefined, { timeout: 45_000 }).toBe(true);
  await wallet!.waitForLoadState();

  const connectWindow = find((url) => url.includes('#/wallet-connect?') || url.startsWith(PHISH_URL))!;
  return { connectWindow, wallet: wallet! };
}

test.describe('wallet connect popup opener (workspace#76)', () => {
  test('a wallet that navigates its opener replaces only the connect window', async ({ context, openPage }) => {
    await fakeCoinos(
      context,
      `
      window.openerOpener = window.opener ? String(window.opener.opener) : 'no opener';
      window.opener.location = ${JSON.stringify(PHISH_URL)};
      `,
    );
    const page = await openPage('/login');
    await createVault(page);
    await openWalletConnections(page);
    const walletConnectionsUrl = page.url();

    const { connectWindow, wallet } = await connectCoinos(context, page);

    // The opener the wallet holds is the connect window, and it leads nowhere further.
    expect(await wallet.evaluate(() => (window as unknown as { openerOpener: string }).openerOpener)).toBe('null');
    await expect(connectWindow).toHaveURL(PHISH_URL);

    // Wallet Connections, with the user's state, is untouched.
    expect(page.url()).toBe(walletConnectionsUrl);
    await expect(page.getByTestId('connect-coinos')).toBeVisible();
    expect(context.pages().filter((p) => p.url().startsWith(PHISH_URL))).toEqual([connectWindow]);
  });

  test("the wallet's message still reaches Porwr, and the connect window closes", async ({ context, openPage }) => {
    // A well-formed message whose relay is unreachable: Porwr accepts it, then fails to confirm the
    // wallet with `get_info`, which reports back as an error. Reaching that error proves the round
    // trip from the wallet, through the connect window and the background, to Wallet Connections.
    const coinos = await fakeCoinos(
      context,
      `
      window.opener.postMessage({
        type: 'nwc:success',
        walletPubkey: '${'a'.repeat(64)}',
        relayUrl: 'wss://127.0.0.1:9/',
      }, '*');
      `,
    );
    const page = await openPage('/login');
    await createVault(page);
    await openWalletConnections(page);

    await page.getByTestId('connect-coinos').click();

    // The error comes from confirming the wallet, so the message got all the way through.
    await expect(page.locator('.q-notification.bg-negative .q-notification__message').first()).toHaveText(
      /No NIP-47 wallet info event found/,
      { timeout: 60_000 },
    );
    expect(coinos.loads).toBe(1);
    await expect.poll(() => context.pages().filter((p) => p.url().includes('#/wallet-connect?')).length).toBe(0);
    await expect(page.getByTestId('connect-coinos')).toBeEnabled();
  });
});
