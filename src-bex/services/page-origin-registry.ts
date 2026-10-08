/**
 * Page origin registry.
 *
 * Records which origin is loaded in which tab, so the panel can name the active site without the
 * `tabs` permission. `tab.url` is redacted from `chrome.tabs.query` unless the extension holds
 * `tabs` or a host permission, and NFR-18 forbids adding either on the Chromium build, so the
 * origin has to come from somewhere the browser already lets us see it.
 *
 * That place is the content script's port. Every content script opens a long-lived connection to
 * the background, and the browser stamps `port.sender` with the origin, tab id and window id of
 * the frame that opened it. The sender is set by the browser, not by the page, so a hostile page
 * cannot claim to be another origin here — the payload is never read and nothing the page controls
 * is trusted.
 *
 * `port.onDisconnect` fires when the frame goes away: navigation, tab close, window close, or
 * crash. That makes this registry a page-liveness signal as well as an origin lookup, which is
 * what #113 needs for reconciling requests whose page has gone.
 */

import { LogLevel, logService } from '@/services/log-service';

/** Survives a service-worker restart; `storage` is already granted, `session` adds no permission. */
const SESSION_KEY = 'porwr.pageOrigins';

interface PageOriginRecord {
  origin: string;
  windowId: number;
}

const origins = new Map<number, PageOriginRecord>();

type OriginListener = (tabId: number, record: PageOriginRecord | undefined) => void;

const listeners = new Set<OriginListener>();

const getSessionArea = (): chrome.storage.StorageArea | undefined =>
  (chrome.storage as { session?: chrome.storage.StorageArea } | undefined)?.session;

const persist = (): void => {
  const area = getSessionArea();
  if (!area) return;

  void area.set({ [SESSION_KEY]: Array.from(origins.entries()) }).catch((error: unknown) => {
    logService.log(LogLevel.DEBUG, '[Pages] Failed to persist page origins', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
};

const notify = (tabId: number, record: PageOriginRecord | undefined): void => {
  for (const listener of listeners) listener(tabId, record);
};

/** Only http(s) frames name a site the user can meaningfully be shown. */
const toDisplayableOrigin = (origin: string | undefined): string | undefined => {
  if (!origin) return undefined;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
};

export const recordPageOrigin = (sender: chrome.runtime.MessageSender): void => {
  const tabId = sender.tab?.id;
  const windowId = sender.tab?.windowId;
  // Only the top frame names the site. A cross-origin iframe has its own content script and must
  // not be able to relabel the tab it is embedded in.
  if (tabId === undefined || windowId === undefined || sender.frameId !== 0) return;

  const origin = toDisplayableOrigin(sender.origin ?? undefined);
  if (!origin) return;

  const record: PageOriginRecord = { origin, windowId };
  origins.set(tabId, record);
  persist();
  notify(tabId, record);
};

export const forgetPageOrigin = (tabId: number | undefined): void => {
  if (tabId === undefined || !origins.delete(tabId)) return;
  persist();
  notify(tabId, undefined);
};

export const getPageOrigin = (tabId: number): string | undefined => origins.get(tabId)?.origin;

/** Every tab currently known to hold a page, for callers reconciling against the request queue. */
export const listPageOrigins = (): ReadonlyMap<number, PageOriginRecord> => new Map(origins);

/** Notified whenever a page arrives or goes away. #113's page-gone reconciliation hangs here. */
export const onPageOriginChange = (listener: OriginListener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const restorePageOrigins = async (): Promise<void> => {
  const area = getSessionArea();
  if (!area) return;

  try {
    const stored = await area.get(SESSION_KEY);
    const entries = stored[SESSION_KEY];
    if (!Array.isArray(entries)) return;

    origins.clear();
    for (const entry of entries as Array<[number, PageOriginRecord]>) {
      const [tabId, record] = entry;
      if (typeof tabId === 'number' && typeof record?.origin === 'string') origins.set(tabId, record);
    }
  } catch (error: unknown) {
    logService.log(LogLevel.DEBUG, '[Pages] Failed to restore page origins', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Watch content-script connections.
 *
 * Ports opened by extension surfaces carry no `sender.tab` and are ignored, so this sees page
 * frames only.
 */
export const observePageConnections = (): void => {
  chrome.runtime.onConnect.addListener((port) => {
    const sender = port.sender;
    if (!sender?.tab) return;

    recordPageOrigin(sender);

    const tabId = sender.tab.id;
    port.onDisconnect.addListener(() => {
      forgetPageOrigin(tabId);
    });
  });

  // A closed tab may never disconnect its port cleanly; this needs no permission.
  chrome.tabs?.onRemoved?.addListener((tabId) => {
    forgetPageOrigin(tabId);
  });
};

export const __resetPageOriginsForTests = (): void => {
  origins.clear();
  listeners.clear();
};
