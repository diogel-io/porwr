/**
 * Panel presence.
 *
 * Chromium offers no way to ask whether the side panel is open, and Firefox's
 * `sidebarAction.isOpen` answers only for Firefox. Rather than branch on the browser, presence is
 * taken from a long-lived port the panel opens on mount and the browser tears down when the panel
 * closes. One mechanism, both browsers (ADR D17).
 *
 * Presence is a presentation fact, never a lifecycle one. When the last panel goes away the
 * presented request returns to the queue; nothing is decided, rejected or duplicated, because
 * closing the panel is not a decision (FR-6, S11).
 *
 * The same connection carries queue notifications outward (#140). They say only "the queue moved",
 * never what it moved to: the background stays the single source of truth, and a panel that acts on
 * a notification does so by re-reading rather than by trusting a payload it was handed.
 */

import { LogLevel, logService } from '@/services/log-service';
import { resolvePanelSurface } from './panel-surface';
import { requeuePresented } from './request-queue';

export const PANEL_PORT_NAME = 'porwr-panel';

/** The only message the background sends a panel: re-read the queue. */
export const QUEUE_CHANGED_MESSAGE = { type: 'queue-changed' } as const;

type PresenceListener = (present: boolean) => void;

const panels = new Set<chrome.runtime.Port>();
const listeners = new Set<PresenceListener>();

export const isPanelPresent = (): boolean => panels.size > 0;

export const getPanelCount = (): number => panels.size;

export const onPanelPresenceChange = (listener: PresenceListener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const notify = (): void => {
  const present = isPanelPresent();
  for (const listener of listeners) listener(present);
};

const handleDisconnect = (port: chrome.runtime.Port): void => {
  if (!panels.delete(port)) return;

  notify();
  if (panels.size > 0) return;

  // The last panel has gone. A request left in `presented` would otherwise stay that way until
  // something else touched the queue, and would be re-presented to nobody.
  void requeuePresented().catch((error: unknown) => {
    logService.log(LogLevel.ERROR, '[Panel] Failed to requeue after the last panel closed', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
};

/**
 * Watch for panels connecting.
 *
 * Filtered on the port name alone. Content scripts connect too, but under the bridge's own name,
 * so the name is already decisive. Rejecting ports that carry a `sender.tab` would additionally
 * reject the panel opened as a tab, which is how it is run during development (#142) — the panel
 * is the same page either way and should count as present either way.
 */
export const observePanelConnections = (): void => {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PANEL_PORT_NAME) return;

    panels.add(port);
    notify();
    port.onDisconnect.addListener(() => handleDisconnect(port));
  });
};

/**
 * Tell every open panel that the queue moved.
 *
 * Deliberately carries no state. A payload would have to be built per panel and could arrive out of
 * order behind a decision the background has already applied, which is how a panel ends up showing
 * a resolved request as actionable. A bare notification cannot go stale — the panel re-reads, and
 * the background answers with what is true now.
 *
 * A panel that has gone without its disconnect having been processed yet will throw here; that is
 * expected and not worth logging, since `onDisconnect` cleans it up immediately afterwards.
 */
export const notifyPanelsOfQueueChange = (): void => {
  for (const port of panels) {
    try {
      port.postMessage(QUEUE_CHANGED_MESSAGE);
    } catch {
      /* the port is closing; onDisconnect removes it */
    }
  }
};

/**
 * Reconcile the port's view of presence against the browser's, where the browser has one.
 *
 * The port is the source of truth: it is the only mechanism both browsers support, and it is what
 * `requeuePresented` and the badge already follow. This does not replace it — it catches the one
 * case the port cannot see, a panel that went away without its `onDisconnect` firing, which leaves a
 * request `presented` to nobody.
 *
 * Firefox answers through `sidebarAction.isOpen`; Chromium has no equivalent and returns undefined.
 * Undefined means "no opinion" and is never treated as "closed" — acting on a guess would tear down
 * a live panel's presence on the browser where most people run this (#113).
 */
export const reconcilePanelPresence = async (windowId?: number): Promise<void> => {
  if (!isPanelPresent()) return;

  const surface = resolvePanelSurface();
  const browserSaysOpen = await surface.isOpenAccordingToBrowser(windowId);
  if (browserSaysOpen !== false) return;

  logService.log(LogLevel.WARN, '[Panel] Browser reports no panel while a port is still held', {
    ports: panels.size,
  });

  // Drop the stale ports and let the normal path run: presence changes, and the last one going
  // requeues whatever was presented. Nothing here decides a request.
  for (const port of [...panels]) {
    try {
      port.disconnect();
    } catch {
      /* already gone */
    }
    handleDisconnect(port);
  }
};

export const __resetPanelPresenceForTests = (): void => {
  panels.clear();
  listeners.clear();
};
