import type { RelayCatalogEntry, RelayDiscoveryState } from '@/types/relay';
import { logService, LogLevel } from './log-service';
import { sendBexMessage } from './vault-service';

/**
 * Fetch cached relay catalog entries from the background.
 */
export async function listRelayCatalog(): Promise<RelayCatalogEntry[]> {
  try {
    const data = await sendBexMessage('relay.browser.list');
    return data || [];
  } catch (error) {
    logService.log(LogLevel.ERROR, '[RelayService] Failed to fetch relay catalog', { error });
    return [];
  }
}

/**
 * Trigger a refresh of the relay catalog from the background.
 * @param force If true, bypasses staleness checks.
 */
export async function refreshRelayCatalog(force = false): Promise<void> {
  try {
    await sendBexMessage('relay.browser.refresh', { force });
  } catch (error) {
    logService.log(LogLevel.ERROR, '[RelayService] Failed to trigger relay catalog refresh', { error });
  }
}

/**
 * Get current relay discovery status from the background.
 */
export async function getRelayDiscoveryStatus(): Promise<RelayDiscoveryState | null> {
  try {
    const data = await sendBexMessage('relay.browser.getStatus');
    return data || null;
  } catch (error) {
    logService.log(LogLevel.ERROR, '[RelayService] Failed to fetch relay discovery status', { error });
    return null;
  }
}
