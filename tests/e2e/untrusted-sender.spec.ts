import type { CDPSession, Page } from '@playwright/test';

import { expect, test } from './fixtures/extension';
import { createVault, requestSignatureFromPage, seedAccount, TEST_ACCOUNT } from './fixtures/vault';

/**
 * A website's renderer cannot use Porwr's privileged channel (#240).
 *
 * Porwr's content script runs inside every site's renderer, so Chromium treats what it sends as
 * untrusted: a compromised renderer can send anything the content script can. This runs code in that
 * content script's real execution context — the isolated world, reached over CDP — and checks the
 * background refuses it, while the same request from one of Porwr's own pages still works.
 */

type Isolated = { id: number; name: string };

/** Watches a page's execution contexts and returns Porwr's content-script world once it exists. */
async function contentScriptWorld(page: Page, cdp: CDPSession): Promise<() => Promise<number>> {
  const worlds: Isolated[] = [];
  cdp.on('Runtime.executionContextCreated', ({ context }) => {
    const aux = context.auxData as { type?: string; frameId?: string } | undefined;
    if (aux?.type === 'isolated') worlds.push({ id: context.id, name: context.name });
  });
  await cdp.send('Runtime.enable');
  return async () => {
    await expect.poll(() => worlds.find((world) => world.name === 'Porwr')?.id, { timeout: 15_000 }).toBeDefined();
    return worlds.find((world) => world.name === 'Porwr')!.id;
  };
}

async function sendFromContentScript(cdp: CDPSession, contextId: number, message: object): Promise<unknown> {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    contextId,
    expression: `new Promise((resolve) => chrome.runtime.sendMessage(${JSON.stringify(message)}, (response) => resolve(response ?? null)))`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  return result.value;
}

test.describe('the background checks who is asking', () => {
  test("refuses a website's content script, and still answers Porwr's own pages", async ({ openPage, context }) => {
    const extensionPage = await openPage('/login');
    await createVault(extensionPage);
    await seedAccount(extensionPage);

    const site = await context.newPage();
    const cdp = await context.newCDPSession(site);
    const porwrWorld = await contentScriptWorld(site, cdp);
    await site.goto('https://example.com');
    const contextId = await porwrWorld();

    // What a compromised renderer would try: read every key, approve its own request, revoke a site.
    for (const message of [
      { type: 'vault.getData', payload: {} },
      { type: 'nostr.requests.respond', payload: { requestId: 'any', decision: 'approve' } },
      { type: 'sites.revoke', payload: { origin: 'https://example.com' } },
    ]) {
      expect(await sendFromContentScript(cdp, contextId, message)).toEqual({ success: false, error: 'Untrusted sender' });
    }

    // The control: the same read from an extension page is answered.
    const fromPage = (await extensionPage.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'vault.getData', payload: {} }),
    )) as { success?: boolean; vaultData?: { accounts?: { alias: string }[] } };
    expect(fromPage.success).toBe(true);
    expect(fromPage.vaultData?.accounts?.map((account) => account.alias)).toEqual([TEST_ACCOUNT.alias]);
  });

  test('still serves window.nostr to the site through the content script', async ({ openPage, context }) => {
    const extensionPage = await openPage('/login');
    await createVault(extensionPage);
    await seedAccount(extensionPage);

    const site = await context.newPage();
    await site.goto('https://example.com');

    // The bridge still carries page actions: a request reaches the background and waits for the
    // user, which shows as the pending badge.
    await requestSignatureFromPage(site);
    await expect
      .poll(() => extensionPage.evaluate(() => chrome.runtime.sendMessage({ type: 'nostr.requests.count' })), {
        timeout: 15_000,
      })
      .toBe(1);
  });
});
