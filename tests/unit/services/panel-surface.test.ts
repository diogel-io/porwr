import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  initializePanelSurface,
  resolvePanelSurface,
  type PanelSurface,
} from '@/../src-bex/services/panel-surface';

vi.mock('@/services/log-service', () => ({
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
  logService: { log: vi.fn() },
}));

const originalChrome = globalThis.chrome;

const setChrome = (value: unknown): void => {
  (globalThis as { chrome?: unknown }).chrome = value;
};

describe('panel surface port', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setChrome(originalChrome);
  });

  it('selects the Chromium implementation when sidePanel is available', () => {
    setChrome({ sidePanel: { setPanelBehavior: vi.fn(), open: vi.fn() } });
    expect(resolvePanelSurface().kind).toBe('chromium');
  });

  it('selects the Firefox implementation when only sidebarAction is available', () => {
    setChrome({ sidebarAction: { toggle: vi.fn(), open: vi.fn() } });
    expect(resolvePanelSurface().kind).toBe('firefox');
  });

  it('degrades to unsupported rather than throwing when neither API exists', () => {
    setChrome({});
    expect(resolvePanelSurface().kind).toBe('unsupported');
  });

  it('asks Chromium to open the panel on toolbar click', async () => {
    const setPanelBehavior = vi.fn().mockResolvedValue(undefined);
    setChrome({ sidePanel: { setPanelBehavior, open: vi.fn() } });

    await initializePanelSurface();

    expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  });

  it('makes no runtime call on Firefox, where the manifest drives the sidebar', async () => {
    const toggle = vi.fn();
    const open = vi.fn();
    setChrome({ sidebarAction: { toggle, open } });

    await initializePanelSurface();

    expect(toggle).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('does not throw when configuring the toolbar fails', async () => {
    const setPanelBehavior = vi.fn().mockRejectedValue(new Error('nope'));
    setChrome({ sidePanel: { setPanelBehavior, open: vi.fn() } });

    await expect(initializePanelSurface()).resolves.toBeDefined();
  });

  it('toggles the Firefox sidebar from a user gesture', async () => {
    const toggle = vi.fn().mockResolvedValue(undefined);
    setChrome({ sidebarAction: { toggle, open: vi.fn() } });

    const surface: PanelSurface = resolvePanelSurface();
    await surface.openFromUserGesture(7);

    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('opens the Chromium panel for a specific window, and does nothing without one', async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    setChrome({ sidePanel: { setPanelBehavior: vi.fn(), open } });

    const surface = resolvePanelSurface();
    await surface.openFromUserGesture(42);
    expect(open).toHaveBeenCalledWith({ windowId: 42 });

    open.mockClear();
    await surface.openFromUserGesture();
    expect(open).not.toHaveBeenCalled();
  });
});
