/**
 * Panel surface port.
 *
 * Chromium exposes the panel through `chrome.sidePanel`; Firefox exposes it through
 * `chrome.sidebarAction`. Both are reached only through this port, so no Vue component and no
 * handler calls a browser panel API directly (ADR D17).
 *
 * Neither browser permits opening the panel without a user gesture, so this port offers no
 * "open on demand" call. `openFromUserGesture` must only be invoked from inside a gesture
 * handler such as the toolbar action (ADR D4).
 */

import { LogLevel, logService } from '@/services/log-service';

export type PanelSurfaceKind = 'chromium' | 'firefox' | 'unsupported';

export interface PanelSurface {
  /** Which implementation is active for the running browser. */
  readonly kind: PanelSurfaceKind;
  /**
   * Configure the toolbar action so a click reveals the panel.
   *
   * Chromium needs `setPanelBehavior`; Firefox drives this from the `sidebar_action` manifest
   * key and needs no runtime call.
   */
  configureToolbarBehaviour(): Promise<void>;
  /** Reveal the panel. Only valid inside a user-gesture handler. */
  openFromUserGesture(windowId?: number): Promise<void>;
  /**
   * Whether the browser itself says a panel is open in this window.
   *
   * `undefined` where the browser cannot answer, which is every Chromium build — it exposes no
   * equivalent of Firefox's `sidebarAction.isOpen`. Callers must treat `undefined` as "no opinion"
   * and never as "closed" (#113).
   */
  isOpenAccordingToBrowser(windowId?: number): Promise<boolean | undefined>;
}

interface ChromiumPanelApi {
  setPanelBehavior(behavior: { openPanelOnActionClick: boolean }): Promise<void>;
  open(options: { windowId: number }): Promise<void>;
}

interface FirefoxPanelApi {
  open(): Promise<void>;
  toggle(): Promise<void>;
  isOpen?(details: { windowId?: number }): Promise<boolean>;
}

const getChromiumPanelApi = (): ChromiumPanelApi | undefined => {
  if (typeof chrome === 'undefined') return undefined;
  const candidate = (chrome as { sidePanel?: ChromiumPanelApi }).sidePanel;
  return typeof candidate?.setPanelBehavior === 'function' ? candidate : undefined;
};

const getFirefoxPanelApi = (): FirefoxPanelApi | undefined => {
  if (typeof chrome === 'undefined') return undefined;
  const candidate = (chrome as { sidebarAction?: FirefoxPanelApi }).sidebarAction;
  return typeof candidate?.toggle === 'function' ? candidate : undefined;
};

const createChromiumPanelSurface = (api: ChromiumPanelApi): PanelSurface => ({
  kind: 'chromium',
  async configureToolbarBehaviour(): Promise<void> {
    await api.setPanelBehavior({ openPanelOnActionClick: true });
  },
  isOpenAccordingToBrowser(): Promise<boolean | undefined> {
    // Chromium has no equivalent. Answering `false` here would be a guess presented as a fact.
    return Promise.resolve(undefined);
  },
  async openFromUserGesture(windowId?: number): Promise<void> {
    if (windowId === undefined) return;
    await api.open({ windowId });
  },
});

const createFirefoxPanelSurface = (api: FirefoxPanelApi): PanelSurface => ({
  kind: 'firefox',
  configureToolbarBehaviour(): Promise<void> {
    // Firefox reveals the sidebar from the `sidebar_action` manifest key.
    return Promise.resolve();
  },
  async isOpenAccordingToBrowser(windowId?: number): Promise<boolean | undefined> {
    if (typeof api.isOpen !== 'function') return undefined;

    try {
      return await api.isOpen(windowId === undefined ? {} : { windowId });
    } catch (error: unknown) {
      // An unavailable answer is not a negative one; the port remains the source of truth.
      logService.log(LogLevel.DEBUG, '[Panel] Firefox could not report panel state', {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  },
  async openFromUserGesture(): Promise<void> {
    await api.toggle();
  },
});

const createUnsupportedPanelSurface = (): PanelSurface => ({
  kind: 'unsupported',
  isOpenAccordingToBrowser(): Promise<boolean | undefined> {
    return Promise.resolve(undefined);
  },
  configureToolbarBehaviour(): Promise<void> {
    return Promise.resolve();
  },
  openFromUserGesture(): Promise<void> {
    return Promise.resolve();
  },
});

/**
 * Resolve the panel surface for the running browser.
 *
 * Selection is by capability probe rather than by user-agent string, so a build running in an
 * unexpected browser degrades to `unsupported` instead of throwing.
 */
export const resolvePanelSurface = (): PanelSurface => {
  const chromium = getChromiumPanelApi();
  if (chromium) return createChromiumPanelSurface(chromium);

  const firefox = getFirefoxPanelApi();
  if (firefox) return createFirefoxPanelSurface(firefox);

  return createUnsupportedPanelSurface();
};

/**
 * Apply the toolbar behaviour for the running browser.
 *
 * Safe to call on every background startup; both implementations are idempotent.
 */
export const initializePanelSurface = async (
  surface: PanelSurface = resolvePanelSurface(),
): Promise<PanelSurface> => {
  try {
    await surface.configureToolbarBehaviour();
  } catch (error: unknown) {
    logService.log(LogLevel.ERROR, '[Panel] Failed to configure toolbar behaviour', {
      kind: surface.kind,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return surface;
};
