import { acceptHMRUpdate, defineStore } from 'pinia';
import { watch } from 'vue';
import type { StoredKey } from '../types';
import { get, getActive, renameAlias, save, setActive } from '../services/dexie-storage';
import { NOSTR_ACTIVE, storageService } from '../services/storage-service';
import useVaultStore from './vault-store';

/**
 * Whether the accounts held here reflect the vault.
 *
 * An empty `storedKeys` used to mean two different things — the vault holds no accounts, and we
 * never managed to read it — and every consumer rendered the first meaning for both. That is #211:
 * the panel mounts while the vault is locked, `dexie-storage.get()` answers `{}` for a locked vault,
 * and the resulting empty set was indistinguishable from a vault with no accounts in it.
 */
export type AccountHydration = 'empty' | 'loading' | 'ready';

interface AccountState {
  storedKeys: Set<StoredKey>;
  isListening: boolean;
  isFollowingVault: boolean;
  hydration: AccountHydration;
  activeKey: string | undefined;
}

const useAccountStore = defineStore('account', {
  state: (): AccountState => ({
    storedKeys: new Set<StoredKey>(),
    isListening: false,
    isFollowingVault: false,
    hydration: 'empty',
    activeKey: undefined,
  }),

  getters: {
    /**
     * The account the alias in `activeKey` names, or `undefined`.
     *
     * Five surfaces each carried their own copy of this lookup and so each had to be fixed
     * separately. It resolves against `storedKeys`, which is empty whenever the vault is locked, so
     * a consumer must read `hydration` before concluding anything from `undefined`.
     */
    activeAccount(state): StoredKey | undefined {
      const activeAlias = state.activeKey;
      if (!activeAlias) return undefined;
      return Array.from(state.storedKeys).find((key) => key.alias === activeAlias);
    },

    /**
     * The active account, or the first one held, for surfaces that work on any account rather
     * than specifically the active one.
     *
     * The relay and contact pages both fall back this way and then repair `activeKey` from it.
     * Kept as a second getter rather than folded into `activeAccount`, because the two answers
     * genuinely differ and the panel must not silently show an account nobody selected.
     */
    activeAccountOrFirst(): StoredKey | undefined {
      return this.activeAccount ?? Array.from(this.storedKeys)[0];
    },

    /** True once the vault has been read: `activeAccount` is only meaningful from here. */
    isHydrated(state): boolean {
      return state.hydration === 'ready';
    },

    /**
     * A vault that was read and holds no accounts — S16, "no account configured".
     *
     * Distinct from a vault that has not been read, which is what the panel was reporting as S16.
     */
    hasNoAccounts(state): boolean {
      return state.hydration === 'ready' && state.storedKeys.size === 0;
    },
  },

  actions: {
    async saveKey(storedKey: StoredKey): Promise<void> {
      try {
        // 1. Save to the encrypted Vault (using dexie-storage which now handles vault syncing)
        await save(storedKey);
        this.storedKeys.add(storedKey);
        console.log('[AccountStore] Account saved to vault');
      } catch (error) {
        console.error('Failed to save key:', error);
        throw error;
      }
    },
    async getKeys(): Promise<void> {
      // A locked vault answers `{}` to every read, so reading one would record a confident and
      // wrong "this vault has no accounts". Nine surfaces call this on mount and several of them
      // can be reached while locked, so the guard belongs here rather than at each call site.
      if (!useVaultStore().isUnlocked) {
        this.clearKeys();
        // The active alias lives in local storage, not the vault, so it is readable either way.
        this.activeKey = await getActive();
        return;
      }

      this.hydration = 'loading';
      try {
        this.storedKeys = new Set(Object.values(await get()));
        this.activeKey = await getActive();
        this.hydration = 'ready';
      } catch (error) {
        // A read that threw has told us nothing about the vault, so the accounts stay unhydrated
        // rather than being reported as an empty vault.
        this.hydration = 'empty';
        throw error;
      }
    },
    /**
     * Drops everything the vault supplied.
     *
     * The active alias lives in local storage rather than the vault and survives a lock, which is
     * exactly why it must not be trusted on its own: it names an account we can no longer read.
     */
    clearKeys(): void {
      this.storedKeys = new Set<StoredKey>();
      this.hydration = 'empty';
    },
    async setActiveKey(alias: string) {
      this.activeKey = alias;
      await setActive(alias);
    },
    async renameKeyAlias(currentAlias: string, newAlias: string) {
      await renameAlias(currentAlias, newAlias);
      await this.getKeys();
      if (this.activeKey === currentAlias) {
        this.activeKey = newAlias;
      }
    },
    /**
     * Keeps the accounts in step with the vault's lock state (#211).
     *
     * Hydration used to happen once, in whichever component mounted first. The panel mounts while
     * the vault is locked by design — `App.vue` exempts it from the redirect to login, because it
     * owns a view for every vault state — so it hydrated from a locked vault, got nothing, and
     * never looked again. Unlocking re-rendered the branch and left the accounts as they were.
     *
     * Both directions matter and must stay together. Clearing on lock without hydrating on unlock
     * would empty every open dashboard page the moment auto-lock fires and leave it that way.
     */
    followVaultLockState(): void {
      if (this.isFollowingVault) return;
      this.isFollowingVault = true;

      const vaultStore = useVaultStore();

      watch(
        () => vaultStore.isUnlocked,
        (unlocked) => {
          if (unlocked) {
            void this.getKeys();
            return;
          }
          this.clearKeys();
        },
        { immediate: true },
      );
    },
    listenToStorageChanges() {
      if (this.isListening) return;

      storageService.onChanged((changes, areaName) => {
        if (areaName === 'local' && NOSTR_ACTIVE in changes) {
          void this.getKeys();
        }
      });

      this.isListening = true;
    },
  },
});
export default useAccountStore;

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAccountStore, import.meta.hot));
}
