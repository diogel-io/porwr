import { hexToBytes } from '@noble/hashes/utils';
import { NOSTR_ACTIVE, storageService } from '@/services/storage-service';
import type { StoredKey, VaultData } from '@/types/bridge';
import { handleVaultGetData, handleVaultIsUnlocked } from './vault-handler';

export async function getActiveStoredKey(): Promise<StoredKey> {
  const isUnlockedResult = await handleVaultIsUnlocked({}, '');
  if (!isUnlockedResult.success || !isUnlockedResult.data) {
    throw new Error('Vault is locked');
  }

  const activeAlias = await storageService.get<string>(NOSTR_ACTIVE);
  if (!activeAlias) {
    throw new Error('No active account found');
  }

  const vaultRes = await handleVaultGetData({}, '');
  if (!vaultRes.success || !vaultRes.data.vaultData) {
    throw new Error('Secret key not found');
  }

  const vaultData: VaultData = vaultRes.data.vaultData;
  const storedKey = vaultData.accounts?.find((account) => account.alias === activeAlias);

  if (!storedKey) {
    throw new Error('Secret key not found');
  }

  return storedKey;
}

export async function getActiveSecretKey(): Promise<Uint8Array> {
  const storedKey = await getActiveStoredKey();
  return hexToBytes(storedKey.account.privkey);
}
