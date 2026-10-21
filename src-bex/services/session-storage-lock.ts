import { LogLevel, logService } from '@/services/log-service';

/**
 * Restrict `chrome.storage.session` to Porwr's own pages and background.
 *
 * Session storage holds the request queue and the `vault:unlocked` marker, which says the vault's
 * key (kept as a non-extractable CryptoKey in IndexedDB, #245) belongs to this browser session.
 * Content scripts and web pages must never read it, whatever the browser's default access level.
 * Firefox may not offer `setAccessLevel`; there the call is skipped. A failure is logged rather than
 * thrown so the worker still starts, and is visible in the exceptions log.
 *
 * Extracted from `background.ts`, which cannot be imported in tests, so the call is covered (#144).
 */
export async function lockDownSessionStorage(): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session?.setAccessLevel) {
      await chrome.storage.session.setAccessLevel({
        accessLevel: 'TRUSTED_CONTEXTS',
      });
    }
  } catch (error: unknown) {
    logService.log(LogLevel.ERROR, '[BEX] Failed to set session storage access level', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
