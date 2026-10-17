import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

/**
 * Every declared bridge action must be reachable, by one path or another.
 *
 * There are three: `dispatcher.ts`'s switch, used by the raw `chrome.runtime.onMessage` listener;
 * `bridge.on` registrations in `background.ts`, used by the Quasar bridge; and the page action
 * handlers in `background.ts`, served over the page channel (#246). An action declared in the union
 * but wired to none is a call that silently does nothing — no error, no route, no reply (#173).
 *
 * This reads the source rather than the runtime because `background.ts` cannot be imported: it
 * registers listeners and calls `initialize()` at load, which is the same reason coverage skips it.
 */

const ROOT = resolve(__dirname, '../..');

const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8');

const declaredActions = (): string[] => {
  const source = read('src/types/bridge-types.d.ts');
  const union = /export type BridgeAction =(.*?);/s.exec(source)?.[1] ?? '';
  return [...union.matchAll(/'([^']+)'/g)].map(([, action]) => action ?? '');
};

const dispatcherCases = (): string[] =>
  [...read('src-bex/dispatcher.ts').matchAll(/case '([^']+)'/g)].map(([, action]) => action ?? '');

const bridgeRegistrations = (): string[] =>
  [...read('src-bex/background.ts').matchAll(/bridge\.on\('([^']+)'/g)].map(
    ([, action]) => action ?? '',
  );

/** The bridge actions a web page may reach through `window.nostr` and WebLN, from the shared allowlist. */
const pageActions = (): string[] => {
  const source = read('src-bex/page-actions.ts');
  const map = /export const PAGE_METHOD_TO_ACTION = \{(.*?)\}/s.exec(source)?.[1] ?? '';
  return [...map.matchAll(/:\s*'([^']+)'/g)].map(([, action]) => action ?? '');
};

/** The body of `background.ts`'s page action handlers, served over the page channel. */
const pageHandlerSource = (): string =>
  /const pageActionHandlers: PageActionHandlers = \{(.*?)\n\};/s.exec(
    read('src-bex/background.ts'),
  )?.[1] ?? '';

const pageHandlers = (): string[] =>
  [...pageHandlerSource().matchAll(/^ {2}'([^']+)': async/gm)].map(([, action]) => action ?? '');

/**
 * Declared, wired to neither path, and sent by nothing.
 *
 * Recorded rather than fixed here: removing an action from the union is a contract change, and one
 * of these is a permission call, which deserves a deliberate decision rather than a tidy-up.
 */
const KNOWN_UNROUTED = ['permission.check', 'permission.grant', 'vault.setData'];

/**
 * Actions the extension's own surfaces send, which must reach the dispatcher.
 *
 * `sendBexMessage` prefers the Quasar bridge and falls back to `chrome.runtime.sendMessage`. It
 * looks for the bridge at `window.bridge` or `$q.bex`, neither of which exists in an extension
 * page — so the fallback is the *only* path a panel or dashboard call ever takes. An action
 * registered on the bridge alone silently returns null there, which is how the panel came to show
 * no requests while the queue held them (#177).
 */
const SURFACE_ACTIONS = [
  'nostr.requests.list',
  'nostr.requests.current',
  'nostr.requests.count',
  'nostr.requests.content',
  'nostr.requests.present',
  'nostr.requests.respond',
  'nostr.requests.requeuePresented',
  'nostr.requests.dismiss',
  'pages.originForTab',
  'sites.list',
  'sites.revoke',
  'sites.binding',
  'sites.useActiveAccount',
  'sites.countForAccount',
  'messaging.dmRelays.get',
  'messaging.dmRelays.publish',
  'messaging.send',
  'messaging.fetch',
  'messaging.readState',
  'messaging.markRead',
  'messaging.savedPeers.get',
  'messaging.savedPeers.add',
  'messaging.savedPeers.remove',
  'contacts.refresh',
  'account.signEvent',
  'vault.getView',
  'accounts.add',
  'accounts.rename',
  'accounts.remove',
  'accounts.revealSecret',
];

describe('bridge action routing', () => {
  const actions = declaredActions();
  const routed = new Set([...dispatcherCases(), ...bridgeRegistrations(), ...pageHandlers()]);

  it('parses every source, so this cannot pass by reading nothing', () => {
    expect(actions.length).toBeGreaterThan(40);
    expect(dispatcherCases().length).toBeGreaterThan(30);
    expect(bridgeRegistrations().length).toBe(1);
    expect(pageHandlers().length).toBeGreaterThan(8);
  });

  it('routes every declared action except the ones known to be unrouted', () => {
    const unrouted = actions.filter((action) => !routed.has(action));

    expect(unrouted.sort()).toEqual([...KNOWN_UNROUTED].sort());
  });

  it('has no route for an action that was never declared', () => {
    // A typo in a `case` or a `bridge.on` name is otherwise invisible: the action simply never
    // matches, and the caller gets silence.
    const undeclared = [...routed].filter((action) => !actions.includes(action));

    expect(undeclared).toEqual([]);
  });

  it('keeps the unrouted list honest', () => {
    // If one of these gains a route, this fails and the entry should be deleted rather than the
    // expectation loosened.
    for (const action of KNOWN_UNROUTED) {
      expect(actions).toContain(action);
      expect(routed.has(action)).toBe(false);
    }
  });

  it('routes every action an extension surface sends through the dispatcher', () => {
    const cases = new Set(dispatcherCases());
    const unreachable = SURFACE_ACTIONS.filter((action) => !cases.has(action));

    expect(unreachable).toEqual([]);
  });

  it('keeps that list honest against the declared union', () => {
    // A typo here would make the assertion above vacuous.
    for (const action of SURFACE_ACTIONS) {
      expect(actions).toContain(action);
    }
  });

  it('exposes nothing but ping on the Quasar bridge (#240, #246)', () => {
    // The bridge's other end is the content script, which runs in a website's renderer and is
    // untrusted, and a bridge handler cannot tell which port a message came from. Page actions use
    // the page channel, which can; everything else belongs on the raw listener, which checks the sender.
    expect(bridgeRegistrations()).toEqual(['ping']);
  });

  it('serves exactly the page allowlist over the page channel (#246)', () => {
    const pages = pageActions();
    // Ten since Porwr stopped originating zaps: diogel.getZapCapabilities and diogel.sendZap went (#271).
    expect(pages.length).toBe(10);

    expect([...pageHandlers()].sort()).toEqual([...pages].sort());
  });

  it('takes no page handler’s origin from what the page sent (#246)', () => {
    // Each handler gets the site from the port's browser-supplied sender as its own argument.
    const source = pageHandlerSource();
    expect(source.length).toBeGreaterThan(1000);
    // No handler reads an `origin` property off anything, or destructures one from its payload.
    expect(source).not.toMatch(/\.origin\b/);
    expect(source).not.toMatch(/async \(\{[^}]*\borigin\b[^}]*\}/);
  });
});
