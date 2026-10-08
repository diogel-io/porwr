import { acceptHMRUpdate, defineStore } from 'pinia';
import type { StoredKey, VaultData } from '@/types/bridge';
import { logService, LogLevel } from '@/services/log-service';
import { storageService, VAULT_UNLOCKED } from '@/services/storage-service';
import {
  createVault as createVaultBex,
  hasVault as hasVaultBex,
  lockVault as lockVaultBex,
  unlockVault as unlockVaultBex,
} from '@/services/vault-service';

const useVaultStore = defineStore('vault', {
  state: () => ({
    isUnlocked: false,
    vaultExists: false,
    isLoading: false,
    lastLockReason: null as 'manual' | 'inactivity' | 'background' | null,
  }),

  actions: {
    listenToLockChanges() {
      storageService.onChanged((changes, areaName) => {
        if (areaName === 'session' && VAULT_UNLOCKED in changes) {
          const unlocked = !!changes[VAULT_UNLOCKED]?.newValue;
          this.isUnlocked = unlocked;
          if (!unlocked) {
            this.lastLockReason = 'background';
          }
        }
      });
    },

    async checkVaultStatus() {
      try {
        const [exists, unlocked] = await Promise.all([
          hasVaultBex(),
          storageService.get<boolean>(VAULT_UNLOCKED, 'session'),
        ]);

        this.vaultExists = !!exists;
        this.isUnlocked = !!unlocked;

      } catch (error: unknown) {
        logService.log(LogLevel.ERROR, '[VaultStore] Failed to refresh vault status', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async unlock(password: string) {
      const result = await unlockVaultBex(password);
      if (result.success) {
        this.isUnlocked = true;
        this.lastLockReason = null;
        return { success: true };
      }
      return {
        success: false,
        error: result.error,
        errorCode: result.code
      };
    },

    async lock(reason: 'manual' | 'inactivity' = 'manual') {
      await lockVaultBex();
      this.isUnlocked = false;
      this.lastLockReason = reason;
    },

    async create(
      password: string,
      mnemonic: string,
      passphrase?: string,
      initialAccount?: StoredKey,
    ) {
      const vaultData: VaultData = {
        mnemonic,
        passphrase: passphrase || '',
        createdAt: new Date().toISOString(),
        accounts: initialAccount ? [initialAccount] : [],
      };
      const result = await createVaultBex(password, vaultData);
      if (result.success) {
        this.vaultExists = true;
        this.isUnlocked = true;
        return { success: true };
      }
      return {
        success: false,
        error: result.error,
        errorCode: result.code
      };
    },
  },
});

export default useVaultStore;

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useVaultStore, import.meta.hot));
}
