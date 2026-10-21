import { acceptHMRUpdate, defineStore } from 'pinia';
import {
  BLOSSOM_SERVER,
  DARK_MODE,
  FALLBACK_RELAYS,
  QUICK_PUBLISH_CLIENT_TAG,
  REQUEST_EXPIRY_MINUTES,
  storageService,
} from '@/services/storage-service';
import {
  clampRequestExpiryMinutes,
  REQUEST_EXPIRY_DEFAULT_MINUTES,
} from '@/services/request-expiry';
import { RELAY_SEEDS } from '@/data/relay-seeds';
import { AUTO_LOCK_DEFAULT_MINUTES, clampAutoLockMinutes } from '@/services/auto-lock-minutes';
import {
  getProtected,
  PROTECTED_AUTO_LOCK_MINUTES,
  setProtected,
} from '@/services/protected-settings';
import { PROFILE_SEARCH_RELAY_SEEDS } from '@/data/profile-search-relay-seeds';
import {
  RELAY_PROTOCOL_ERROR,
  hasRefusedPlaintextRelay,
  normalizeRelayUrl,
} from '@/services/relay-url';
import { LogLevel, logService } from '@/services/log-service';
import { normalizeBlossomServer } from '@/services/blossom-server';
import {
  getStoredProfileSearchRelays,
  setStoredProfileSearchRelays,
} from '@/services/profile-search-relay-settings-service';

const DEFAULT_BLOSSOM_SERVER = 'https://blossom.primal.net/';
const DEFAULT_FALLBACK_RELAYS = RELAY_SEEDS;
const DEFAULT_PROFILE_SEARCH_RELAYS = PROFILE_SEARCH_RELAY_SEEDS;

/**
 * The relays to use for a stored list: its usable entries, or `defaults` when it has none, unless
 * the list lost them all to the wss:// rule (#142). Then it stays empty, and Porwr asks no relay
 * rather than public ones the user did not choose. Applies to the fallback relays and the profile
 * search relays alike.
 */
function resolveStoredRelays(
  stored: string[],
  defaults: readonly string[],
  listName: string,
): string[] {
  const normalized = normalizeRelayList(stored);
  if (normalized.length > 0) return normalized;
  if (hasRefusedPlaintextRelay(stored)) {
    if (!loggedEmptyLists.has(listName)) {
      loggedEmptyLists.add(listName);
      logService.log(
        LogLevel.WARN,
        `[settings] Every stored ${listName} relay was plaintext ws://; none are used until wss:// relays are set`,
      );
    }
    return [];
  }
  return [...defaults];
}

const resolveFallbackRelays = (stored: string[]): string[] =>
  resolveStoredRelays(stored, DEFAULT_FALLBACK_RELAYS, 'fallback');

/**
 * Hosts whose dropped relay has already been logged in this context. Settings load on every
 * dashboard page and before every upload; the drop is worth one line, not one per load.
 */
const loggedRelayDrops = new Set<string>();
/** Lists whose emptying by the wss:// rule has already been logged in this context. */
const loggedEmptyLists = new Set<string>();

function normalizeRelayList(relays: string[]): string[] {
  const results = relays.map((relay) => normalizeRelayUrl(relay));
  results.forEach((result, index) => {
    if (result.error !== RELAY_PROTOCOL_ERROR) return;
    // Saved before relays had to be wss:// (diogel-io/workspace#142). The host only, never the URL.
    let host = 'unparseable';
    try {
      host = new URL(relays[index]!.trim()).hostname;
    } catch {
      // keep the placeholder
    }
    if (loggedRelayDrops.has(host)) return;
    loggedRelayDrops.add(host);
    logService.log(LogLevel.INFO, '[settings] Dropped a stored plaintext ws:// relay', { host });
  });
  const normalized = results
    .filter(
      (result): result is { valid: true; url: string; hostname?: string } =>
        result.valid && typeof result.url === 'string',
    )
    .map((result) => result.url);

  return Array.from(new Set(normalized));
}

const useSettingsStore = defineStore('settings', {
  state: () => ({
    blossomServer: DEFAULT_BLOSSOM_SERVER,
    darkMode: true, // Default to dark mode as per current observed behavior
    vaultAutoLockMinutes: AUTO_LOCK_DEFAULT_MINUTES,
    requestExpiryMinutes: REQUEST_EXPIRY_DEFAULT_MINUTES,
    fallbackRelays: DEFAULT_FALLBACK_RELAYS,
    profileSearchRelays: DEFAULT_PROFILE_SEARCH_RELAYS,
    // NIP-89 client tag on Quick Publish notes. On by default; only an explicit `false` turns it off.
    quickPublishClientTag: true,
    isListening: false,
  }),

  actions: {
    async getFallbackRelays(): Promise<string[]> {
      if (this.fallbackRelays.length === 0) {
        await this.getSettings();
      }
      return this.fallbackRelays;
    },

    async getProfileSearchRelays(): Promise<string[]> {
      if (this.profileSearchRelays.length === 0) {
        await this.getSettings();
      }
      return this.profileSearchRelays;
    },

    async getSettings(): Promise<void> {
      const result = await storageService.getMultiple([
        BLOSSOM_SERVER,
        DARK_MODE,
        REQUEST_EXPIRY_MINUTES,
        FALLBACK_RELAYS,
        QUICK_PUBLISH_CLIENT_TAG,
      ]);
      if (result[BLOSSOM_SERVER] && typeof result[BLOSSOM_SERVER] === 'string') {
        // Kept as stored, even when it is not https://: the Media page shows it with the reason, and
        // the background refuses to upload to it. Swapping in the default would send the user's
        // images to a server they never chose (T21, #142).
        this.blossomServer = result[BLOSSOM_SERVER];
      }
      if (Object.prototype.hasOwnProperty.call(result, DARK_MODE)) {
        this.darkMode = Boolean(result[DARK_MODE]);
      }
      // Kept out of content-script storage, and clamped as the background clamps it (#140).
      this.vaultAutoLockMinutes = clampAutoLockMinutes(
        await getProtected<unknown>(PROTECTED_AUTO_LOCK_MINUTES),
      );
      if (Object.prototype.hasOwnProperty.call(result, REQUEST_EXPIRY_MINUTES)) {
        // Clamped on read as well as on write: the background applies the same clamp, and the
        // UI must never present a value the background would refuse (ADR D8).
        this.requestExpiryMinutes = clampRequestExpiryMinutes(result[REQUEST_EXPIRY_MINUTES]);
      }
      if (
        Array.isArray(result[FALLBACK_RELAYS]) &&
        (result[FALLBACK_RELAYS] as unknown[]).length > 0
      ) {
        this.fallbackRelays = resolveFallbackRelays(result[FALLBACK_RELAYS] as string[]);
      }
      this.quickPublishClientTag = result[QUICK_PUBLISH_CLIENT_TAG] !== false;
      let storedProfileSearchRelays: string[] | undefined;
      try {
        storedProfileSearchRelays = await getStoredProfileSearchRelays();
      } catch {
        storedProfileSearchRelays = undefined;
      }
      if (Array.isArray(storedProfileSearchRelays)) {
        this.profileSearchRelays = resolveStoredRelays(
          storedProfileSearchRelays,
          DEFAULT_PROFILE_SEARCH_RELAYS,
          'profile search',
        );
      }
    },

    /** Saves an https:// Blossom server. Throws for anything else, and leaves the setting unchanged. */
    async setBlossomServer(url: string): Promise<void> {
      const result = normalizeBlossomServer(url);
      if (!result.valid || !result.url) {
        throw new Error(result.error ?? 'Enter a valid Blossom server URL');
      }
      this.blossomServer = result.url;
      await storageService.set(BLOSSOM_SERVER, result.url);
    },

    async setDarkMode(dark: boolean): Promise<void> {
      this.darkMode = dark;
      await storageService.set(DARK_MODE, dark);
    },

    async setQuickPublishClientTag(enabled: boolean): Promise<void> {
      this.quickPublishClientTag = enabled;
      await storageService.set(QUICK_PUBLISH_CLIENT_TAG, enabled);
    },

    async setVaultAutoLockMinutes(minutes: number): Promise<void> {
      const normalized = clampAutoLockMinutes(minutes);
      this.vaultAutoLockMinutes = normalized;
      await setProtected(PROTECTED_AUTO_LOCK_MINUTES, normalized);
    },

    async setRequestExpiryMinutes(minutes: number): Promise<void> {
      const normalized = clampRequestExpiryMinutes(minutes);
      this.requestExpiryMinutes = normalized;
      await storageService.set(REQUEST_EXPIRY_MINUTES, normalized);
    },

    async setFallbackRelays(relays: string[]): Promise<void> {
      const filtered = Array.isArray(relays) ? normalizeRelayList(relays) : [];
      if (filtered.length === 0) {
        this.fallbackRelays = DEFAULT_FALLBACK_RELAYS;
      } else {
        this.fallbackRelays = filtered;
      }
      await storageService.set(FALLBACK_RELAYS, this.fallbackRelays);
    },

    async setProfileSearchRelays(relays: string[]): Promise<void> {
      const filtered = Array.isArray(relays) ? normalizeRelayList(relays) : [];
      const next = filtered.length > 0 ? filtered : DEFAULT_PROFILE_SEARCH_RELAYS;
      this.profileSearchRelays = next;
      // A plain copy: IndexedDB cannot clone the store's reactive proxy (#263).
      await setStoredProfileSearchRelays([...next]);
    },

    async addProfileSearchRelay(relay: string): Promise<void> {
      const normalized = normalizeRelayList([...this.profileSearchRelays, relay]);
      if (normalized.length === 0) {
        throw new Error('Invalid relay URL.');
      }
      await this.setProfileSearchRelays(normalized);
    },

    async removeProfileSearchRelay(relay: string): Promise<void> {
      await this.setProfileSearchRelays(this.profileSearchRelays.filter((item) => item !== relay));
    },

    listenToStorageChanges() {
      if (this.isListening) return;

      storageService.onChanged((changes, areaName) => {
        if (areaName === 'local') {
          if (BLOSSOM_SERVER in changes) {
            const newValue = changes[BLOSSOM_SERVER].newValue;
            if (typeof newValue === 'string' && newValue.length > 0) {
              this.blossomServer = newValue;
            }
          }
          if (DARK_MODE in changes) {
            const newValue = changes[DARK_MODE].newValue;
            this.darkMode = typeof newValue === 'boolean' ? newValue : Boolean(newValue);
          }
          if (QUICK_PUBLISH_CLIENT_TAG in changes) {
            this.quickPublishClientTag = changes[QUICK_PUBLISH_CLIENT_TAG].newValue !== false;
          }
          if (FALLBACK_RELAYS in changes) {
            const newValue = changes[FALLBACK_RELAYS].newValue;
            this.fallbackRelays =
              Array.isArray(newValue) && newValue.length > 0
                ? resolveFallbackRelays(newValue as string[])
                : DEFAULT_FALLBACK_RELAYS;
          }
        }
      });

      this.isListening = true;
    },
  },
});

export default useSettingsStore;

if (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    if (newModule) {
      acceptHMRUpdate(useSettingsStore, import.meta.hot)(newModule);
    }
  });
}
