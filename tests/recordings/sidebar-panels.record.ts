import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';
import { finalizeEvent } from 'nostr-tools/pure';
import { hexToBytes } from '@noble/hashes/utils';

import { expect, test } from '../e2e/fixtures/extension';
import { createVault, lockVault, seedAccounts } from '../e2e/fixtures/vault';
import { assemblePanelPage, type RecordedPanel } from './assemble-panels';

/**
 * Records every sidebar state reachable from one window, as the built extension renders it.
 *
 * The output is the design record `10-products/porwr/design/sidebar-design/sidebar-panel-states.html`
 * in the Diogel workspace. Each panel is the markup the panel rendered at 360 x 640 in the light
 * theme, plus the stylesheet rules that matched something on screen in any state, so the page shows
 * the build rather than a drawing of it (diogel-io/workspace#5).
 *
 * Steps only assert what they need to reach the next state. A state the build cannot reach is not
 * recorded: S13's expired notice is the known case (workspace README, observation 7).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const ASSETS = join(ROOT, 'dist/bex-chrome/www/assets');

const OUT = resolve(
  process.env.RECORD_OUT ?? join(ROOT, 'test-results/recordings/sidebar-panel-states.html'),
);
/** Optional: a folder for a screenshot of each live panel, to compare the page against. */
const SCREENSHOTS = process.env.RECORD_SCREENSHOTS ? resolve(process.env.RECORD_SCREENSHOTS) : null;

/** Fixed identities, so a recording only changes when the build does. Public keys from nostr-tools. */
const ELIN = {
  alias: 'elin',
  privkey: '1'.repeat(64),
  pubkey: '4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa',
};
const RHYS = {
  alias: 'rhys',
  privkey: '2'.repeat(64),
  pubkey: '466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27',
};

const SNORT = 'https://snort.social';
const INSECURE = 'http://notes.example';
const STALL = 'https://stall.example';
const SITE_HTML = '<!doctype html><title>site</title><p>site</p>';

/** Captions, in page order. Keys are the order the states are reached in, which differs. */
const CAPTIONS: Record<string, { title: string; note: string }> = {
  s1: {
    title: 'S1 · Idle, unlocked',
    note: 'Current tab connected as the active account, profile card with npub. Account switcher and lock in the header.',
  },
  's1-mismatch': {
    title: 'S1 · Site connected as another account',
    note: 'The active account is rhys; the site in the current tab is still connected as elin. Offers to move it.',
  },
  s16: {
    title: 'S16 · No account configured',
    note: 'Vault exists and is unlocked, no keys. Onboarding prompt to Keys.',
  },
  s17: {
    title: 'S17 · No vault',
    note: 'Setup view: what Porwr is and the vault form. No footer, switcher or lock.',
  },
  s2: { title: 'S2 · Locked, no request', note: 'Unlock view. No footer, switcher or lock.' },
  s5: {
    title: 'S5 / S15 · Locked, request waiting',
    note: 'Names the waiting origin; Reject available without unlocking. Header carries the count.',
  },
  's3-standard': {
    title: 'S3 · Sign event, standard (kind 1)',
    note: 'Summary preview. Remember-this-choice offers once, 8 hours and always.',
  },
  's3-elevated': {
    title: 'S3 · Elevated (kind 5, D12)',
    note: 'Deletion warning and insecure-origin notice. Once or 8 hours, never always.',
  },
  's3-unknown': { title: 'S3 · Unrecognised kind', note: 'Opens on the full event. Once only.' },
  payment: {
    title: 'Payment · WebLN, once only (D11)',
    note: 'webln.sendPayment from the page. Once only, no preview modes.',
  },
  s7: {
    title: 'S7 · Multiple pending',
    note: 'Current request, then the list of all four waiting. Scroll the panel to see the list.',
  },
};

const recorded = new Map<string, string>();
const usedRules = new Set<string>();
let bodyClass = '';

/**
 * Marks every stylesheet rule whose selector matches something on screen now.
 *
 * Interaction states (`:hover`, `:focus`) are stripped before matching so a control's rules are
 * kept with it; a selector the browser cannot query is kept rather than guessed at.
 */
async function markUsedRules(panel: Page): Promise<void> {
  const used = await panel.evaluate(() => {
    const strip = (selector: string): string =>
      selector
        .replace(/::?(before|after|placeholder|selection|-webkit-[a-z-]+|-moz-[a-z-]+)/g, '')
        .replace(/:(hover|focus-visible|focus-within|focus|active|visited)/g, '')
        .trim() || '*';
    const matches = (selectorText: string): boolean =>
      selectorText.split(',').some((part) => {
        try {
          return !!document.querySelector(strip(part));
        } catch {
          return true;
        }
      });
    const out: string[] = [];
    const walk = (rules: CSSRuleList, path: string): void => {
      Array.from(rules).forEach((rule, i) => {
        const id = `${path}/${i}`;
        if (rule instanceof CSSStyleRule) {
          if (matches(rule.selectorText)) out.push(id);
        } else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
          walk(rule.cssRules, id);
        }
      });
    };
    Array.from(document.styleSheets).forEach((sheet, i) => {
      try {
        walk(sheet.cssRules, sheet.href ?? `inline:${i}`);
      } catch {
        /* a cross-origin sheet, such as the Google Fonts import */
      }
    });
    return out;
  });
  for (const id of used) usedRules.add(id);
}

/**
 * The rules marked in any state, in document order.
 *
 * Media queries are resolved here, at the panel's own 360 x 640, rather than left for the page that
 * shows the recording to evaluate against its much wider viewport. Without that, the header's
 * `max-width: 360px` rule stops applying and the wordmark the build hides reappears.
 */
async function usedStyles(panel: Page): Promise<string> {
  return panel.evaluate((ids) => {
    const keep = new Set(ids);
    const out: string[] = [];
    const walk = (rules: CSSRuleList, path: string): void => {
      Array.from(rules).forEach((rule, i) => {
        const id = `${path}/${i}`;
        if (rule instanceof CSSStyleRule) {
          if (keep.has(id)) out.push(rule.cssText);
        } else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
          const applies =
            rule instanceof CSSMediaRule
              ? window.matchMedia(rule.conditionText).matches
              : CSS.supports(rule.conditionText);
          if (applies) walk(rule.cssRules, id);
        } else if (rule instanceof CSSFontFaceRule) {
          if (/Material Icons/.test(rule.cssText)) out.push(rule.cssText);
        } else if (rule instanceof CSSKeyframesRule) {
          out.push(rule.cssText);
        }
      });
    };
    Array.from(document.styleSheets).forEach((sheet, i) => {
      try {
        walk(sheet.cssRules, sheet.href ?? `inline:${i}`);
      } catch {
        /* cross-origin */
      }
    });
    return out.join('\n');
  }, Array.from(usedRules));
}

async function record(panel: Page, key: string): Promise<void> {
  // Let transitions and the queue's follow-up reads settle.
  await panel.waitForTimeout(1200);
  if (SCREENSHOTS) await panel.screenshot({ path: join(SCREENSHOTS, `${key}.png`) });
  await markUsedRules(panel);
  const snapshot = await panel.evaluate(() => ({
    bodyClass: document.body.className,
    markup: document.getElementById('q-app')?.outerHTML ?? '',
  }));
  bodyClass ||= snapshot.bodyClass;
  recorded.set(key, snapshot.markup);
}

/** Calls the page's provider without awaiting it: the promise settles only once decided. */
async function ask(site: Page, call: string): Promise<void> {
  await site.waitForFunction(() => 'nostr' in window && 'webln' in window, null, {
    timeout: 15_000,
  });
  await site.evaluate((code) => {
    const held = window as unknown as { __held?: unknown[] };
    held.__held ??= [];
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const pending = new Function(`return (${code})`)() as Promise<unknown>;
    held.__held.push(pending.catch((error: unknown) => ({ error: String(error) })));
  }, call);
}

const signEvent = (event: object): string => `window.nostr.signEvent(${JSON.stringify(event)})`;

/** The page's Inter is the Google Fonts one the build imports; the recording embeds the same. */
async function fetchInterLatin(): Promise<Buffer> {
  const css = await (
    await fetch(
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
      {
        // Google serves woff2 only to a browser it recognises.
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
        },
      },
    )
  ).text();
  const latin = /\/\* latin \*\/\s*@font-face\s*\{[^}]*url\((https:[^)]+\.woff2)\)/.exec(css)?.[1];
  if (!latin) throw new Error('Could not find the latin Inter subset in the Google Fonts CSS.');
  return Buffer.from(await (await fetch(latin)).arrayBuffer());
}

function revision(): string {
  const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT })
    .toString()
    .trim();
  const dirty = execFileSync('git', ['status', '--porcelain', '--', 'src', 'src-bex'], {
    cwd: ROOT,
  })
    .toString()
    .trim();
  return dirty ? `${sha}-dirty` : sha;
}

test('record the sidebar panel states', async ({ openPage, context }) => {
  if (SCREENSHOTS) mkdirSync(SCREENSHOTS, { recursive: true });

  // A stand-in relay, so the profile card shows a profile without depending on the network.
  const profile = finalizeEvent(
    {
      kind: 0,
      created_at: 1767225600,
      tags: [],
      content: JSON.stringify({
        name: 'elin',
        display_name: 'Elin Prydderch',
        about: 'Nostr since 2023. Cardiff.',
        nip05: 'elin@example.com',
        lud16: 'elin@example.com',
      }),
    },
    hexToBytes(ELIN.privkey),
  );
  await context.routeWebSocket(/.*/, (ws) => {
    ws.onMessage((message) => {
      const frame = JSON.parse(String(message)) as unknown[];
      if (frame[0] !== 'REQ') return;
      const subscription = frame[1];
      const filters = frame.slice(2) as { kinds?: number[]; authors?: string[] }[];
      if (filters.some((f) => f.kinds?.includes(0) && f.authors?.includes(ELIN.pubkey))) {
        ws.send(JSON.stringify(['EVENT', subscription, profile]));
      }
      ws.send(JSON.stringify(['EOSE', subscription]));
    });
  });
  for (const origin of [SNORT, INSECURE, STALL]) {
    await context.route(`${origin}/**`, (route) =>
      route.fulfill({ contentType: 'text/html', body: SITE_HTML }),
    );
  }

  // S17 · no vault. The light theme is set first; the panel defaults to dark.
  const panel = await openPage('/sidebar');
  await panel.setViewportSize({ width: 360, height: 640 });
  await panel.evaluate(() => chrome.storage.local.set({ 'nostr:dark-mode': false }));
  await panel.reload();
  await panel.locator('.sidebar-setup').waitFor({ state: 'visible' });
  await record(panel, 's17');

  // S16 · a vault with no accounts
  const setup = await openPage('/login');
  await createVault(setup);
  await panel.reload();
  await panel.locator('.sidebar-home__empty .q-btn').waitFor({ state: 'visible', timeout: 30_000 });
  await record(panel, 's16');

  // S1 · idle, the active tab on a site connected as the active account
  await seedAccounts(setup, [ELIN, RHYS]);
  const site = await context.newPage();
  await site.goto(SNORT);
  await ask(site, 'window.nostr.getPublicKey()');
  await panel.reload();
  await panel.locator('.current-request').waitFor({ state: 'visible', timeout: 30_000 });
  await panel
    .getByRole('button', { name: /approve/i })
    .first()
    .click();
  await expect(panel.locator('.current-request')).toHaveCount(0, { timeout: 25_000 });
  await site.bringToFront();
  await panel.reload();
  await panel.locator('.profile-card').waitFor({ state: 'visible', timeout: 30_000 });
  await record(panel, 's1');

  // S1 · the site is still connected as elin while rhys is active
  await setup.evaluate((alias) => chrome.storage.local.set({ 'nostr:active': alias }), RHYS.alias);
  await panel.reload();
  await panel.locator('.profile-card').waitFor({ state: 'visible', timeout: 30_000 });
  await record(panel, 's1-mismatch');
  await setup.evaluate((alias) => chrome.storage.local.set({ 'nostr:active': alias }), ELIN.alias);
  await panel.reload();
  await panel.locator('.sidebar-home__account').waitFor({ state: 'visible', timeout: 30_000 });

  const now = Math.floor(Date.now() / 1000);
  const presented = () =>
    panel.locator('.current-request').waitFor({ state: 'visible', timeout: 30_000 });
  const reject = async (): Promise<void> => {
    await panel.getByRole('button', { name: 'Reject', exact: true }).first().click();
    await panel.waitForTimeout(1500);
  };

  // S3 · standard, kind 1
  await ask(
    site,
    signEvent({
      kind: 1,
      created_at: now,
      content: 'Bore da! First light over the Taff this morning. ☕',
      tags: [
        ['p', RHYS.pubkey],
        ['t', 'cardiff'],
      ],
    }),
  );
  await presented();
  await record(panel, 's3-standard');
  await reject();

  // S3 · elevated, kind 5, from an insecure origin
  const insecure = await context.newPage();
  await insecure.goto(INSECURE);
  await ask(
    insecure,
    signEvent({
      kind: 5,
      created_at: now,
      content: 'posted by mistake',
      tags: [['e', 'a'.repeat(64)]],
    }),
  );
  await presented();
  await record(panel, 's3-elevated');
  await reject();

  // S3 · a kind Porwr does not recognise
  await ask(
    site,
    signEvent({
      kind: 31999,
      created_at: now,
      content: '{"board":"todo"}',
      tags: [['d', 'porwr-board']],
    }),
  );
  await presented();
  await record(panel, 's3-unknown');
  await reject();

  // Payment · WebLN, once only. The invoice need only parse for its amount (21 sats).
  const stall = await context.newPage();
  await stall.goto(STALL);
  await ask(
    stall,
    `window.webln.sendPayment('lnbc210n1pjqz9xspp5qv3h8fkl0r7g6m2rzx0d3v5hs2a8n9w4kt7u6y3e0c1lpq5j8d2sdqqcqzzsxqyz5vqsp5x8z')`,
  );
  await presented();
  await record(panel, 'payment');
  await reject();

  // S7 · four waiting
  await ask(site, signEvent({ kind: 1, created_at: now, content: 'Testing, testing.', tags: [] }));
  await presented();
  await ask(
    stall,
    signEvent({ kind: 7, created_at: now, content: '+', tags: [['e', 'b'.repeat(64)]] }),
  );
  await ask(insecure, 'window.nostr.getPublicKey()');
  await ask(site, `window.nostr.nip04.encrypt(${JSON.stringify(RHYS.pubkey)}, 'see you at six')`);
  await expect(panel.locator('.pending-list__item')).toHaveCount(4, { timeout: 30_000 });
  await record(panel, 's7');

  for (let i = 0; i < 6 && (await panel.locator('.current-request').count()) > 0; i += 1)
    await reject();

  // S5 / S15 · locked with a request waiting
  await ask(site, signEvent({ kind: 1, created_at: now, content: 'gm', tags: [] }));
  await presented();
  await lockVault(setup);
  await panel.locator('.sidebar-unlock').waitFor({ state: 'visible', timeout: 30_000 });
  await record(panel, 's5');

  // S2 · locked, nothing waiting
  await reject();
  await expect(panel.locator('.sidebar-unlock__waiting')).toHaveCount(0, { timeout: 25_000 });
  await record(panel, 's2');

  const panels: RecordedPanel[] = Object.entries(CAPTIONS).map(([key, caption]) => {
    const markup = recorded.get(key);
    if (!markup) throw new Error(`State ${key} was not recorded.`);
    return { ...caption, markup };
  });

  const page = assemblePanelPage({
    panels,
    css: await usedStyles(panel),
    bodyClass,
    revision: revision(),
    assetsDir: ASSETS,
    interWoff2: await fetchInterLatin(),
  });
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, page);
  console.log(`Recorded ${panels.length} panels to ${OUT}`);
});
