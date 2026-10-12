
export const NOSTR_ACTIVE = 'nostr:active' as const;
export const BLOSSOM_SERVER = 'nostr:blossom-server' as const;
export const DARK_MODE = 'nostr:dark-mode' as const;
export const VAULT_AUTO_LOCK_MINUTES = 'vault:auto-lock-minutes' as const;
export const REQUEST_EXPIRY_MINUTES = 'nostr:request-expiry-minutes' as const;
// Session-scoped: the queue starts empty on every browser restart by design (ADR D6, D7).
export const REQUEST_QUEUE_KEY = 'nostr:request-queue' as const;
/**
 * Session-scoped: client secrets for wallet connections the user is still approving in a wallet's
 * popup. See `src-bex/services/nip47-pending-authorization-store.ts` (#110).
 */
export const NIP47_PENDING_AUTHORIZATIONS_KEY = 'nip47:pending-authorizations' as const;
export const VAULT_LAST_ACTIVITY = 'vault:last-activity' as const;
export const BLOSSOM_UPLOAD_STATUS = 'blossom:upload-status' as const;
export const PERMISSIONS_KEY = 'nostr:permissions' as const;
/** Which account each origin signs as. See `src-bex/services/site-binding-store.ts` (#116). */
export const SITE_BINDINGS_KEY = 'nostr:site-bindings' as const;
export const VAULT_UNLOCKED = 'vault:unlocked' as const;
export const FALLBACK_RELAYS = 'nostr:fallback-relays' as const;
/** Whether Quick Publish adds a NIP-89 `client` tag to its notes. On unless stored as `false` (#226). */
export const QUICK_PUBLISH_CLIENT_TAG = 'nostr:quick-publish-client-tag' as const;

/**
 * Bumped whenever a profile is published, so any surface showing that profile can re-read it.
 *
 * A storage write rather than a message: the panel, the extension index page and the dashboard are
 * separate page contexts, and `chrome.storage.onChanged` reaches all of them. The panel port cannot
 * — it is one connection per panel and the background counts them for presence, so a second
 * consumer opening one would make a single panel look like two (#113).
 */
export const PROFILE_UPDATED_KEY = 'profile:updated' as const;

export type StorageArea = 'local' | 'session' | 'sync';

export interface StorageService {
  get<T>(key: string, area?: StorageArea): Promise<T | undefined>;
  getMultiple(keys: string[], area?: StorageArea): Promise<Record<string, unknown>>;
  set(key: string, value: unknown, area?: StorageArea): Promise<void>;
  setMultiple(items: Record<string, unknown>, area?: StorageArea): Promise<void>;
  remove(key: string | string[], area?: StorageArea): Promise<void>;
  clear(area?: StorageArea): Promise<void>;
  onChanged(
    callback: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void,
  ): void;
  removeOnChanged(
    callback: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void,
  ): void;
}

class StorageServiceImpl implements StorageService {
  private getArea(area: StorageArea = 'local'): chrome.storage.StorageArea {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      throw new Error('Chrome storage API is not available');
    }
    return chrome.storage[area];
  }

  get = async <T>(key: string, area: StorageArea = 'local'): Promise<T | undefined> => {
    const result = await this.getArea(area).get([key]);
    return result[key] as T | undefined;
  };

  getMultiple = async (keys: string[], area: StorageArea = 'local'): Promise<Record<string, unknown>> => {
    return await this.getArea(area).get(keys);
  };

  set = async (key: string, value: unknown, area: StorageArea = 'local'): Promise<void> => {
    await this.getArea(area).set({ [key]: value });
  };

  setMultiple = async (items: Record<string, unknown>, area: StorageArea = 'local'): Promise<void> => {
    await this.getArea(area).set(items);
  };

  remove = async (key: string | string[], area: StorageArea = 'local'): Promise<void> => {
    await this.getArea(area).remove(key);
  };

  clear = async (area: StorageArea = 'local'): Promise<void> => {
    await this.getArea(area).clear();
  };

  onChanged = (
    callback: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void,
  ): void => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.onChanged.addListener(callback);
    }
  };

  removeOnChanged = (
    callback: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void,
  ): void => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.onChanged.removeListener(callback);
    }
  };
}

export const storageService: StorageService = new StorageServiceImpl();
