import type { BridgeRequestMap } from '../src/types/bridge';

/**
 * What a website may ask Porwr for, through `window.nostr` and WebLN.
 *
 * Shared by both ends of the page channel: the content script maps a provider method to its action,
 * and the background serves those actions and nothing else (#240, #246). Anything outside this map,
 * such as `approval.respond`, must never be reachable from a page.
 */
export const PAGE_METHOD_TO_ACTION = {
  getPublicKey: 'nostr.getPublicKey',
  signEvent: 'nostr.signEvent',
  getRelays: 'nostr.getRelays',
  'nip04.encrypt': 'nostr.nip04.encrypt',
  'nip04.decrypt': 'nostr.nip04.decrypt',
  'nip44.encrypt': 'nostr.nip44.encrypt',
  'nip44.decrypt': 'nostr.nip44.decrypt',
  'webln.enable': 'webln.enable',
  'webln.getInfo': 'webln.getInfo',
  'webln.sendPayment': 'webln.sendPayment',
} as const;

export type PageMethod = keyof typeof PAGE_METHOD_TO_ACTION;
export type PageAction = (typeof PAGE_METHOD_TO_ACTION)[PageMethod];

export const PAGE_ACTIONS: ReadonlySet<string> = new Set<string>(
  Object.values(PAGE_METHOD_TO_ACTION),
);

export const isPageMethod = (method: unknown): method is PageMethod =>
  typeof method === 'string' && Object.hasOwn(PAGE_METHOD_TO_ACTION, method);

export const isPageAction = (action: unknown): action is PageAction =>
  typeof action === 'string' && PAGE_ACTIONS.has(action);

/**
 * What a page may send for an action. Never its origin, which the background takes from the
 * browser-supplied sender, and never an approval, which only the user gives.
 */
export type PagePayload<A extends PageAction> = Omit<
  BridgeRequestMap[A],
  'id' | 'action' | 'origin' | 'approved'
>;

/** The port a content script opens to carry page requests to the background. */
export const PAGE_PORT_NAME = 'porwr:page';

/** One page request on the port, and its answer. */
export interface PageRequestMessage {
  id: string;
  action: string;
  payload?: unknown;
}

export type PageReplyMessage = { id: string; result: unknown } | { id: string; error: string };
