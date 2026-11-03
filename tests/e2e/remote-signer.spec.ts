import { spawn, type ChildProcess } from 'node:child_process';

import type { Page } from '@playwright/test';
import { getPublicKey, verifyEvent, type Event } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils.js';

import { expect, test } from './fixtures/extension';
import { nakAvailable, startRelay } from './fixtures/relays';
import { createVault } from './fixtures/vault';

/**
 * A remote-signer account in a real browser (diogel-io/workspace#138, T39).
 *
 * `nak bunker` plays the remote signer on a local `nak serve` relay. The account is connected from
 * its `bunker://` URI through the Add New Key page, and a website then signs through it: Porwr's own
 * approval comes first, the signature is the bunker's key, and a rejected request reaches the
 * bunker not at all. The vault never holds the user's private key.
 */

const USER_SECRET = '5'.repeat(64);
const USER_PUBKEY = getPublicKey(hexToBytes(USER_SECRET));
const CONNECT_SECRET = 'e2e-connect-secret';
const SITE = 'https://example.com';

interface Bunker {
  uri: string;
  /** Every method the bunker has been asked for so far, read from its log. */
  methods: () => string[];
  stop: () => void;
}

async function startBunker(relay: string): Promise<Bunker> {
  let log = '';
  const child: ChildProcess = spawn(
    'nak',
    ['bunker', '--sec', USER_SECRET, '-s', CONNECT_SECRET, relay],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout?.on('data', (chunk: Buffer) => (log += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (log += chunk.toString()));
  try {
    await expect.poll(() => log.includes('bunker:'), { timeout: 10_000 }).toBe(true);
  } catch (error: unknown) {
    // A bunker that never came up must not outlive the test, holding the worker open.
    child.kill();
    throw error;
  }
  return {
    uri: `bunker://${USER_PUBKEY}?relay=${encodeURIComponent(relay)}&secret=${CONNECT_SECRET}`,
    methods: () => [...log.matchAll(/"method": "([a-z0-9_]+)"/g)].map((match) => match[1]!),
    stop: () => child.kill(),
  };
}

async function signFromSite(site: Page): Promise<void> {
  await site.evaluate(() => {
    const provider = (
      window as unknown as { nostr?: { signEvent: (event: unknown) => Promise<unknown> } }
    ).nostr;
    if (!provider) throw new Error('window.nostr was not injected into the page');
    (window as unknown as { __signing?: Promise<unknown> }).__signing = provider
      .signEvent({
        kind: 1,
        content: 'from a remote signer',
        tags: [['t', 'e2e']],
        created_at: 1_700_000_000,
      })
      .catch((error: unknown) => ({ error: String(error) }));
  });
}

const signingResult = (site: Page) =>
  site.evaluate(() => (window as unknown as { __signing: Promise<unknown> }).__signing);

test.describe('remote-signer accounts (#138)', () => {
  test.beforeEach(({}, testInfo) => {
    if (!nakAvailable()) {
      if (process.env.CI) throw new Error('nak is required for the remote-signer e2e test.');
      testInfo.skip(true, 'install nak to run the remote-signer e2e test');
    }
  });

  test('connects from a bunker URI and signs for a site only after Porwr’s approval', async ({
    openPage,
    context,
  }) => {
    test.setTimeout(120_000);
    const relay = await startRelay([]);
    let bunker: Bunker;
    try {
      bunker = await startBunker(relay.url);
    } catch (error: unknown) {
      relay.process.kill();
      throw error;
    }
    try {
      const setup = await openPage('/login');
      await createVault(setup);

      // Connect through the real form, as a user would.
      const keys = setup;
      await keys.goto(keys.url().replace(/#.*$/, '#/keys/new'));
      await keys.getByTestId('remote-signer-uri').fill(bunker.uri);
      await keys.getByTestId('remote-signer-alias').fill('bunker');
      await keys.getByTestId('remote-signer-connect').click();
      await expect(keys.getByTestId('remote-signer-details')).toBeVisible({ timeout: 30_000 });
      expect(bunker.methods()).toEqual(expect.arrayContaining(['connect', 'get_public_key']));

      // No private key for the account is anywhere in what the background shows a page.
      const vault = await keys.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'vault.getView' }),
      );
      expect(vault).toEqual({
        accounts: [expect.objectContaining({ id: USER_PUBKEY, alias: 'bunker', kind: 'remote' })],
      });
      expect(JSON.stringify(vault)).not.toMatch(/privkey|clientSecret|e2e-connect-secret/);

      const panel = await openPage('/sidebar');
      const site = await context.newPage();
      await site.goto(SITE);

      // A rejected request never reaches the signer.
      await signFromSite(site);
      await panel.locator('.current-request').waitFor({ state: 'visible', timeout: 20_000 });
      await panel
        .getByRole('button', { name: /reject/i })
        .first()
        .click();
      expect(await signingResult(site)).toEqual({ error: expect.stringMatching(/rejected/i) });
      expect(bunker.methods()).not.toContain('sign_event');

      // An approved one is signed by the bunker, as exactly the approved event.
      await signFromSite(site);
      await panel.locator('.current-request').waitFor({ state: 'visible', timeout: 20_000 });
      expect(bunker.methods()).not.toContain('sign_event');
      await panel
        .getByRole('button', { name: /approve/i })
        .first()
        .click();
      const signed = (await signingResult(site)) as Event;

      expect(signed).toMatchObject({
        pubkey: USER_PUBKEY,
        kind: 1,
        content: 'from a remote signer',
        tags: [['t', 'e2e']],
        created_at: 1_700_000_000,
      });
      expect(verifyEvent(signed)).toBe(true);
      expect(bunker.methods().filter((method) => method === 'sign_event')).toHaveLength(1);

      await site.close();
    } finally {
      bunker.stop();
      relay.process.kill();
    }
  });
});
