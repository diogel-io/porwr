import { relayCatalogService } from '@/services/relay-catalog';
import { relayBrowserOrchestrator } from '@/services/relay-browser-orchestrator';
import { logService, LogLevel } from '@/services/log-service';
import type { RelayCatalogEntry, RelayDiscoveryState } from '@/types/relay';
import type { HandlerResult } from '../types/background';

/**
 * Handles the 'relay.browser.list' action.
 * Returns the cached relay catalog entries.
 */
export async function handleRelayBrowserList(): Promise<HandlerResult<RelayCatalogEntry[]>> {
  try {
    const entries = await relayCatalogService.getEntries();
    return {
      success: true,
      data: entries,
    };
  } catch (error) {
    logService.log(LogLevel.ERROR, '[RelayBrowserHandler] Failed to list relays', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error fetching relay list',
    };
  }
}

/**
 * Handles the 'relay.browser.getStatus' action.
 * Returns the current relay discovery status from the database.
 */
export async function handleRelayBrowserGetStatus(): Promise<HandlerResult<RelayDiscoveryState | null>> {
  try {
    const status = await relayCatalogService.getDiscoveryState('global');
    return {
      success: true,
      data: status,
    };
  } catch (error) {
    logService.log(LogLevel.ERROR, '[RelayBrowserHandler] Failed to get discovery status', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error fetching discovery status',
    };
  }
}

/**
 * Handles the 'relay.browser.refresh' action.
 * Triggers the relay browser refresh flow.
 */
export function handleRelayBrowserRefresh(payload?: { force?: boolean }): Promise<HandlerResult<void>> {
  try {
    const force = payload?.force || false;
    // We don't await the full refresh here to avoid blocking the BEX response,
    // as it can take a long time. The UI should poll getStatus to see progress.
    void relayBrowserOrchestrator.refreshCatalog(force).catch((error: unknown) => {
      logService.log(LogLevel.ERROR, '[RelayBrowserHandler] Async refresh failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return Promise.resolve({
      success: true,
      data: undefined,
    });
  } catch (error: unknown) {
    logService.log(LogLevel.ERROR, '[RelayBrowserHandler] Failed to trigger refresh', {
      error: error instanceof Error ? error.message : String(error),
    });
    return Promise.resolve({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error triggering refresh',
    });
  }
}
